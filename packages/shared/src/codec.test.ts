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
