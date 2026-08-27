import { test } from "node:test";
import assert from "node:assert/strict";
import { addItemsSchema, moveOrderTableSchema } from "./order.schema";

// ── Defect 2 regression (owner decision 2026-08-16) ──────────────────────────
// "A charge waived on a resumed tab was silently discarded when the next KOT
// round was fired." Before the fix, addItemsSchema was `.strict()` with only
// `items` + `discount` — there was no field on this payload that could carry a
// waived charge at all, so POST /api/orders/[id]/items always fell back to the
// tab's ORIGINAL stored chargeAmount no matter what the operator had just done
// at the counter. These pins are on the SCHEMA seam only: chargeAmount must be
// accepted, must stay genuinely optional (omit = unchanged, exactly like
// discount), must still reject a negative value, and — just as important — the
// `.strict()` guard that used to make this payload uncarryable must keep
// rejecting an unknown/misspelled key.

const sampleItems = [{ productId: "p1", name: "Chai", price: 20, qty: 1 }];

test("addItemsSchema accepts chargeAmount: 0 — this is the waiver the reported bug could not send", () => {
  const r = addItemsSchema.safeParse({ items: sampleItems, chargeAmount: 0 });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.chargeAmount, 0);
});

test("addItemsSchema accepts a positive chargeAmount", () => {
  const r = addItemsSchema.safeParse({ items: sampleItems, chargeAmount: 50 });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.chargeAmount, 50);
});

test("addItemsSchema rejects a negative chargeAmount", () => {
  assert.equal(addItemsSchema.safeParse({ items: sampleItems, chargeAmount: -1 }).success, false);
});

// The guard that made the original payload unable to carry a waiver at all —
// it must keep rejecting an unknown key, including a typo of the new field
// itself, or a client could smuggle arbitrary data through /items unnoticed.
test("addItemsSchema still rejects an unknown key — .strict() is intact", () => {
  assert.equal(
    addItemsSchema.safeParse({ items: sampleItems, chargeamount: 50 }).success,
    false,
    "a misspelled 'chargeamount' must not silently pass through as an unknown key",
  );
  assert.equal(
    addItemsSchema.safeParse({ items: sampleItems, extra: "nope" }).success,
    false,
  );
});

// The whole omit-means-unchanged contract (same rule as `discount`) rests on
// undefined and 0 being genuinely different values — a payload that never
// mentions chargeAmount must parse to undefined, NOT silently coerce to 0,
// or the route could not tell "leave it alone" apart from "waive it".
test("addItemsSchema: chargeAmount is genuinely optional — omitting it parses to undefined, not 0", () => {
  const r = addItemsSchema.safeParse({ items: sampleItems });
  assert.equal(r.success, true);
  if (!r.success) return;
  assert.equal(r.data.chargeAmount, undefined);
  assert.notEqual(r.data.chargeAmount, 0);
});

test("addItemsSchema still requires at least one item and rejects an empty cart", () => {
  assert.equal(addItemsSchema.safeParse({ items: [] }).success, false);
});

// ── moveOrderTableSchema (POST /api/orders/[id]/table) ───────────────────────
// Moving a tab to another table is SEATING, not billing. The payload carries the
// destination name and nothing else: the order's table-charge snapshot is frozen
// at sale time, so if any money field were accepted here a move could re-price a
// bill the kitchen already served. `.strict()` is the whole guarantee — these
// pins fail the moment someone widens this payload.

test("moveOrderTableSchema accepts a destination table name and trims it", () => {
  const r = moveOrderTableSchema.safeParse({ tableNo: "  Rooftop 2  " });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.tableNo, "Rooftop 2");
});

test("moveOrderTableSchema requires a destination — a move to nowhere is not a move", () => {
  assert.equal(moveOrderTableSchema.safeParse({}).success, false);
  assert.equal(moveOrderTableSchema.safeParse({ tableNo: "" }).success, false);
  assert.equal(moveOrderTableSchema.safeParse({ tableNo: "   " }).success, false);
});

test("moveOrderTableSchema refuses to carry money — no charge/discount/total can ride along with a seating change", () => {
  for (const extra of [
    { chargeAmount: 0 },
    { chargeAmount: 100 },
    { chargeLabel: "Garden" },
    { discount: 50 },
    { total: 999 },
    { paidAmount: 999 },
  ]) {
    assert.equal(
      moveOrderTableSchema.safeParse({ tableNo: "T-1", ...extra }).success,
      false,
      `${JSON.stringify(extra)} must be rejected — a move never re-prices the bill`,
    );
  }
});

test("moveOrderTableSchema holds the destination to the tableNo charset (it becomes a stored join key)", () => {
  assert.equal(moveOrderTableSchema.safeParse({ tableNo: "bad/name" }).success, false);
});
