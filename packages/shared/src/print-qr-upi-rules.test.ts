import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MS_PER_MINUTE,
  PAY_QR_MINUTES_DEFAULT,
  UPI_RULES_MAX,
  UPI_RULE_UPTO_MAX,
  payQrPlan,
  upiIdForAmount,
  upiRulesOf,
  type PayQrInput,
  type UpiRule,
} from "./print-qr";

// UPI amount slabs: "bills up to X pay to A, up to Y to B, above that the main ID". A leg that changes only one
// thing from a printing bill, and the no-rules legs prove today's behaviour is untouched.
const MAIN = "samplecafe@okaxis";
const SMALL = "small.bills@ybl";
const MID = "mid.bills@paytm";
const RULES: UpiRule[] = [
  { upTo: 500, upiId: SMALL },
  { upTo: 2000, upiId: MID },
];
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const BASE: PayQrInput = {
  mode: "always",
  minutes: PAY_QR_MINUTES_DEFAULT,
  upiId: MAIN,
  upiRules: RULES,
  cancelled: false,
  total: 100,
  paid: 0,
  nowMs: NOW,
};
const plan = (over: Partial<PayQrInput> = {}) => payQrPlan({ ...BASE, ...over });

test("slab constants: at most 5 slabs, a limit up to 1,000,000 rupees", () => {
  assert.equal(UPI_RULES_MAX, 5);
  assert.equal(UPI_RULE_UPTO_MAX, 1_000_000);
});

test("upiIdForAmount: below and exactly at a limit use that slab, above the highest uses the main ID", () => {
  assert.equal(upiIdForAmount(1, RULES, MAIN), SMALL);
  assert.equal(upiIdForAmount(499.99, RULES, MAIN), SMALL);
  assert.equal(upiIdForAmount(500, RULES, MAIN), SMALL);
  assert.equal(upiIdForAmount(500.01, RULES, MAIN), MID);
  assert.equal(upiIdForAmount(2000, RULES, MAIN), MID);
  assert.equal(upiIdForAmount(2000.01, RULES, MAIN), MAIN);
});

test("upiIdForAmount: slabs given out of order still pick the lowest matching limit; no slabs gives the main ID", () => {
  const unsorted: UpiRule[] = [RULES[1], RULES[0]];
  assert.equal(upiIdForAmount(100, unsorted, MAIN), SMALL);
  assert.equal(upiIdForAmount(1000, unsorted, MAIN), MID);
  assert.equal(upiIdForAmount(5000, unsorted, MAIN), MAIN);
  assert.equal(upiIdForAmount(100, [], MAIN), MAIN);
});

test("upiRulesOf: keeps good slabs sorted ascending, trims the ID, and gives [] for a non-array", () => {
  assert.deepEqual(upiRulesOf([{ upTo: 2000, upiId: ` ${MID} ` }, { upTo: 500, upiId: SMALL }]), [
    { upTo: 500, upiId: SMALL },
    { upTo: 2000, upiId: MID },
  ]);
  for (const bad of [undefined, null, "x", 5, {}]) assert.deepEqual(upiRulesOf(bad), [], String(bad));
});

test("upiRulesOf: drops a bad limit, a bad or missing ID, and a non-object entry", () => {
  const dropped = [
    { upTo: 0, upiId: SMALL },
    { upTo: -5, upiId: SMALL },
    { upTo: 10.5, upiId: SMALL },
    { upTo: UPI_RULE_UPTO_MAX + 1, upiId: SMALL },
    { upTo: "500", upiId: SMALL },
    { upTo: 500, upiId: "no-at-sign" },
    { upTo: 500, upiId: "" },
    { upTo: 500 },
    null,
    "x",
  ];
  assert.deepEqual(upiRulesOf([...dropped, { upTo: UPI_RULE_UPTO_MAX, upiId: SMALL }]), [
    { upTo: UPI_RULE_UPTO_MAX, upiId: SMALL },
  ]);
});

test("upiRulesOf: a repeated limit keeps only the first stored, and the list is capped at 5", () => {
  assert.deepEqual(upiRulesOf([{ upTo: 500, upiId: SMALL }, { upTo: 500, upiId: MID }]), [{ upTo: 500, upiId: SMALL }]);
  const many = [100, 200, 300, 400, 500, 600, 700].map((upTo) => ({ upTo, upiId: SMALL }));
  const kept = upiRulesOf(many);
  assert.equal(kept.length, UPI_RULES_MAX);
  assert.deepEqual(kept.map((r) => r.upTo), [100, 200, 300, 400, 500]);
});

test("payQrPlan: the slab is picked by the QR amount and returned as upiId", () => {
  assert.equal(plan({ total: 100 })?.upiId, SMALL);
  assert.equal(plan({ total: 500 })?.upiId, SMALL);
  assert.equal(plan({ total: 501 })?.upiId, MID);
  assert.equal(plan({ total: 2000 })?.upiId, MID);
  assert.equal(plan({ total: 2001 })?.upiId, MAIN);
});

test("payQrPlan: a part-paid bill is sliced by what is still owed, not by the total; a fully paid one by the total", () => {
  // Total 2500 would be the main ID, but 300 is owed.
  assert.equal(plan({ total: 2500, paid: 2200 })?.amount, 300);
  assert.equal(plan({ total: 2500, paid: 2200 })?.upiId, SMALL);
  assert.equal(plan({ total: 2500, paid: 0 })?.upiId, MAIN);
  // Fully paid under "always": the QR asks the full total, so the total picks the slab.
  assert.equal(plan({ total: 300, paid: 300 })?.upiId, SMALL);
  assert.equal(plan({ total: 2500, paid: 2500 })?.upiId, MAIN);
});

test("payQrPlan: no slabs behaves as before, every QR pays to the main ID", () => {
  for (const total of [1, 500, 5000]) {
    assert.deepEqual(plan({ upiRules: [], total }), {
      amount: total,
      validTillMs: NOW + PAY_QR_MINUTES_DEFAULT * MS_PER_MINUTE,
      upiId: MAIN,
    });
  }
  assert.equal(plan({ upiRules: [], upiId: "" }), null);
  assert.equal(plan({ upiRules: [], upiId: "no-at-sign" }), null);
});

test("payQrPlan: a chosen slab ID that is not valid prints no pay QR; the other amounts still print", () => {
  const broken: UpiRule[] = [{ upTo: 500, upiId: "no-at-sign" }];
  assert.equal(plan({ upiRules: broken, total: 100 }), null);
  assert.notEqual(plan({ upiRules: broken, total: 600 }), null);
});

test("payQrPlan: the other rules (cancelled, never, owed, window) still apply with slabs", () => {
  assert.equal(plan({ cancelled: true }), null);
  assert.equal(plan({ mode: "never" }), null);
  assert.equal(plan({ mode: "owed", total: 100, paid: 100 }), null);
  const stamp = new Date(NOW - 2 * PAY_QR_MINUTES_DEFAULT * MS_PER_MINUTE).toISOString();
  assert.equal(plan({ firstPrintedAt: stamp }), null);
});
