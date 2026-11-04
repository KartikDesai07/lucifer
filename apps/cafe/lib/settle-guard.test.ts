import { test } from "node:test";
import assert from "node:assert/strict";

import { TAB_CHANGED, settleRefusal } from "./settle-guard";

const open = { status: "Pending", total: 560, voids: [] as unknown[] };

test("settleRefusal: cancelled and already-settled tabs are refused with their own words", () => {
  assert.equal(settleRefusal({ ...open, status: "Cancelled" }, {}), "Order was cancelled");
  assert.equal(settleRefusal({ ...open, status: "Completed" }, { expectedTotal: 560 }), "Order already settled");
});

test("settleRefusal: a bill priced from an older tab is refused — the round another device added is never closed as paid", () => {
  // The cashier took ₹540; device B has since fired a ₹20 round.
  assert.equal(settleRefusal(open, { expectedTotal: 540, expectedVoids: 0 }), TAB_CHANGED);
  assert.equal(settleRefusal(open, { expectedTotal: 560, expectedVoids: 0 }), null, "the same tab settles");
});

test("settleRefusal: a void the total cannot show (a fully comped tab) is caught by the trail length", () => {
  const comped = { status: "Pending", total: 0, voids: [{}] };
  assert.equal(settleRefusal(comped, { expectedTotal: 0, expectedVoids: 0 }), TAB_CHANGED);
  assert.equal(settleRefusal(comped, { expectedTotal: 0, expectedVoids: 1 }), null);
  assert.equal(settleRefusal({ status: "Pending", total: 0 }, { expectedTotal: 0, expectedVoids: 0 }), null, "an absent trail is 0 voids");
});

test("settleRefusal: an omitted echo is not checked (callers that do not hold the tab they priced)", () => {
  assert.equal(settleRefusal(open, {}), null);
  assert.equal(settleRefusal(open, { expectedVoids: 0 }), null);
});

test("settleRefusal: a tab moved to another table since the bill was priced is refused, even at the same total (T1 echo)", () => {
  // Device B moved the tab from T-1 to T-2, both ₹50 tables: the total and the trail did not change.
  const atT2 = { ...open, tableNo: "T-2" };
  assert.equal(settleRefusal(atT2, { expectedTotal: 560, expectedVoids: 0 }), null, "regression witness: total + voids alone let it through");
  assert.equal(settleRefusal(atT2, { expectedTotal: 560, expectedVoids: 0, expectedTableNo: "T-1" }), TAB_CHANGED);
  assert.equal(settleRefusal(atT2, { expectedTotal: 560, expectedVoids: 0, expectedTableNo: "T-2" }), null, "the same table settles");
});

test("settleRefusal: a walk-in reads the same with no table, null or an empty name; seated or unseated elsewhere is a change", () => {
  assert.equal(settleRefusal(open, { expectedTableNo: null }), null);
  assert.equal(settleRefusal({ ...open, tableNo: null }, { expectedTableNo: null }), null);
  assert.equal(settleRefusal({ ...open, tableNo: "" }, { expectedTableNo: null }), null);
  assert.equal(settleRefusal(open, { expectedTableNo: "" }), null);
  assert.equal(settleRefusal({ ...open, tableNo: "T-1" }, { expectedTableNo: null }), TAB_CHANGED, "seated elsewhere");
  assert.equal(settleRefusal(open, { expectedTableNo: "T-1" }), TAB_CHANGED, "unseated elsewhere");
});
