import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../source-pin-utils";

// Inventory lite Slice 5: source pins for suppliers and purchases (plan:
// docs/superpowers/plans/2026-11-10-inventory-lite.md, Slice 5). Behaviour: purchase.test.ts, entries-purchase.test.ts,
// suppliers.test.ts; DB truth: scripts/verify-inventory-purchases-live.ts. Needles are built by concatenation so this
// file can never match itself.

const CAFE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIST_ROUTE = "app/api/inventory/suppliers/route.ts";
const ITEM_ROUTE = "app/api/inventory/suppliers/[id]/route.ts";
const ENTRIES_ROUTE = "app/api/inventory/entries/route.ts";
const WRITE = "lib/inventory/entries-write.ts";
const SUPPLIERS = "lib/inventory/suppliers.ts";
const PURCHASE = "lib/inventory/purchase.ts";
const STOCK_MOVE = "lib/inventory/stock-move.ts";

const raw = (rel: string) => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const read = (rel: string) => stripComments(raw(rel));

const REQUIRE_ADMIN = "require" + "Admin(";
const REQUIRE_AUTH = "require" + "Auth(";
const AGGREGATE = "StockEntry" + ".aggregate";

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

/** The text of a top-level `function NAME(` up to its closing "\n}\n" (comment-stripped source). */
function fnBody(src: string, signature: string): string {
  const start = at(src, signature, `function ${signature}`);
  const close = src.indexOf("\n}\n", start);
  assert.ok(close > start, `${signature} closes`);
  return src.slice(start, close);
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

test("PIN auth: every supplier handler (GET, POST, PATCH) is admin only, never requireAuth", () => {
  const list = read(LIST_ROUTE);
  const item = read(ITEM_ROUTE);
  const handlers: [string, string][] = [["GET", list], ["POST", list], ["PATCH", item]];
  for (const [name, src] of handlers) {
    const body = handlerBody(src, name);
    assert.ok(body.includes("await " + REQUIRE_ADMIN), `${name}: requireAdmin`);
    assert.equal(body.includes(REQUIRE_AUTH), false, `${name}: never requireAuth`);
  }
  assert.ok(handlerBody(read(ENTRIES_ROUTE), "POST").includes("await " + REQUIRE_AUTH), "landmark: the entries POST does use requireAuth (its kind gate is the pin in inventory-entries-paths)");
});

test("PIN PATCH: a malformed id is a 404 before the parse; the update runs only after the parse", () => {
  const body = handlerBody(read(ITEM_ROUTE), "PATCH");
  const admin = at(body, "await " + REQUIRE_ADMIN, "the gate");
  const shape = at(body, "isValidObjectId(id)", "the id shape check", admin);
  const parse = at(body, "await validateBody(req, updateSupplierSchema)", "the parse", shape);
  const write = at(body, "await updateSupplier(", "the write", parse);
  assert.ok(admin < shape && shape < parse && parse < write);
});

test("PIN purchase order: the money check, THEN the one item read, THEN the supplier read, THEN the row, THEN the stock receive", () => {
  const src = read(WRITE);
  const body = fnBody(src, "async function createPurchase(");
  const money = at(body, "purchaseMoneyError(", "the money check");
  const items = at(body, "deps.findActiveItems(", "the item read", money);
  const supplier = at(body, "deps.findActiveSupplier(", "the supplier read", items);
  const insert = at(body, "insertEntry(doc, cmd, deps)", "the insert", supplier);
  const receive = at(body, "deps.receive(", "the receive", insert);
  assert.ok(money < items && items < supplier && supplier < insert && insert < receive);
  assert.equal(body.split("deps.findActiveItems(").length - 1, 1, "ONE read for all the lines, never one per line");
  assert.equal(body.includes("deps.move("), false, "a purchase never goes through moveStock");
  assert.equal(src.split("deps.receive(").length - 1, 1, "one receive call in the file");
  const dispatch = at(src, "if (cmd.kind === \"purchase\") return createPurchase(cmd, deps);", "the dispatch");
  assert.ok(at(src, "await deps.findByRef(cmd.clientRef)", "the clientRef pre-read") < dispatch, "the replay pre-read comes before the purchase dispatch");
});

test("PIN receive: one unordered bulkWrite; the last rate is $set only for a non-free line", () => {
  const src = read(STOCK_MOVE);
  const body = fnBody(src, "export async function receiveStock(");
  assert.equal(body.split("StockItem.bulkWrite(").length - 1, 1, "one bulkWrite");
  assert.ok(body.includes("{ ordered: false }"), "unordered");
  assert.ok(
    body.includes("line.ratePaise > 0 ? { $inc: { qty: line.qty }, $set: { lastRatePaise: line.ratePaise } } : { $inc: { qty: line.qty } }"),
    "a rate of 0 gets the $inc alone",
  );
  assert.equal(src.split("$set: { lastRatePaise").length - 1, 1, "the last rate is set in exactly one place");
  assert.ok(src.includes("$inc: { qty: sign * line.qty }"), "landmark: moveStock's $inc is still there");
});

test("PIN dues: ONE aggregate over ACTIVE_STOCK_ENTRY with ObjectId casts and a $sum of duePaise", () => {
  const src = read(SUPPLIERS);
  const body = fnBody(src, "export async function supplierDues(");
  assert.ok(body.includes("...ACTIVE_STOCK_ENTRY"), "deleted entries never count");
  assert.ok(body.includes("duePaise: { $exists: true }"), "only entries that carry a due");
  assert.ok(body.includes("new Types.ObjectId(id)"), "an aggregate does not cast: ids are converted");
  assert.ok(body.includes('$sum: "$duePaise"'), "landmark: the sum");
  for (const rel of [...sources("app"), ...sources("lib")]) {
    const n = read(rel).split(AGGREGATE).length - 1;
    assert.equal(n, rel === SUPPLIERS ? 1 : 0, `${rel}: the dues aggregate lives in suppliers.ts only`);
  }
});

test("PIN archive: the dues refusal comes before the update, which only touches ACTIVE suppliers", () => {
  const body = fnBody(read(SUPPLIERS), "export async function updateSupplier(");
  const dues = at(body, "await supplierDues([id])", "the dues read");
  const refusal = at(body, "SUPPLIER_HAS_DUES_ERROR", "the refusal", dues);
  const write = at(body, "Supplier.findOneAndUpdate({ _id: id, ...ACTIVE }", "the update", refusal);
  assert.ok(dues < refusal && refusal < write);
  assert.ok(body.includes("due !== 0"), "either sign blocks the archive (an advance is money too)");
  assert.ok(body.includes("runValidators: true"), "validators run on the update");
});

test("PIN census: no source $inc or $set writes a supplier balance (dues are summed on read)", () => {
  const writesBalance = /\$(?:inc|set)\s*:\s*\{[^}]*\b(?:due|duePaise|balance|balancePaise|owed)\b/;
  assert.equal(writesBalance.test("{ $inc: { duePaise: 1 } }"), true, "landmark: the pattern does catch a balance write");
  // Scoped to the inventory code: other features (customers) keep their own due fields.
  const files = [...sources("app/api/inventory"), ...sources("lib/inventory"), "models/Supplier.ts", "models/StockEntry.ts", "models/StockItem.ts"];
  assert.ok(files.includes(SUPPLIERS) && files.includes(STOCK_MOVE) && files.includes(WRITE), "landmark: the walk sees the writers");
  const holders = files.filter((f) => writesBalance.test(read(f)));
  assert.deepEqual(holders, [], "nothing stores a running balance");
});

test("PIN purchase.ts stays pure: no Mongoose, no models, no runtime import of the writer", () => {
  const src = raw(PURCHASE);
  assert.ok(src.includes("export function purchaseSums("), "landmark: this is the pure helper file");
  for (const banned of ['from "mongoose"', 'from "@/models/', 'from "@/lib/db"', 'from "./entries-write"']) {
    assert.equal(src.includes(banned), false, `purchase.ts must not import ${banned}`);
  }
});

test("PIN entries route: the answer carries the supplier names", () => {
  const post = handlerBody(read(ENTRIES_ROUTE), "POST");
  assert.ok(post.includes("toStockEntryDto(result.row, result.items, result.suppliers)"));
});
