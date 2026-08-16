import { test } from "node:test";
import assert from "node:assert/strict";
import { addItemsSchema } from "./order.schema";

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
