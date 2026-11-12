import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../source-pin-utils";

// Inventory lite Slice 4: source pins for the stock-entry routes and cores (plan:
// docs/superpowers/plans/2026-11-10-inventory-lite.md, Slice 4). Behaviour: entries.test.ts; DB truth:
// scripts/verify-inventory-entries-live.ts. Needles are built by concatenation so this file can never match itself.

const CAFE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIST_ROUTE = "app/api/inventory/entries/route.ts";
const ITEM_ROUTE = "app/api/inventory/entries/[id]/route.ts";
const WRITE = "lib/inventory/entries-write.ts";
const READ = "lib/inventory/entries-read.ts";

const read = (rel: string) => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));

const REQUIRE_ADMIN = "require" + "Admin(";
const REQUIRE_AUTH = "require" + "Auth(";
const CREATE_CALL = "createStock" + "Entry(";
const ENTRY_CREATE = "StockEntry" + ".create(";
const COUNT_SET = "$set: { " + "qty";

function at(src: string, needle: string, label: string, from = 0): number {
  const idx = src.indexOf(needle, from);
  assert.ok(idx !== -1, `expected ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
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

/** Every non-test .ts/.tsx file under `dir` (relative to the cafe root). */
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(CAFE_ROOT, rel))) {
      const child = `${rel}/${name}`;
      if (statSync(path.join(CAFE_ROOT, child)).isDirectory()) walk(child);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(child);
    }
  };
  walk(dir);
  return out;
}

test("PIN auth: GET and DELETE are admin only; POST takes any signed-in account", () => {
  const list = read(LIST_ROUTE);
  const get = handlerBody(list, "GET");
  const post = handlerBody(list, "POST");
  assert.ok(get.includes("await " + REQUIRE_ADMIN) && !get.includes(REQUIRE_AUTH), "GET: requireAdmin, not requireAuth");
  assert.ok(post.includes("await " + REQUIRE_AUTH) && !post.includes(REQUIRE_ADMIN), "POST: requireAuth, not requireAdmin");
  const del = handlerBody(read(ITEM_ROUTE), "DELETE");
  assert.ok(del.includes("await " + REQUIRE_ADMIN) && !del.includes(REQUIRE_AUTH), "DELETE: requireAdmin");
});

// Slice 5: the gate is deny-by-default. Only a wastage is open to staff; a count AND a purchase (money) need an admin.
test("PIN POST: the non-wastage 403 comes after the parse and BEFORE the date check and any createStockEntry call", () => {
  const post = handlerBody(read(LIST_ROUTE), "POST");
  const parse = at(post, "await validateBody(req, createStockEntrySchema)", "the body parse");
  const gate = at(post, 'parsed.data.kind !== "waste" && user.role !== "admin"', "the deny-by-default gate");
  assert.equal(post.includes('kind === "count"'), false, "the old count-only gate is gone (a new kind would be open to staff)");
  const refusal = at(post, 'failure("Admin access required", 403)', "the 403", gate);
  const date = at(post, "stockEntryDateError(", "the date check");
  const call = at(post, "await " + CREATE_CALL, "the write call");
  assert.ok(parse < gate && gate < refusal && refusal < date && date < call, "parse, gate, date window, then the write");
  assert.equal(post.split(CREATE_CALL).length - 1, 1, "one write call");
  assert.ok(post.includes("createdById: user.id"), "identity comes from the session");
});

test("PIN insert: the unique-ref index is ready before the insert, and the insert is the only StockEntry create", () => {
  const src = read(WRITE);
  const port = at(src, "insert: async (doc) => {", "the insert port");
  const ready = at(src, "await modelReady(StockEntry);", "modelReady", port);
  const create = at(src, ENTRY_CREATE, "the create", port);
  assert.ok(port < ready && ready < create, "modelReady sits between the port start and the create");
  assert.equal(src.split(ENTRY_CREATE).length - 1, 1, "one create in the file");
  for (const rel of [...sources("app"), ...sources("lib")]) {
    if (rel !== WRITE) assert.ok(!read(rel).includes(ENTRY_CREATE), `${rel} must not create StockEntries`);
  }
});

// Review s116 (MED): a count used to SET the stock before its row landed, so a retry or a same-ref race could apply
// it twice. Both kinds now land the row first and move by exactly its lines, through one helper.
test("PIN create order: the clientRef pre-read comes first; both kinds land their row BEFORE stock moves", () => {
  const src = read(WRITE);
  const top = at(src, "export async function createStockEntry(", "createStockEntry");
  const preRead = at(src, "await deps.findByRef(cmd.clientRef)", "the pre-read", top);
  const waste = at(src, "createWaste(cmd, deps)", "the waste dispatch", preRead);
  assert.ok(top < preRead && preRead < waste, "pre-read before either write");
  const helper = at(src, "async function insertThenMove(", "insertThenMove");
  const insert = at(src, "await insertEntry(doc, cmd, deps)", "the insert", helper);
  const move = at(src, "await deps.move(lines, ENTRY_APPLY)", "the move", helper);
  const wasteFn = at(src, "async function createWaste(", "createWaste");
  assert.ok(helper < insert && insert < move && move < wasteFn, "insert, then move, inside insertThenMove");
  for (const [name, fn] of [["createWaste", wasteFn], ["createCount", at(src, "async function createCount(", "createCount")]] as const) {
    const close = src.indexOf("\n}\n", fn);
    assert.ok(close > fn, `landmark: ${name} closes`);
    const body = src.slice(fn, close);
    assert.ok(body.includes("return insertThenMove(doc, cmd, item, deps);"), `${name} goes through insertThenMove`);
    assert.equal(body.includes("deps.move("), false, `${name} never moves stock itself`);
  }
  assert.equal(src.split("deps.move(").length - 1, 2, "exactly two move calls: insertThenMove and the delete reversal");
  // Slice 5: the purchase writer is the third caller (waste and count share insertThenMove); Slice 6: the payment writer.
  assert.equal(src.split("insertEntry(").length - 1, 4, "insertEntry is defined once and called by insertThenMove, createPurchase and createPayment");
});

test("PIN delete: the soft-delete CAS filter spreads ACTIVE_STOCK_ENTRY, and the reversal runs after it with ENTRY_REVERSE", () => {
  const src = read(WRITE);
  const cas = at(src, "StockEntry.findOneAndUpdate({ _id: id, ...ACTIVE_STOCK_ENTRY }", "the CAS filter");
  assert.ok(src.includes("{ $set: { deletedAt: now, deletedBy } }"), "landmark: the delete stamp");
  assert.equal(src.split("StockEntry.findOneAndUpdate(").length - 1, 1, "the CAS is the only update of an entry");
  const fn = at(src, "export async function deleteStockEntry(", "deleteStockEntry");
  const won = at(src, "await deps.softDelete(id, deletedBy, now)", "the CAS call", fn);
  const miss = at(src, "if (!won)", "the miss guard", won);
  const reverse = at(src, "await deps.move(lines, ENTRY_REVERSE)", "the reversal", miss);
  assert.ok(cas < fn && fn < won && won < miss && miss < reverse);
});

test("PIN census: no app or lib source SETS a stock number; stock only moves by $inc (stock-move.ts)", () => {
  const files = [...sources("app"), ...sources("lib")];
  assert.ok(files.includes(WRITE) && files.includes("lib/inventory/stock-move.ts"), "landmark: the walk sees lib/inventory");
  const holders = files.filter((f) => read(f).includes(COUNT_SET)).sort();
  assert.deepEqual(holders, [], "a count moves stock by its recorded change, never a $set of qty");
  assert.ok(read("lib/inventory/stock-move.ts").includes("$inc: { qty"), "landmark: the needle style matches a real writer");
});

test("PIN read: the list select never carries clientRef or createdById, and filters on ACTIVE_STOCK_ENTRY", () => {
  const src = read(READ);
  const sel = at(src, '.select("', "the list select");
  const selectText = src.slice(sel, src.indexOf('")', sel));
  assert.ok(selectText.includes("kind date lines"), "landmark: this is the list select");
  // Slice 5: the list is admin-only, so the supplier and the money of a purchase ARE selected; the identity and delete keys never.
  assert.ok(selectText.includes("supplierId totalPaise paidPaise duePaise"), "landmark: the purchase fields are selected");
  for (const banned of ["client" + "Ref", "createdBy" + "Id", "deleted"]) {
    assert.equal(selectText.includes(banned), false, `select must not carry ${banned}`);
  }
  // Slice 6: the supplier filter (one supplier's history) is spread between the two; it narrows, never widens.
  assert.ok(src.includes("{ ...ACTIVE_STOCK_ENTRY, ...supplier, ...entryCursorFilter(options.before) }"), "deleted entries never listed");
  const dto = src.slice(at(src, "export function toStockEntryDto(", "the DTO"), at(src, "export function stockEntryDateWindow(", "next export"));
  assert.ok(dto.includes("qtyMilli: line.qty"), "landmark: the DTO maps the line");
  assert.ok(dto.includes("supplierName"), "landmark: the DTO carries the supplier name (Slice 5)");
  for (const banned of ["client" + "Ref", "createdBy" + "Id", "deleted" + "At"]) {
    assert.equal(dto.includes(banned), false, `the DTO never reads ${banned}`);
  }
});
