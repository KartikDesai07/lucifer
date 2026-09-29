// foldCancelsReport — pure, DB-free. Every expected value is hand-computed
// against the CancelsReport contract's own comments, mirroring
// sales-fold.test.ts's idiom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldCancelsReport } from "@/lib/reports/cancels-fold";
import type { LeakCompareFacet, LeakFacet } from "@/lib/reports/cancels-pipelines";

const EMPTY_COMPARE: LeakCompareFacet = { totals: [], cancelled: [], voids: [] };

function emptyFacet(over: Partial<LeakFacet> = {}): LeakFacet {
  return {
    totals: [],
    cancelled: [],
    voids: [],
    givenSeries: [],
    cancelledSeries: [],
    voidSeries: [],
    cancelledRows: [],
    removedRows: [],
    discountRows: [],
    rewardRows: [],
    staffCancelled: [],
    staffRemoved: [],
    staffDiscounts: [],
    cancelReasons: [],
    removeReasons: [],
    ...over,
  };
}

test("foldCancelsReport: kpis fold from totals/cancelled/voids rows, 0s when absent", () => {
  const facet = emptyFacet({
    totals: [{ discountedOrders: 2, rewardedOrders: 1, discount: 100, reward: 50 }],
    cancelled: [{ count: 3, value: 900 }],
    voids: [{ lines: 4, qty: 6, value: 200 }],
  });
  const report = foldCancelsReport({ range: { from: "2026-09-29", to: "2026-09-29" }, mode: "hour", facet, compare: EMPTY_COMPARE });
  assert.deepEqual(report.kpis.current, {
    discounts: { orders: 2, amount: 100 },
    rewards: { orders: 1, amount: 50 },
    cancelled: { count: 3, value: 900 },
    voids: { lines: 4, qty: 6, value: 200 },
  });
  assert.deepEqual(report.kpis.previous, {
    discounts: { orders: 0, amount: 0 },
    rewards: { orders: 0, amount: 0 },
    cancelled: { count: 0, value: 0 },
    voids: { lines: 0, qty: 0, value: 0 },
  });
});

test("foldCancelsReport day mode: every IST day of the range appears, given = discounts+rewards, lost = cancelled+voids", () => {
  const range = { from: "2026-09-27", to: "2026-09-29" };
  const facet = emptyFacet({
    givenSeries: [{ _id: "2026-09-27", amount: 100 }],
    cancelledSeries: [{ _id: "2026-09-28", amount: 300 }],
    voidSeries: [{ _id: "2026-09-28", amount: 50 }],
  });
  const report = foldCancelsReport({ range, mode: "day", facet, compare: EMPTY_COMPARE });
  assert.equal(report.series.length, 3);
  assert.deepEqual(report.series[0], { key: "2026-09-27", label: "27 Sep", given: 100, lost: 0 });
  assert.deepEqual(report.series[1], { key: "2026-09-28", label: "28 Sep", given: 0, lost: 350 });
  assert.deepEqual(report.series[2], { key: "2026-09-29", label: "29 Sep", given: 0, lost: 0 });
});

test("foldCancelsReport hour mode: empty when nothing at all; contiguous span when something exists", () => {
  const range = { from: "2026-09-29", to: "2026-09-29" };
  const empty = foldCancelsReport({ range, mode: "hour", facet: emptyFacet(), compare: EMPTY_COMPARE });
  assert.deepEqual(empty.series, []);

  const facet = emptyFacet({ cancelledSeries: [{ _id: 9, amount: 100 }], voidSeries: [{ _id: 11, amount: 20 }] });
  const report = foldCancelsReport({ range, mode: "hour", facet, compare: EMPTY_COMPARE });
  assert.deepEqual(
    report.series.map((p) => p.key),
    ["9", "10", "11"],
  );
  assert.equal(report.series[1].lost, 0);
});

test("foldCancelsReport: cancelled/removed/discounts rows map fields, empty-string fallbacks, truncated flags", () => {
  const facet = emptyFacet({
    totals: [{ discountedOrders: 1, rewardedOrders: 1, discount: 100, reward: 50 }],
    cancelled: [{ count: 5, value: 1000 }], // 5 total, only 1 row below -> truncated
    voids: [{ lines: 3, qty: 3, value: 60 }], // 3 total, only 1 row below -> truncated
    cancelledRows: [
      {
        _id: "abc",
        orderId: "ORD-1",
        day: "2026-09-29",
        createdAt: new Date("2026-09-29T10:00:00Z"),
        total: 500,
        paidAmount: 200,
        customerName: "Walk-in",
      },
    ],
    removedRows: [
      { orderId: "ORD-2", day: "2026-09-29", at: new Date("2026-09-29T11:00:00Z"), item: "Tea", qty: 1, value: 20, reason: "" },
    ],
    discountRows: [
      {
        orderId: "ORD-3",
        day: "2026-09-29",
        createdAt: new Date("2026-09-29T09:00:00Z"),
        amount: 50,
        billTotal: 500,
        by: "Asha",
        customerName: "Ravi",
        discountKind: "gst",
      },
    ],
    // rewardedOrders is 1 -> not truncated by rewardRows alone.
    rewardRows: [
      {
        orderId: "ORD-4",
        day: "2026-09-29",
        createdAt: new Date("2026-09-29T08:00:00Z"),
        amount: 30,
        billTotal: 300,
        by: "Vikram",
        customerName: "Sana",
      },
    ],
  });
  const report = foldCancelsReport({ range: { from: "2026-09-29", to: "2026-09-29" }, mode: "hour", facet, compare: EMPTY_COMPARE });

  assert.equal(report.cancelled.rows[0].by, "", "cancelledBy absent -> ''");
  assert.equal(report.cancelled.rows[0].reason, "", "cancelReason absent -> ''");
  assert.equal(report.cancelled.rows[0].tableNo, "", "tableNo absent -> ''");
  assert.equal(report.cancelled.rows[0].at, "2026-09-29T10:00:00.000Z", "no cancelledAt -> falls back to createdAt");
  assert.equal(report.cancelled.truncated, true);
  assert.equal(report.removed.rows[0].by, "");
  assert.equal(report.removed.truncated, true);

  // Newest-first: ORD-3 (09:00) before ORD-4 (08:00).
  assert.deepEqual(
    report.discounts.rows.map((r) => r.orderId),
    ["ORD-3", "ORD-4"],
  );
  assert.equal(report.discounts.rows[0].kind, "gst");
  assert.equal(report.discounts.rows[1].kind, "reward");
  assert.equal(report.discounts.truncated, false, "1 discount row for 1 discounted order and 1 reward row for 1 rewarded order -> not truncated");
});

test('foldCancelsReport: a "manual" discountKind (no gst) maps to kind "manual"', () => {
  const facet = emptyFacet({
    totals: [{ discountedOrders: 1, rewardedOrders: 0, discount: 40, reward: 0 }],
    discountRows: [
      { orderId: "ORD-5", day: "2026-09-29", createdAt: new Date("2026-09-29T09:00:00Z"), amount: 40, billTotal: 400, by: "Asha", customerName: "" },
    ],
  });
  const report = foldCancelsReport({ range: { from: "2026-09-29", to: "2026-09-29" }, mode: "hour", facet, compare: EMPTY_COMPARE });
  assert.equal(report.discounts.rows[0].kind, "manual");
});

test("foldCancelsReport: byStaff merges the three staff groups by name, sorted by total money desc then name asc", () => {
  const facet = emptyFacet({
    staffCancelled: [{ _id: "Asha", count: 2, value: 400 }],
    staffRemoved: [{ _id: "Asha", lines: 1, value: 20 }],
    staffDiscounts: [
      { _id: "Vikram", orders: 1, amount: 1000 },
      { _id: "", orders: 1, amount: 5 }, // "" stays as an explicit row, not dropped
    ],
  });
  const report = foldCancelsReport({ range: { from: "2026-09-29", to: "2026-09-29" }, mode: "hour", facet, compare: EMPTY_COMPARE });
  assert.deepEqual(
    report.byStaff.map((r) => r.name),
    ["Vikram", "Asha", ""],
  );
  assert.deepEqual(report.byStaff[1].cancelled, { count: 2, value: 400 });
  assert.deepEqual(report.byStaff[1].removed, { lines: 1, value: 20 });
});

test("foldCancelsReport: reasons merge cancel+remove kinds, sorted count desc then value desc then reason asc", () => {
  const facet = emptyFacet({
    cancelReasons: [
      { _id: "wrong order", reason: "Wrong order", count: 3, value: 300 },
      { _id: "customer left", reason: "Customer left", count: 3, value: 500 },
    ],
    removeReasons: [{ _id: "burnt", reason: "Burnt", count: 5, value: 100 }],
  });
  const report = foldCancelsReport({ range: { from: "2026-09-29", to: "2026-09-29" }, mode: "hour", facet, compare: EMPTY_COMPARE });
  assert.deepEqual(
    report.reasons.map((r) => [r.kind, r.reason]),
    [
      ["remove", "Burnt"],
      ["cancel", "Customer left"],
      ["cancel", "Wrong order"],
    ],
  );
});
