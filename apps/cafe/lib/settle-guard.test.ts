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
