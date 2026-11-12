import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../source-pin-utils";

// Inventory lite Slice 1 — source pins for where stock is worked out and moved (plan:
// docs/superpowers/plans/2026-11-10-inventory-lite.md, "Pins"). Behaviour: stock-use.test.ts,
// settle-followups.test.ts, models/inventory-models.test.ts; DB-truth: scripts/verify-inventory-live.ts.
// Needles are built by concatenation so this file can never match itself.

const CAFE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETTLE = "app/api/orders/[id]/settle/route.ts";
const CREATE = "app/api/orders/route.ts";
const CANCEL = "app/api/orders/[id]/cancel/route.ts";
const ORDER_ID = "app/api/orders/[id]/route.ts";
const SETTLE_FOLLOW = "lib/settle-followups.ts";
const CREATE_FOLLOW = "lib/order-create-followups.ts";
const STOCK_USE = "lib/inventory/stock-use.ts";
const STOCK_MOVE = "lib/inventory/stock-move.ts";
const ENTRIES_WRITE = "lib/inventory/entries-write.ts";

const raw = (rel: string) => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const read = (rel: string) => stripComments(raw(rel));
const count = (src: string, needle: string) => src.split(needle).length - 1;

function at(src: string, needle: string, label: string, from = 0): number {
  const idx = src.indexOf(needle, from);
  assert.ok(idx !== -1, `expected ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}

/** Brace depth at `idx` (comment-stripped source; these files carry no braces inside strings). */
function depthAt(src: string, idx: number): number {
  let depth = 0;
  for (let i = 0; i < idx; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") depth -= 1;
  }
  return depth;
}

/** The index of the `}` that closes the `{` at `open`. */
function closeOf(src: string, open: number): number {
  assert.equal(src[open], "{", "closeOf starts at an opening brace");
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  assert.fail("unclosed block");
}

const FIELDS = "stockUsed" + "Fields(";
const FOR_SALE = "stockUsed" + "ForSale(";
const MOVE = "move" + "Stock(";
const ADD_BACK = "addBack" + "StockQuietly(";

test("PIN settle: the snapshot starts after the money refusals and joins the $set before the CAS, once", () => {
  const src = read(SETTLE);
  const refusal = at(src, 'return failure("Tab changed — reopen it and try again", 409);', "the partial-pay refusal");
  const start = at(src, "const stockUsedP = " + FOR_SALE + "old.items);", "the snapshot start");
  const set = at(src, "const set: Record<string, unknown> = {", "the $set build");
  const assign = at(src, "Object.assign(set, " + FIELDS + "await stockUsedP));", "the snapshot joining the $set");
  const update = at(src, "const update: Record<string, unknown> = { $set: set };", "the update document");
  const cas = at(src, "Order.findOneAndUpdate(filter", "the settle CAS");
  assert.ok(refusal < start && start < set, "started after the money refusals, before the $set");
  assert.ok(set < assign && assign < update && update < cas, "inside the $set, before the CAS - never after it");
  assert.equal(count(src, FIELDS), 1);
  assert.equal(count(src, FOR_SALE), 1);
  assert.equal(count(src, MOVE), 0, "the route never moves stock itself; the follow-up does, after the win");
});

test("PIN settle follow-ups: the move takes the CAS's stored snapshot (sign STOCK_TAKE) inside the one allSettled wave", () => {
  const src = read(SETTLE_FOLLOW);
  const wave = at(src, "await Promise.allSettled([", "the wave");
  const close = at(src, "]);", "the wave's close", wave);
  const move = at(src, "deps." + MOVE + "updated.stockUsed, STOCK_TAKE)", "the move");
  assert.ok(wave < move && move < close, "the move is a member of the wave");
  assert.ok(src.includes("updated.stockUsed?.length ? deps." + MOVE), "gated on a stored snapshot");
});

test("PIN create: the snapshot is gated on a Pay Now (Completed) create and rides the insert doc", () => {
  const src = read(CREATE);
  const call = at(src, "const stockUsed = data.status === \"Completed\" ? await " + FOR_SALE + "rewardItems, products) : undefined;", "the gated call");
  const docOpen = at(src, "const unnumberedDoc = {", "the insert doc") + "const unnumberedDoc = ".length;
  const docClose = closeOf(src, docOpen);
  const fields = at(src, "..." + FIELDS + "stockUsed),", "the spread");
  assert.ok(call < docOpen, "worked out before the doc");
  assert.ok(docOpen < fields && fields < docClose, "the spread is INSIDE unnumberedDoc (proved by where it closes)");
  assert.ok(at(src, "const doc = { ...unnumberedDoc, ...slips };", "landmark: the doc both inserts send") > docClose);
  assert.equal(count(src, FOR_SALE), 1);
  assert.equal(count(src, FIELDS), 1);
  assert.ok(src.includes("price discount available isActive stockUse\")"), "the create read carries stockUse (no extra read)");
});

test("PIN create follow-ups: the move runs only for a Completed landed order, inside the wave", () => {
  const src = read(CREATE_FOLLOW);
  const wave = at(src, "await Promise.allSettled([", "the wave");
  const close = at(src, "]);", "the wave's close", wave);
  const gate = at(src, "landed.status === ORDER_STATUS_COMPLETED && landed.stockUsed?.length", "the Completed gate");
  const move = at(src, "deps." + MOVE + "landed.stockUsed, STOCK_TAKE)", "the move");
  assert.ok(wave < gate && gate < move && move < close);
});

test("PIN cancel: the add-back, then the stamp / card / points give-backs, run after the CAS landed and BEFORE the ledger", () => {
  const src = read(CANCEL);
  const miss = at(src, "if (!updated) return failure(", "the CAS miss");
  const addBack = at(src, "if (old.status === \"Completed\" && updated.stockUsed?.length) await " + ADD_BACK + "updated.stockUsed);", "the gated add-back");
  const stamps = at(src, "const returned = await returnRewardStamps(rewardCustomer, updated.orderId, rewardCost);", "the stamp give-back");
  const card = at(src, "if (await releaseRewardCard(rewardCustomer, updated.rewardCardId, updated.orderId)) cache.del(\"customers\");", "the card give-back");
  const points = at(src, "if (await returnPoints(rewardCustomer, updated.orderId)) cache.del(\"customers\");", "the points give-back");
  // Owner decision s113: a ledger throw is a 500 whose retry meets the "already cancelled" 409, so nothing after the
  // ledger reversal is guaranteed to run. Every give-back sits above it (live legs k1-k3 throw the ledger for real).
  const ledger = at(src, "const touched = await reconcileLedger(old, updated);", "the ledger reversal");
  assert.ok(miss < addBack && addBack < stamps && stamps < card && card < points && points < ledger);
  assert.equal(src.slice(at(src, "try {", "the follow-up try", miss) + "try {".length, addBack).replace(/\/\/[^\n]*/g, "").trim(), "", "nothing but comments between the try and the add-back");
  const giveBacks = at(src, "const rewardCustomer = validCustomer(", "landmark: the give-backs' first statement");
  const top = depthAt(src, addBack);
  assert.equal(depthAt(src, giveBacks), top, "the give-backs sit at the follow-ups' own depth");
  assert.equal(depthAt(src, at(src, "if (rewardCustomer && updated.rewardCardId) {", "the card block")), top, "the card block is not nested in the stamp block");
  assert.equal(depthAt(src, at(src, "if (rewardCustomer && updated.rewardPoints !== undefined) {", "the points block")), top, "the points block is not nested in the card block");
  assert.equal(depthAt(src, ledger), top, "the ledger is not inside a give-back's swallowing try (its failure still answers 500)");
  assert.equal(count(src, ADD_BACK), 1);
  assert.equal(count(src, "reconcileLedger("), 1);
});

test("PIN DELETE: the add-back runs only after the delete removed the row, off `deleted`, gated on Completed", () => {
  const all = read(ORDER_ID);
  const src = all.slice(at(all, "export async function DELETE(", "the DELETE handler"));
  const removed = at(src, "if (!deleted)", "the delete guard");
  const addBack = at(src, "if (deleted.status === \"Completed\" && deleted.stockUsed?.length) await " + ADD_BACK + "deleted.stockUsed);", "the gated add-back");
  const ledger = at(src, "reconcileLedger(order, null)", "landmark: the ledger reversal");
  assert.ok(removed < addBack && addBack < ledger);
  assert.equal(count(all, ADD_BACK), 1, "the PUT never adds stock back");
});

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

test("PIN writer census: who works out the snapshot and who moves stock", () => {
  const files = [...sources("app"), ...sources("lib")];
  assert.ok(files.includes(SETTLE) && files.includes(STOCK_MOVE), "landmark: the walk sees routes and lib/inventory");
  const holders = (needle: string) => files.filter((f) => read(f).includes(needle)).sort();
  assert.deepEqual(holders(FIELDS), [CREATE, SETTLE, STOCK_USE].sort());
  assert.deepEqual(holders(FOR_SALE), [CREATE, SETTLE, STOCK_USE].sort());
  // Slice 4 moved this on purpose: a wastage and the delete of an entry are the second, manual, stock writer.
  assert.deepEqual(holders(MOVE), [CREATE_FOLLOW, ENTRIES_WRITE, SETTLE_FOLLOW, STOCK_MOVE].sort());
  assert.deepEqual(holders(ADD_BACK), [CANCEL, ORDER_ID, STOCK_MOVE].sort());
});

test("PIN D3: no inventory code mentions the menu item's on/off flag (raw bytes, comments included)", () => {
  const banned = "avail" + "able";
  const files = [...sources("lib/inventory"), "models/StockItem.ts"];
  assert.ok(files.includes(STOCK_USE) && files.includes(STOCK_MOVE), "landmark: the scan sees lib/inventory");
  for (const f of files) assert.equal(raw(f).includes(banned), false, `${f} must never mention it`);
  assert.ok(raw(CREATE).includes(banned), "landmark: the needle does match a real file");
});

test("PIN cache: PRODUCT_LIST stays full docs (no select), so a cached row carries stockUse; the peek uses its key", () => {
  const masters = read("lib/masters.ts");
  const open = at(masters, "export const PRODUCT_LIST: MasterListSpec<IProduct> = {", "PRODUCT_LIST") + "export const PRODUCT_LIST: MasterListSpec<IProduct> = ".length;
  const spec = masters.slice(open, closeOf(masters, open));
  assert.ok(spec.includes('cacheKey: "products"'), "landmark: this is the products spec");
  assert.equal(spec.includes("select"), false, "no projection on the products list");
  assert.ok(masters.includes('select: "-password"'), "landmark: a spec select looks like this (staff)");
  const use = read(STOCK_USE);
  assert.ok(use.includes("cache.get<LeanRow<IProduct>[]>(PRODUCT_LIST.cacheKey)"), "the peek reads the same key and row shape");
  assert.ok(use.includes('Product.find({ _id: { $in: ids }, stockUse: { $exists: true } }).select("stockUse").lean()'), "the one targeted read");
});

test("PIN public menu: the diner payload never mentions stockUse", () => {
  const src = raw("lib/public-menu.ts");
  assert.ok(src.includes("toPublicMenuItem"), "landmark: the public menu boundary");
  assert.equal(src.includes("stock" + "Use"), false);
});
