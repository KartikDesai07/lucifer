import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paiseToRupees,
  rupeesToPaise,
  idToString,
  decodeOrder,
  encodeOrderForWrite,
  type StoredOrder,
} from "./codec";

// ── Money primitives ──────────────────────────────────────────────────────────

test("paiseToRupees / rupeesToPaise round-trip exactly", () => {
  for (const paise of [0, 5, 100, 1999, 12050, 99999, 2_140_000_000]) {
    assert.equal(rupeesToPaise(paiseToRupees(paise)), paise);
  }
});

test("rupeesToPaise is binary-float safe", () => {
  assert.equal(rupeesToPaise(19.99), 1999); // 19.99 * 100 === 1998.9999999999998 in IEEE-754
  assert.equal(rupeesToPaise(120.5), 12050);
  assert.equal(rupeesToPaise(0.1 + 0.2), 30); // 0.30000000000000004
  assert.equal(rupeesToPaise(0), 0);
});

test("idToString normalizes ObjectId-like / string / nullish", () => {
  assert.equal(idToString("507f1f77bcf86cd799439011"), "507f1f77bcf86cd799439011");
  assert.equal(idToString({ toString: () => "abc123" }), "abc123"); // ObjectId.toString() shape
  assert.equal(idToString(null), undefined);
  assert.equal(idToString(undefined), undefined);
});

// ── Decode (compact store → readable DTO) ──────────────────────────────────────

// A minimal walk-in cash order: omit-empty means NO discount/gst/split/modifiers/
// customer/table are stored at all (#8). The codec must still present full data.
const MINIMAL: StoredOrder = {
  _id: "ORD-A-20260629-001",
  customerName: "Walk-in",
  items: [{ productId: "507f1f77bcf86cd799439011", name: "Cold Coffee", price: 12000, qty: 2 }],
  subtotal: 24000,
  total: 24000,
  paidAmount: 24000,
  payment: "Cash",
  status: "Completed",
  receiver: "Rahul",
  v: 1,
};

test("decodeOrder restores omit-empty defaults and converts paise→rupees", () => {
  const d = decodeOrder(MINIMAL);
  assert.equal(d.orderId, "ORD-A-20260629-001");
  assert.equal(d.subtotal, 240);
  assert.equal(d.total, 240);
  assert.equal(d.paidAmount, 240);
  assert.equal(d.discount, 0); // absent in store → 0 in DTO (#8)
  assert.equal(d.kotRounds, 0);
  assert.equal(d.frozen, false);
  // Genuinely-optional fields stay absent (UI distinguishes "no GST" from a 0).
  assert.equal(d.gstAmount, undefined);
  assert.equal(d.gstRate, undefined);
  assert.equal(d.customerId, undefined);
  assert.equal(d.tableNo, undefined);
  assert.equal(d.splitCash, undefined);
  assert.equal(d.settledAt, undefined);
  // Item presentation defaults restored.
  assert.deepEqual(d.items[0].modifiers, []);
  assert.equal(d.items[0].instructions, "");
  assert.equal(d.items[0].kotRound, 0);
  assert.equal(d.items[0].price, 120);
  assert.equal(d.items[0].productId, "507f1f77bcf86cd799439011");
});

const FULL: StoredOrder = {
  _id: "ORD-A-20260629-014",
  customerId: "507f191e810c19729de860ea",
  customerName: "Priya",
  items: [
    {
      productId: "507f1f77bcf86cd799439011",
      name: "Margherita",
      price: 40000,
      qty: 2,
      modifiers: ["Extra Cheese"],
      instructions: "no onion",
      kotRound: 1,
    },
  ],
  subtotal: 80000,
  total: 84000,
  paidAmount: 84000,
  discount: 5000,
  gstAmount: 4000,
  gstRate: 5,
  gstMode: "exclusive",
  payment: "Split",
  status: "Completed",
  splitCash: 40000,
  splitOnline: 44000,
  receiver: "Rahul",
  tableNo: "T-3",
  notes: "birthday",
  kotRounds: 2,
  settledAt: new Date("2026-06-29T09:00:00.000Z"),
  frozen: true,
  source: "swiggy",
  externalRef: "SWG-99",
  v: 1,
};

test("decodeOrder surfaces all present optionals at the right scale", () => {
  const d = decodeOrder(FULL);
  assert.equal(d.customerId, "507f191e810c19729de860ea");
  assert.equal(d.discount, 50);
  assert.equal(d.gstAmount, 40);
  assert.equal(d.gstRate, 5); // whole percent, not scaled (#38)
  assert.equal(d.gstMode, "exclusive");
  assert.equal(d.splitCash, 400);
  assert.equal(d.splitOnline, 440);
  assert.equal(d.tableNo, "T-3");
  assert.equal(d.notes, "birthday");
  assert.equal(d.kotRounds, 2);
  assert.equal(d.frozen, true);
  assert.equal(d.source, "swiggy");
  assert.equal(d.externalRef, "SWG-99");
  assert.equal(d.settledAt, "2026-06-29T09:00:00.000Z");
  assert.deepEqual(d.items[0].modifiers, ["Extra Cheese"]);
  assert.equal(d.items[0].instructions, "no onion");
  assert.equal(d.items[0].kotRound, 1);
});

test("decodeOrder treats a pre-`v` legacy doc as v1 (migrate-on-read seam)", () => {
  const legacy = { ...MINIMAL };
  delete (legacy as { v?: number }).v;
  const d = decodeOrder(legacy);
  assert.equal(d.v, 1);
  assert.equal(d.total, 240);
});

// ── Encode (rupee input → compact store) ──────────────────────────────────────

test("encodeOrderForWrite omits empties and writes paise", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Cold Coffee", price: 120, qty: 2 }],
    subtotal: 240,
    total: 240,
    paidAmount: 240,
    payment: "Cash",
    receiver: "Rahul",
  });
  assert.equal(stored.subtotal, 24000);
  assert.equal(stored.total, 24000);
  assert.equal(stored.paidAmount, 24000);
  // omit-empty: no discount/gst/split/customer/table keys are materialized (#8).
  assert.ok(!("discount" in stored));
  assert.ok(!("gstAmount" in stored));
  assert.ok(!("gstRate" in stored));
  assert.ok(!("splitCash" in stored));
  assert.ok(!("customerId" in stored));
  assert.ok(!("tableNo" in stored));
  // item omit-empty too.
  assert.ok(!("modifiers" in stored.items![0]));
  assert.ok(!("instructions" in stored.items![0]));
  assert.ok(!("kotRound" in stored.items![0]));
});

test("encodeOrderForWrite carries present optionals as paise", () => {
  const stored = encodeOrderForWrite({
    customerId: "507f191e810c19729de860ea",
    customerName: "Priya",
    items: [{ productId: "507f1f77bcf86cd799439011", name: "Margherita", price: 400, qty: 2, modifiers: ["Extra Cheese"], kotRound: 1 }],
    subtotal: 800,
    total: 840,
    paidAmount: 840,
    discount: 50,
    gstAmount: 40,
    gstRate: 5,
    gstMode: "exclusive",
    payment: "Split",
    splitCash: 400,
    splitOnline: 440,
    receiver: "Rahul",
    tableNo: "T-3",
  });
  assert.equal(stored.discount, 5000);
  assert.equal(stored.gstAmount, 4000);
  assert.equal(stored.gstRate, 5);
  assert.equal(stored.splitCash, 40000);
  assert.equal(stored.splitOnline, 44000);
  assert.equal(stored.customerId, "507f191e810c19729de860ea"); // string — Mongoose casts to ObjectId on write
  assert.deepEqual(stored.items![0].modifiers, ["Extra Cheese"]);
  assert.equal(stored.items![0].kotRound, 1);
});

test("encodeOrderForWrite gates split legs on Split payment (#8 omit-empty)", () => {
  // A non-Split order with stray split zeros must leak NO split keys.
  const cash = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 120,
    paidAmount: 120,
    payment: "Cash",
    receiver: "Rahul",
    splitCash: 0,
    splitOnline: 0,
  });
  assert.ok(!("splitCash" in cash));
  assert.ok(!("splitOnline" in cash));
  // An all-online Split keeps BOTH legs, including the legitimate 0 cash leg.
  const split = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 120,
    paidAmount: 120,
    payment: "Split",
    receiver: "Rahul",
    splitCash: 0,
    splitOnline: 120,
  });
  assert.equal(split.splitCash, 0);
  assert.equal(split.splitOnline, 12000);
});

// ── Table charge (owner decision 2026-08-16) ─────────────────────────────────
// Amount and label travel together or not at all — the amount is the gate. A
// stored label with no amount would print a named line worth nothing; an
// amount with no label would print a bare figure the customer cannot question.

test("encodeOrderForWrite: chargeAmount 50 + a label are stored as 5000 paise + the label", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 170,
    paidAmount: 170,
    payment: "Cash",
    receiver: "Rahul",
    chargeAmount: 50,
    chargeLabel: "Rooftop charge",
  });
  assert.equal(stored.chargeAmount, 5000);
  assert.equal(stored.chargeLabel, "Rooftop charge");
});

test("encodeOrderForWrite: chargeAmount 0 or absent omits BOTH fields (omit-empty)", () => {
  const withZero = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 120,
    paidAmount: 120,
    payment: "Cash",
    receiver: "Rahul",
    chargeAmount: 0,
    chargeLabel: "Rooftop charge",
  });
  assert.ok(!("chargeAmount" in withZero), "chargeAmount: 0 must not be stored");
  assert.ok(!("chargeLabel" in withZero), "a 0 charge must take its label with it");

  const absent = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 120,
    paidAmount: 120,
    payment: "Cash",
    receiver: "Rahul",
  });
  assert.ok(!("chargeAmount" in absent));
  assert.ok(!("chargeLabel" in absent));
});

test("encodeOrderForWrite: a label with NO amount stores NEITHER field — the amount gates the label", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 120,
    paidAmount: 120,
    payment: "Cash",
    receiver: "Rahul",
    chargeLabel: "Rooftop charge", // no chargeAmount supplied at all
  });
  assert.ok(!("chargeAmount" in stored));
  assert.ok(
    !("chargeLabel" in stored),
    "a label alone must never land in storage — an amount-less label is not a charge",
  );
});

test("decodeOrder: chargeAmount decodes paise -> rupees, alongside chargeLabel", () => {
  const d = decodeOrder({
    ...MINIMAL,
    chargeAmount: 5000,
    chargeLabel: "Rooftop charge",
  });
  assert.equal(d.chargeAmount, 50);
  assert.equal(d.chargeLabel, "Rooftop charge");
});

test("decodeOrder: chargeAmount and chargeLabel both ABSENT in storage stay undefined on the DTO", () => {
  const d = decodeOrder(MINIMAL);
  assert.equal(d.chargeAmount, undefined);
  assert.equal(d.chargeLabel, undefined);
});

test("encode∘decode round-trips the table charge, preserving both amount and label", () => {
  const roundTripped = decodeOrder({
    ...(encodeOrderForWrite({
      customerName: "Walk-in",
      items: [{ name: "Coffee", price: 120, qty: 1 }],
      subtotal: 120,
      total: 170,
      paidAmount: 170,
      payment: "Cash",
      receiver: "Rahul",
      chargeAmount: 50,
      chargeLabel: "Rooftop charge",
    }) as StoredOrder),
    _id: "ORD-A-20260629-002",
    status: "Completed",
    v: 1,
  });
  assert.equal(roundTripped.chargeAmount, 50);
  assert.equal(roundTripped.chargeLabel, "Rooftop charge");
});

test("encode∘decode is stable on money", () => {
  const roundTripped = decodeOrder({
    ...(encodeOrderForWrite({
      customerName: "Priya",
      items: [{ name: "Margherita", price: 400, qty: 2 }],
      subtotal: 800,
      total: 840,
      paidAmount: 840,
      discount: 50,
      payment: "Cash",
      receiver: "Rahul",
    }) as StoredOrder),
    _id: "ORD-A-20260629-001",
    status: "Completed",
    v: 1,
  });
  assert.equal(roundTripped.subtotal, 800);
  assert.equal(roundTripped.total, 840);
  assert.equal(roundTripped.discount, 50);
});

// ── discountKind (CB-2, C2) — the amount gates the kind, same as chargeAmount
// gates chargeLabel ───────────────────────────────────────────────────────────

test("encodeOrderForWrite: discount:100 + discountKind:'gst' stores the kind alongside the discount", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 20,
    paidAmount: 20,
    payment: "Cash",
    receiver: "Rahul",
    discount: 100,
    discountKind: "gst",
  });
  assert.equal(stored.discount, 10000);
  assert.equal(stored.discountKind, "gst");
});

test("encodeOrderForWrite: discount:0 + discountKind:'gst' OMITS the kind — the amount gates the kind", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 120,
    paidAmount: 120,
    payment: "Cash",
    receiver: "Rahul",
    discount: 0,
    discountKind: "gst",
  });
  assert.ok(!("discount" in stored), "discount:0 must not be stored (omit-empty)");
  assert.ok(!("discountKind" in stored), "a 0 discount must take its kind with it, exactly like chargeAmount/chargeLabel");
});

test("encodeOrderForWrite: discountKind:'gst' with NO discount amount at all stores neither field", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 120,
    paidAmount: 120,
    payment: "Cash",
    receiver: "Rahul",
    discountKind: "gst", // no discount supplied at all
  });
  assert.ok(!("discount" in stored));
  assert.ok(!("discountKind" in stored), "a kind alone must never land in storage — an amount-less kind is not a discount");
});

test("decodeOrder: discountKind decodes straight across (no paise conversion — it is an enum, not money)", () => {
  const d = decodeOrder({ ...MINIMAL, discount: 10000, discountKind: "gst" });
  assert.equal(d.discountKind, "gst");
});

test("decodeOrder: a stored doc with discountKind ABSENT yields no discountKind key on the DTO", () => {
  const d = decodeOrder(MINIMAL);
  assert.ok(!("discountKind" in d), "an old order with no discountKind field must decode to no key at all, not undefined-but-present");
});

test("encode-then-decode round-trips discount:100 + discountKind:'gst', keeping the kind", () => {
  const roundTripped = decodeOrder({
    ...(encodeOrderForWrite({
      customerName: "Walk-in",
      items: [{ name: "Coffee", price: 120, qty: 1 }],
      subtotal: 120,
      total: 20,
      paidAmount: 20,
      payment: "Cash",
      receiver: "Rahul",
      discount: 100,
      discountKind: "gst",
    }) as StoredOrder),
    _id: "ORD-A-20260629-003",
    status: "Completed",
    v: 1,
  });
  assert.equal(roundTripped.discount, 100);
  assert.equal(roundTripped.discountKind, "gst");
});

test("encode-then-decode with discount:0 + discountKind:'gst': the kind never reaches storage, so it never reaches the decoded DTO either", () => {
  const roundTripped = decodeOrder({
    ...(encodeOrderForWrite({
      customerName: "Walk-in",
      items: [{ name: "Coffee", price: 120, qty: 1 }],
      subtotal: 120,
      total: 120,
      paidAmount: 120,
      payment: "Cash",
      receiver: "Rahul",
      discount: 0,
      discountKind: "gst",
    }) as StoredOrder),
    _id: "ORD-A-20260629-004",
    status: "Completed",
    v: 1,
  });
  assert.equal(roundTripped.discount, 0);
  assert.ok(!("discountKind" in roundTripped), "amount gates the kind through the FULL round-trip, not just at encode");
});

// ── CB-5B — the "reward" kind: same amount-gates-kind discipline as "gst",
// PLUS the five reward snapshot fields ride along with the kind ────────────

test("encodeOrderForWrite: discount:100 + discountKind:'reward' stores the kind AND the reward snapshot", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 20,
    paidAmount: 20,
    payment: "Cash",
    receiver: "Rahul",
    discount: 100,
    discountKind: "reward",
    rewardAt: 8,
    rewardKind: "flat",
    rewardValue: 100,
    rewardItem: "",
    rewardStamps: 8,
  });
  assert.equal(stored.discount, 10000);
  assert.equal(stored.discountKind, "reward");
  assert.equal(stored.rewardAt, 8);
  assert.equal(stored.rewardKind, "flat");
  assert.equal(stored.rewardValue, 100);
  assert.equal(stored.rewardItem, "");
  assert.equal(stored.rewardStamps, 8);
});

// D5 REVERSAL (2026-09-13): this used to assert the reward twin of the gst
// "amount gates the kind" pin — discount:0 dropped the kind AND the snapshot,
// exactly like "gst". That assumption is now FALSE for "reward": an item
// reward's amount is 0 BY DESIGN (the benefit is a free dish line, not rupees
// off the total — S12), so `shouldStoreDiscountKind` carries a documented
// exception that keeps "reward" storing regardless of amount. "gst" keeps the
// OLD behaviour verbatim (see the byte-identical 'gst'-scoped pin above).
test("encodeOrderForWrite: discount:0 + discountKind:'reward' STORES the kind and the full snapshot (D5 reversal exception)", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 120,
    paidAmount: 120,
    payment: "Cash",
    receiver: "Rahul",
    discount: 0,
    discountKind: "reward",
    rewardAt: 8,
    rewardKind: "item",
    rewardValue: 0,
    rewardItem: "Masala Chai",
    rewardStamps: 8,
  });
  assert.ok(!("discount" in stored), "discount:0 is still omitted — the exception is scoped to the KIND, not the amount field");
  assert.equal(stored.discountKind, "reward");
  assert.equal(stored.rewardAt, 8);
  assert.equal(stored.rewardKind, "item");
  assert.equal(stored.rewardValue, 0);
  assert.equal(stored.rewardItem, "Masala Chai");
  assert.equal(stored.rewardStamps, 8);
});

// Negative twin: the D5-reversal exception is about the AMOUNT gating the
// KIND, not about the snapshot fields gating each OTHER — an order whose
// snapshot fields were simply never supplied still omits them individually
// (the pre-existing per-field `if (input.rewardX !== undefined)` gates in
// encodeOrderForWrite are untouched by this slice).
test("encodeOrderForWrite: discountKind:'reward' with the snapshot fields omitted stores the kind but no snapshot keys", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 120,
    paidAmount: 120,
    payment: "Cash",
    receiver: "Rahul",
    discount: 0,
    discountKind: "reward",
    // rewardAt/rewardKind/rewardValue/rewardItem/rewardStamps all omitted.
  });
  assert.equal(stored.discountKind, "reward", "the kind still stores — the D5 exception does not depend on the snapshot being present");
  for (const key of ["rewardAt", "rewardKind", "rewardValue", "rewardItem", "rewardStamps"]) {
    assert.ok(!(key in stored), `${key} must stay omitted when the caller never supplied it`);
  }
});

test("encodeOrderForWrite: discountKind:'gst' carries NO reward fields even if the caller supplied them", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 20,
    paidAmount: 20,
    payment: "Cash",
    receiver: "Rahul",
    discount: 100,
    discountKind: "gst",
    rewardAt: 8,
    rewardKind: "flat",
    rewardValue: 100,
  });
  assert.equal(stored.discountKind, "gst");
  assert.ok(!("rewardAt" in stored), "the reward snapshot follows discountKind === 'reward', not any other kind");
});

test("decodeOrder: a 'reward' order decodes the kind AND the reward snapshot straight across", () => {
  const d = decodeOrder({
    ...MINIMAL,
    discount: 10000,
    discountKind: "reward",
    rewardAt: 8,
    rewardKind: "flat",
    rewardValue: 100,
    rewardItem: "",
    rewardStamps: 8,
  });
  assert.equal(d.discountKind, "reward");
  assert.equal(d.rewardAt, 8);
  assert.equal(d.rewardKind, "flat");
  assert.equal(d.rewardValue, 100);
  assert.equal(d.rewardItem, "");
  assert.equal(d.rewardStamps, 8);
});

test("decodeOrder: a stored doc with the reward fields ABSENT yields no reward keys on the DTO", () => {
  const d = decodeOrder(MINIMAL);
  for (const key of ["rewardAt", "rewardKind", "rewardValue", "rewardItem", "rewardStamps"]) {
    assert.ok(!(key in d), `${key} must be absent, not undefined-but-present, on an order with no reward`);
  }
});

test("encode-then-decode round-trips discount:100 + discountKind:'reward', keeping the kind and the snapshot", () => {
  const roundTripped = decodeOrder({
    ...(encodeOrderForWrite({
      customerName: "Walk-in",
      items: [{ name: "Coffee", price: 120, qty: 1 }],
      subtotal: 120,
      total: 20,
      paidAmount: 20,
      payment: "Cash",
      receiver: "Rahul",
      discount: 100,
      discountKind: "reward",
      rewardAt: 8,
      rewardKind: "percent",
      rewardValue: 10,
      rewardItem: "",
      rewardStamps: 8,
    }) as StoredOrder),
    _id: "ORD-A-20260629-005",
    status: "Completed",
    v: 1,
  });
  assert.equal(roundTripped.discount, 100);
  assert.equal(roundTripped.discountKind, "reward");
  assert.equal(roundTripped.rewardAt, 8);
  assert.equal(roundTripped.rewardKind, "percent");
  assert.equal(roundTripped.rewardValue, 10);
  assert.equal(roundTripped.rewardStamps, 8);
});

// D5 REVERSAL (2026-09-13) — the reward twin of the gst "kind alone never
// lands" round-trip pin does NOT hold for "reward": see the encode-side
// rewrite above. P-NEW-14 (snapshot survives at zero through encode-decode).
test("encode-then-decode with discount:0 + discountKind:'reward': the kind AND the snapshot SURVIVE the full round-trip (D5 reversal, P-NEW-14)", () => {
  const roundTripped = decodeOrder({
    ...(encodeOrderForWrite({
      customerName: "Walk-in",
      items: [{ name: "Coffee", price: 120, qty: 1 }],
      subtotal: 120,
      total: 120,
      paidAmount: 120,
      payment: "Cash",
      receiver: "Rahul",
      discount: 0,
      discountKind: "reward",
      rewardAt: 8,
      rewardKind: "item",
      rewardValue: 0,
      rewardItem: "Masala Chai",
      rewardStamps: 8,
    }) as StoredOrder),
    _id: "ORD-A-20260629-006",
    status: "Completed",
    v: 1,
  });
  assert.equal(roundTripped.discount, 0, "discount stays 0 on the DTO — the amount is genuinely 0, not $unset back to a default");
  assert.equal(roundTripped.discountKind, "reward");
  assert.equal(roundTripped.rewardAt, 8);
  assert.equal(roundTripped.rewardKind, "item");
  assert.equal(roundTripped.rewardValue, 0);
  assert.equal(roundTripped.rewardItem, "Masala Chai");
  assert.equal(roundTripped.rewardStamps, 8);
});

// ── CB-5B D8/D11 — the free dish's product REFERENCE + count round-trip ─────
// The whole point of D8 is that a reprint resolves the dish from an id, not a
// name. That only holds if the id actually survives storage, so encode AND
// decode are pinned together — a field added to one side only is the classic
// silent-omission bug (the reward would print with no dish behind it).

test("D8/D11: rewardItemProductId + rewardQty survive encode -> decode at discount 0", () => {
  const stored = encodeOrderForWrite({
    customerName: "Walk-in",
    items: [{ name: "Coffee", price: 120, qty: 1 }],
    subtotal: 120,
    total: 120,
    paidAmount: 120,
    payment: "Cash",
    receiver: "Rahul",
    discount: 0,
    discountKind: "reward",
    rewardAt: 8,
    rewardKind: "item",
    rewardValue: 0,
    rewardItem: "Masala Chai",
    rewardItemProductId: "60a1b2c3d4e5f60718293a4b",
    rewardQty: 2,
    rewardStamps: 8,
  });
  assert.equal(stored.rewardItemProductId, "60a1b2c3d4e5f60718293a4b", "the REFERENCE must reach storage");
  assert.equal(stored.rewardQty, 2, "the dish count must reach storage");

  // encodeOrderForWrite yields a Partial (Mongo assigns _id), so the round
  // trip supplies the id the way a real read would.
  const decoded = decodeOrder({ ...MINIMAL, ...stored });
  assert.equal(decoded.rewardItemProductId, "60a1b2c3d4e5f60718293a4b", "and come back unchanged");
  assert.equal(decoded.rewardQty, 2);
});

test("D8/D11: a pre-D8 stored order decodes with NEITHER field present", () => {
  // Absence must stay absence: a reader decides "can I rebuild the dish line?"
  // by asking whether the ref is there. A defaulted "" or 1 would lie.
  const decoded = decodeOrder({
    ...MINIMAL,
    discountKind: "reward",
    rewardAt: 8,
    rewardKind: "item",
    rewardValue: 0,
    rewardItem: "Masala Chai",
    rewardStamps: 8,
  });
  assert.ok(!("rewardItemProductId" in decoded), "no ref stored means no ref decoded");
  assert.ok(!("rewardQty" in decoded), "no count stored means no count decoded");
});
