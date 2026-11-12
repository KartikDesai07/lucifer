import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../source-pin-utils";

// Inventory lite Slice 6: source pins for paying a supplier. Behaviour: entries-payment.test.ts; DB truth:
// scripts/verify-inventory-payments-live.ts. Needles are built by concatenation so this file can never match itself.

const CAFE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WRITE = "lib/inventory/entries-write.ts";
const REPLAY = "lib/inventory/entry-replay.ts";
const READ = "lib/inventory/entries-read.ts";
const ENTRIES_ROUTE = "app/api/inventory/entries/route.ts";

const raw = (rel: string) => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const read = (rel: string) => stripComments(raw(rel));

function at(src: string, needle: string, label: string, from = 0): number {
  const idx = src.indexOf(needle, from);
  assert.ok(idx !== -1, `expected ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}

/** The text of a top-level `function NAME(` up to its closing "\n}\n" (comment-stripped source). */
function fnBody(src: string, signature: string): string {
  const start = at(src, signature, `function ${signature}`);
  const close = src.indexOf("\n}\n", start);
  assert.ok(close > start, `${signature} closes`);
  return src.slice(start, close);
}

/** The text of `export async function NAME(...) { ... }` (comment-stripped source). */
function handlerBody(src: string, name: string): string {
  const start = at(src, "export async function " + name + "(", `handler ${name}`);
  const open = src.indexOf(") {", start) + 2;
  assert.equal(src[open], "{", `${name} body opens`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return assert.fail(`${name} body never closes`);
}

const MOVE = "deps." + "move(";
const RECEIVE = "deps." + "receive(";
const PAID = "paid" + "Paise";

test("PIN createPayment: the supplier read comes before the row; no stock call; total and due from the typed amount; never paidPaise", () => {
  const src = read(WRITE);
  const body = fnBody(src, "async function createPayment(");
  const supplier = at(body, "deps.findActiveSupplier(", "the supplier read");
  const insert = at(body, "insertEntry(doc, cmd, deps)", "the insert", supplier);
  assert.ok(supplier < insert, "the supplier is checked before the row lands");
  assert.ok(body.includes("totalPaise: cmd.amountPaise"), "total = the typed amount");
  assert.ok(body.includes("duePaise: -cmd.amountPaise"), "due = minus the typed amount");
  assert.equal(body.includes(PAID), false, "a payment has no paid field");
  assert.equal(body.includes(MOVE), false, "a payment never moves stock");
  assert.equal(body.includes(RECEIVE), false, "a payment never receives stock");
  assert.equal(body.includes("lines"), false, "a payment writes no lines");
  assert.ok(src.includes(MOVE) && src.includes(RECEIVE), "landmark: the file does call move and receive (in the other kinds)");
});

test("PIN dispatch: the payment branch sits after the clientRef pre-read, so a replay never reaches the supplier read", () => {
  const src = read(WRITE);
  const dispatch = at(src, "if (cmd.kind === \"payment\") return createPayment(cmd, deps);", "the payment dispatch");
  const preRead = at(src, "await deps.findByRef(cmd.clientRef)", "the clientRef pre-read");
  assert.ok(preRead < dispatch, "the replay pre-read comes before the payment dispatch");
  assert.ok(at(src, "if (existing) return replayOf(existing, cmd, deps);", "the replay return") < dispatch);
});

test("PIN replayOf: its FIRST statement is the sameEntry refusal (every kind, before any read)", () => {
  const body = fnBody(read(WRITE), "async function replayOf(");
  const open = body.indexOf("{\n");
  assert.ok(open !== -1, "landmark: the body opens");
  const first = body.slice(open + 2).trimStart();
  assert.ok(first.startsWith("if (!sameEntry(first, cmd)) return refuse(CONFLICT_STATUS, STOCK_ENTRY_ALREADY_SAVED_ERROR);"), "the same-check is the first statement");
  assert.ok(body.includes("deps.findItem("), "landmark: the later reads are still in the body");
});

test("PIN entry-replay.ts stays pure: a type-only import of the writer, no Mongoose, no models, no db", () => {
  const src = raw(REPLAY);
  assert.ok(src.includes("export function sameEntry("), "landmark: this is the replay helper file");
  const writerImports = src.split("\n").filter((line) => line.includes("./entries-write"));
  assert.ok(writerImports.length >= 1, "landmark: it does import the stored-entry type");
  for (const line of writerImports) assert.ok(line.startsWith("import type "), `type-only: ${line}`);
  for (const banned of ['from "mongoose"', 'from "@/models/', 'from "@/lib/db"']) {
    assert.equal(src.includes(banned), false, `entry-replay.ts must not import ${banned}`);
  }
});

test("PIN GET route: supplierId is passed into the list query schema (inside its safeParse call)", () => {
  const get = handlerBody(read(ENTRIES_ROUTE), "GET");
  const open = at(get, "stockEntryListQuerySchema.safeParse({", "the query parse");
  const close = at(get, "});", "the parse call closes", open);
  const arg = get.slice(open, close);
  assert.ok(arg.includes("supplierId: sp.get(\"supplierId\") ?? undefined"), "supplierId is part of the parsed input");
  assert.ok(arg.includes("before: sp.get(\"before\")"), "landmark: the other params are in the same call");
  assert.ok(at(get, "listStockEntries(query.data)", "the list call", close) > close, "the parsed data (not the raw params) feeds the list");
});

test("PIN list filter: the supplier id is cast to an ObjectId and spread into the find", () => {
  const body = fnBody(read(READ), "export async function listStockEntries(");
  assert.ok(body.includes("new Types.ObjectId(options.supplierId)"), "the filter casts (a lean find would not match a string id)");
  assert.ok(body.includes("...ACTIVE_STOCK_ENTRY, ...supplier,"), "the supplier filter sits next to the active filter in the one find");
  assert.ok(body.includes("StockEntry.find("), "landmark: the find");
});

// Review s118 (MED): deleting a row that carries a due of an ARCHIVED supplier would bring back a due nobody can see
// or pay. The DELETE route asks entryMovesArchivedDues BEFORE the soft-delete and refuses with 409; the guard reads
// only an active row with a due and checks that its supplier is archived. DB truth: live case (m).
test("PIN delete guard: an archived supplier's due-carrying entry is refused before the soft-delete", () => {
  const route = handlerBody(read("app/api/inventory/entries/[id]/route.ts"), "DELETE");
  const admin = at(route, "await requireAdmin()", "the admin gate");
  const guard = at(route, "if (await entryMovesArchivedDues(id)) return failure(SUPPLIER_ARCHIVED_ENTRY_ERROR, CONFLICT_STATUS);", "the archived-supplier guard", admin);
  const del = at(route, "await deleteStockEntry(", "the soft-delete", guard);
  assert.ok(admin < guard && guard < del, "auth, then the guard, then the delete");
  const helper = fnBody(read("lib/inventory/suppliers.ts"), "export async function entryMovesArchivedDues(");
  assert.ok(helper.includes("{ _id: entryId, ...ACTIVE_STOCK_ENTRY, duePaise: { $exists: true } }"), "only an active row that carries a due");
  assert.ok(helper.includes("Supplier.exists({ _id: entry.supplierId, archived: { $exists: true } })"), "its supplier is archived");
});
