import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCharges,
  chargesTotal,
  chargeMirror,
  chargesFromOrder,
  withTableCharge,
  applyExtraCharges,
  DEFAULT_TABLE_CHARGE_LABEL,
  type OrderCharge,
} from "@pos/shared/order-charges";
import { splitChargeTotals } from "@pos/shared/order-charges";
import { TABLE_CHARGE_MAX } from "@/lib/constants";
import { chargeWriteFields } from "./order-charges-write";
import { computeOrderTotals, type GstConfig } from "@/lib/receipt";

const cfg: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
const items = [{ price: 500, qty: 2 }];

// Pin 1 — at most ONE type:"table" entry; a second is dropped.
test("normalizeCharges: drops a second table entry", () => {
  const out = normalizeCharges([
    { type: "table", label: "Rooftop", amount: 50 },
    { type: "table", label: "Duplicate", amount: 99 },
  ]);
  assert.deepEqual(out, [{ type: "table", label: "Rooftop", amount: 50 }]);
});

// Pin 2 — zero-amount / blank-label entries are dropped (inherits
// tableChargeOf's shipped rule: amount gates the label).
test("normalizeCharges: drops zero-amount and blank-label entries", () => {
  const out = normalizeCharges([
    { type: "extra", label: "Packing", amount: 0 },
    { type: "extra", label: "   ", amount: 30 },
    { type: "extra", label: "Valid", amount: 20 },
  ]);
  assert.deepEqual(out, [{ type: "extra", label: "Valid", amount: 20 }]);
});

// Pin 3 — owner decision 8 (2026-09-25): NO cap on an extra's amount or on
// the count/sum. A large amount survives intact and the sum is not truncated.
test("normalizeCharges/chargesTotal: NO CAP (owner decision 8) — a large extra survives and the sum is not truncated", () => {
  const bigAmount = 999_999;
  const out = normalizeCharges([{ type: "extra", label: "Private event", amount: bigAmount }]);
  assert.deepEqual(out, [{ type: "extra", label: "Private event", amount: bigAmount }]);
  assert.equal(chargesTotal(out), bigAmount, "no upper ceiling — decision 8");
});

// Pin 4 — withTableCharge never touches extras (the owner's headline
// invariant, "a move must not destroy a takeaway charge", at helper level).
test("withTableCharge: replaces/removes ONLY the table entry, never touches extras", () => {
  const before: OrderCharge[] = [
    { type: "table", label: "Old table", amount: 50 },
    { type: "extra", label: "Takeaway", amount: 30 },
  ];
  const replaced = withTableCharge(before, { label: "New table", amount: 100 });
  assert.deepEqual(replaced, [
    { type: "table", label: "New table", amount: 100 },
    { type: "extra", label: "Takeaway", amount: 30 },
  ]);
  const removed = withTableCharge(before, null);
  assert.deepEqual(removed, [{ type: "extra", label: "Takeaway", amount: 30 }]);
});

// Pin 5 — reciprocal: applyExtraCharges never touches the table entry.
test("applyExtraCharges: replaces the whole extra set, never touches the table entry", () => {
  const before: OrderCharge[] = [
    { type: "table", label: "Rooftop", amount: 50 },
    { type: "extra", label: "Old extra", amount: 10 },
  ];
  const out = applyExtraCharges(before, [{ label: "New extra", amount: 40 }]);
  assert.deepEqual(out, [
    { type: "table", label: "Rooftop", amount: 50 },
    { type: "extra", label: "New extra", amount: 40 },
  ]);
});

// Pin 6 — legacy equivalence: computeOrderTotals over a derived legacy charge
// deepEquals the same call with the raw scalar. This is what makes
// chargesFromOrder's "upgrade in place" money-neutral by construction.
test("chargesFromOrder + computeOrderTotals: a legacy scalar charge is money-equivalent to its derived charges[]", () => {
  const legacyOrder = { chargeAmount: 50, chargeLabel: "Rooftop charge" };
  const derived = chargesFromOrder(legacyOrder);
  const viaLegacyScalar = computeOrderTotals({
    items,
    discount: 0,
    discountKind: undefined,
    charge: legacyOrder.chargeAmount,
    cfg,
  });
  const viaDerivedCharges = computeOrderTotals({
    items,
    discount: 0,
    discountKind: undefined,
    charge: chargesTotal(derived),
    cfg,
  });
  assert.deepEqual(viaDerivedCharges, viaLegacyScalar);
});

// Pin 7 — chargesFromOrder prefers charges[] when both exist.
test("chargesFromOrder: prefers charges[] over the legacy scalars when both exist", () => {
  const order = {
    charges: [{ type: "table" as const, label: "New style", amount: 75 }],
    chargeAmount: 999,
    chargeLabel: "Stale scalar",
  };
  assert.deepEqual(chargesFromOrder(order), [{ type: "table", label: "New style", amount: 75 }]);
});

test("chargesFromOrder: no charges[] and no positive chargeAmount -> []", () => {
  assert.deepEqual(chargesFromOrder({}), []);
  assert.deepEqual(chargesFromOrder({ chargeAmount: 0 }), []);
});

test("chargesFromOrder: legacy scalar with no chargeLabel falls back to the shipped renderers' fallback string", () => {
  const out = chargesFromOrder({ chargeAmount: 40 });
  assert.deepEqual(out, [{ type: "table", label: DEFAULT_TABLE_CHARGE_LABEL, amount: 40 }]);
});

// Pin 8 — chargeMirror label selection: table entry's label if present, else
// the first entry's; total is the sum.
test("chargeMirror: prefers the table entry's label, else the first entry's", () => {
  const withTable = chargeMirror([
    { type: "extra", label: "Packing", amount: 10 },
    { type: "table", label: "Rooftop", amount: 50 },
  ]);
  assert.deepEqual(withTable, { amount: 60, label: "Rooftop" });

  const extrasOnly = chargeMirror([
    { type: "extra", label: "Takeaway", amount: 30 },
    { type: "extra", label: "Packing", amount: 10 },
  ]);
  assert.deepEqual(extrasOnly, { amount: 40, label: "Takeaway" });
});

// Pin 9 — chargeWriteFields([]) $unsets all three; NEVER chargeAmount: 0. A
// named ₹0 line must never print.
test("chargeWriteFields([]): $unsets charges/chargeAmount/chargeLabel, never writes chargeAmount: 0", () => {
  const fields = chargeWriteFields([]);
  assert.deepEqual(fields, { unset: { charges: "", chargeAmount: "", chargeLabel: "" } });
  assert.equal(fields.set, undefined, "no $set branch alongside $unset");
});

test("chargeWriteFields(entries): $sets charges + the derived mirror", () => {
  const charges: OrderCharge[] = [
    { type: "table", label: "Rooftop", amount: 50 },
    { type: "extra", label: "Takeaway", amount: 30 },
  ];
  const fields = chargeWriteFields(charges);
  assert.equal(fields.unset, undefined, "no $unset branch alongside $set");
  assert.deepEqual(fields, {
    set: { charges, chargeAmount: 80, chargeLabel: "Rooftop" },
  });
});

// ── The clamp split (CB-CHG, found by the UI slice mid-build) ───────────────
// computeOrderTotals clamps the TABLE charge at TABLE_CHARGE_MAX — a shipped
// fence on an admin config. The plan originally said to feed the table+extras
// SUM through that one parameter, which would have silently capped a
// legitimate bill AND left the stored `total` disagreeing with the stored
// charges[]/chargeAmount (chargeMirror does not clamp). A customer billed one
// figure while the record says another is a money defect. Hence the split.

test("splitChargeTotals separates the clamped table portion from the uncapped extras", () => {
  const charges: OrderCharge[] = [
    { type: "table", label: "Rooftop", amount: 50 },
    { type: "extra", label: "Takeaway", amount: 30 },
    { type: "extra", label: "Delivery", amount: 20 },
  ];
  assert.deepEqual(splitChargeTotals(charges), { table: 50, extra: 50 });
  assert.deepEqual(splitChargeTotals([]), { table: 0, extra: 0 });
});

test("a large EXTRA is never capped, while the TABLE charge keeps its shipped ceiling", () => {
  const cfg: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };
  const items = [{ price: 100, qty: 1 }];

  // Owner decision 8: the extra is uncapped. A bill carrying a table charge
  // plus a big extra must total the FULL amount, not TABLE_CHARGE_MAX.
  const big = computeOrderTotals({
    items, discount: 0, discountKind: undefined,
    charge: 50, extraCharge: 250_000, cfg,
  });
  assert.equal(big.charge, 250_050, "the extra must ride on top uncapped");
  assert.equal(big.total, 250_150, "and the total must include all of it");

  // The TABLE charge's own ceiling is UNCHANGED — this is the shipped fence
  // that stays, and it must keep clamping.
  const overTable = computeOrderTotals({
    items, discount: 0, discountKind: undefined,
    charge: TABLE_CHARGE_MAX + 5_000, extraCharge: 0, cfg,
  });
  assert.equal(overTable.charge, TABLE_CHARGE_MAX, "the table charge is still clamped at its ceiling");
});

test("omitting extraCharge fails SAFE (adds nothing) and matches the pre-CB-CHG result exactly", () => {
  const cfg: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
  const items = [{ price: 200, qty: 2 }];
  const withoutKey = computeOrderTotals({ items, discount: 10, discountKind: undefined, charge: 50, cfg });
  const withZero = computeOrderTotals({ items, discount: 10, discountKind: undefined, charge: 50, extraCharge: 0, cfg });
  assert.deepEqual(withoutKey, withZero, "an omitted extraCharge must behave exactly like 0");
});
