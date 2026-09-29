// receivedOf — pure JS twin of lib/reports/sales-pipelines.ts's CASH_EXPR/
// ONLINE_EXPR/OTHER_EXPR/CREDIT_EXPR (proved to agree on real documents by
// scripts/verify-reports-live.ts). Every case also checks the identity
// cash + online + other + credit === total, per bill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { receivedOf } from "@/lib/reports/received";

function assertIdentity(order: { total?: number }, split: { cash: number; online: number; other: number; credit: number }) {
  const total = order.total ?? 0;
  assert.equal(split.cash + split.online + split.other + split.credit, total);
}

test("receivedOf: Cash, paid in full", () => {
  const order = { payment: "Cash", total: 300, paidAmount: 300 };
  const split = receivedOf(order);
  assert.deepEqual(split, { cash: 300, online: 0, other: 0, credit: 0 });
  assertIdentity(order, split);
});

test("receivedOf: Cash, part-paid (a partial settle) — the shortfall lands as credit", () => {
  const order = { payment: "Cash", total: 500, paidAmount: 200 };
  const split = receivedOf(order);
  assert.deepEqual(split, { cash: 200, online: 0, other: 0, credit: 300 });
  assertIdentity(order, split);
});

test("receivedOf: Online, paid in full", () => {
  const order = { payment: "Online", total: 400, paidAmount: 400 };
  const split = receivedOf(order);
  assert.deepEqual(split, { cash: 0, online: 400, other: 0, credit: 0 });
  assertIdentity(order, split);
});

test("receivedOf: Split with parts — cash/online from splitCash/splitOnline, other picks up the rest", () => {
  const order = { payment: "Split", total: 300, paidAmount: 300, splitCash: 200, splitOnline: 100 };
  const split = receivedOf(order);
  assert.deepEqual(split, { cash: 200, online: 100, other: 0, credit: 0 });
  assertIdentity(order, split);
});

test("receivedOf: Split without parts — splitCash/splitOnline absent, the whole paid amount is 'other'", () => {
  const order = { payment: "Split", total: 250, paidAmount: 250 };
  const split = receivedOf(order);
  assert.deepEqual(split, { cash: 0, online: 0, other: 250, credit: 0 });
  assertIdentity(order, split);
});

test("receivedOf: Split, part-paid with parts that don't cover the paid amount — the shortfall is 'other'", () => {
  const order = { payment: "Split", total: 300, paidAmount: 280, splitCash: 150, splitOnline: 100 };
  const split = receivedOf(order);
  // paid 280, cash+online parts 250 -> other = 280 - 250 = 30
  assert.deepEqual(split, { cash: 150, online: 100, other: 30, credit: 20 });
  assertIdentity(order, split);
});

test("receivedOf: Due, nothing paid — the whole total is credit", () => {
  const order = { payment: "Due", total: 700, paidAmount: 0 };
  const split = receivedOf(order);
  assert.deepEqual(split, { cash: 0, online: 0, other: 0, credit: 700 });
  assertIdentity(order, split);
});

test("receivedOf: Credit mode, paid in full at sale time — no residual credit", () => {
  const order = { payment: "Credit", total: 600, paidAmount: 600 };
  const split = receivedOf(order);
  assert.deepEqual(split, { cash: 0, online: 0, other: 600, credit: 0 });
  assertIdentity(order, split);
});

test('receivedOf: a Completed order stored with a legacy "Unpaid" mode — treated as "other", any paidAmount still tallies', () => {
  const order = { payment: "Unpaid", total: 150, paidAmount: 150 };
  const split = receivedOf(order);
  assert.deepEqual(split, { cash: 0, online: 0, other: 150, credit: 0 });
  assertIdentity(order, split);
});

test("receivedOf: missing paidAmount/total default to 0 (never NaN/undefined)", () => {
  const split = receivedOf({ payment: "Cash" });
  assert.deepEqual(split, { cash: 0, online: 0, other: 0, credit: 0 });
});
