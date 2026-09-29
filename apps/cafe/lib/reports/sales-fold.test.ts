// foldSalesReport — pure, DB-free. Every expected value is hand-computed
// against the Batch-1 plan's money rules (never recomputed with the code
// under test), mirroring lib/dashboard/fold.test.ts's own discipline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSalesReport } from "@/lib/reports/sales-fold";
import type { SalesFacet, SalesDayGroupRow, DuesByDayRow } from "@/lib/reports/sales-pipelines";
import type { CompareFacet } from "@/lib/dashboard/pipelines";

const EMPTY_COMPARE: CompareFacet = { totals: [], series: [] };

function dayRow(over: Partial<SalesDayGroupRow> & { _id: string }): SalesDayGroupRow {
  return {
    orders: 0,
    net: 0,
    gross: 0,
    discount: 0,
    reward: 0,
    gst: 0,
    charges: 0,
    cash: 0,
    online: 0,
    other: 0,
    credit: 0,
    ...over,
  };
}

test("foldSalesReport: zero-day fill over a 3-day range — a day with no sales still appears with all zeros", () => {
  const range = { from: "2026-09-27", to: "2026-09-29" };
  const facet: SalesFacet = {
    days: [
      dayRow({ _id: "2026-09-27", orders: 2, net: 500, gross: 500, cash: 500 }),
      // 2026-09-28 deliberately absent -> a zero day must still appear.
      dayRow({ _id: "2026-09-29", orders: 1, net: 300, gross: 300, online: 300 }),
    ],
    series: [],
    totals: [{ orders: 3, sales: 800, collected: 800 }],
    modes: [],
  };
  const report = foldSalesReport({ range, facet, compare: EMPTY_COMPARE, duesRows: [] });
  assert.equal(report.days.length, 3);
  assert.deepEqual(
    report.days.map((d) => d.date),
    ["2026-09-27", "2026-09-28", "2026-09-29"],
  );
  const mid = report.days[1];
  assert.equal(mid.orders, 0);
  assert.equal(mid.net, 0);
  assert.deepEqual(mid.money, { gross: 0, discount: 0, reward: 0, gst: 0, charges: 0 });
  assert.deepEqual(mid.dues, { cash: 0, online: 0, other: 0 });
});

test("foldSalesReport: dues buckets — Cash/Online map directly, a legacy mode (e.g. old 'Split' receipt) falls to other", () => {
  const range = { from: "2026-09-29", to: "2026-09-29" };
  const facet: SalesFacet = {
    days: [dayRow({ _id: "2026-09-29", orders: 1, net: 100, gross: 100, cash: 100 })],
    series: [],
    totals: [{ orders: 1, sales: 100, collected: 100 }],
    modes: [],
  };
  const duesRows: DuesByDayRow[] = [
    { _id: { day: "2026-09-29", mode: "Cash" }, amount: 150 },
    { _id: { day: "2026-09-29", mode: "Online" }, amount: 80 },
    { _id: { day: "2026-09-29", mode: "Split" }, amount: 40 }, // legacy mode -> other
  ];
  const report = foldSalesReport({ range, facet, compare: EMPTY_COMPARE, duesRows });
  assert.deepEqual(report.days[0].dues, { cash: 150, online: 80, other: 40 });
  // Range-level dues === Σ of days (never independently computed).
  assert.deepEqual(report.dues, { cash: 150, online: 80, other: 40 });
});

test("foldSalesReport: range totals (money/received/dues) === Σ of the day rows", () => {
  const range = { from: "2026-09-28", to: "2026-09-29" };
  const facet: SalesFacet = {
    days: [
      dayRow({ _id: "2026-09-28", orders: 2, net: 600, gross: 650, discount: 50, cash: 400, online: 200, credit: 0 }),
      dayRow({ _id: "2026-09-29", orders: 1, net: 300, gross: 300, other: 250, credit: 50 }),
    ],
    series: [],
    totals: [{ orders: 3, sales: 900, collected: 850 }],
    modes: [],
  };
  const duesRows: DuesByDayRow[] = [{ _id: { day: "2026-09-28", mode: "Cash" }, amount: 20 }];
  const report = foldSalesReport({ range, facet, compare: EMPTY_COMPARE, duesRows });

  assert.deepEqual(report.money, { gross: 950, discount: 50, reward: 0, gst: 0, charges: 0 });
  assert.deepEqual(report.received, { cash: 400, online: 200, other: 250, credit: 50 });
  assert.deepEqual(report.dues, { cash: 20, online: 0, other: 0 });
});

test("foldSalesReport: payments sort by billed desc then orders desc, zero-order modes dropped", () => {
  const range = { from: "2026-09-29", to: "2026-09-29" };
  const facet: SalesFacet = {
    days: [dayRow({ _id: "2026-09-29" })],
    series: [],
    totals: [{ orders: 0, sales: 0, collected: 0 }],
    modes: [
      { _id: "Cash", orders: 5, billed: 500, received: 500, splitCash: 0, splitOnline: 0 },
      { _id: "Online", orders: 3, billed: 500, received: 500, splitCash: 0, splitOnline: 0 }, // ties Cash on billed, fewer orders
      { _id: "Due", orders: 0, billed: 0, received: 0, splitCash: 0, splitOnline: 0 }, // dropped: orders 0
      { _id: "Split", orders: 1, billed: 200, received: 200, splitCash: 120, splitOnline: 80 },
    ],
  };
  const report = foldSalesReport({ range, facet, compare: EMPTY_COMPARE, duesRows: [] });
  assert.deepEqual(
    report.payments.map((p) => p.mode),
    ["Cash", "Online", "Split"],
  );
  assert.deepEqual(report.payments[0], { mode: "Cash", orders: 5, billed: 500, received: 500 });
});

test("foldSalesReport: split row reads orders/splitCash/splitOnline from the Split mode row, zeros when absent", () => {
  const range = { from: "2026-09-29", to: "2026-09-29" };
  const withSplit: SalesFacet = {
    days: [dayRow({ _id: "2026-09-29" })],
    series: [],
    totals: [{ orders: 0, sales: 0, collected: 0 }],
    modes: [{ _id: "Split", orders: 2, billed: 300, received: 300, splitCash: 180, splitOnline: 120 }],
  };
  const reportWithSplit = foldSalesReport({ range, facet: withSplit, compare: EMPTY_COMPARE, duesRows: [] });
  assert.deepEqual(reportWithSplit.split, { orders: 2, cash: 180, online: 120 });

  const noSplit: SalesFacet = { days: [dayRow({ _id: "2026-09-29" })], series: [], totals: [], modes: [] };
  const reportNoSplit = foldSalesReport({ range, facet: noSplit, compare: EMPTY_COMPARE, duesRows: [] });
  assert.deepEqual(reportNoSplit.split, { orders: 0, cash: 0, online: 0 });
});

test("foldSalesReport: kpis/series/mode/compare come from the SAME dashboard helpers the Dashboard uses", () => {
  const range = { from: "2026-09-29", to: "2026-09-29" }; // one day -> mode "hour"
  const facet: SalesFacet = {
    days: [dayRow({ _id: "2026-09-29", orders: 4, net: 1000 })],
    series: [{ _id: 10, sales: 1000, orders: 4 }],
    totals: [{ orders: 4, sales: 1000, collected: 900 }],
    modes: [],
  };
  const compare: CompareFacet = { totals: [{ orders: 2, sales: 400, collected: 400 }], series: [{ _id: 10, sales: 400, orders: 2 }] };
  const now = new Date("2026-09-29T09:00:00Z");
  const report = foldSalesReport({ range, now, facet, compare, duesRows: [] });

  assert.equal(report.mode, "hour");
  assert.deepEqual(report.kpis.current, { sales: 1000, orders: 4, averageOrder: 250, collected: 900 });
  assert.deepEqual(report.kpis.previous, { sales: 400, orders: 2, averageOrder: 200, collected: 400 });
  assert.equal(report.compare.label, "vs Tue, 22 Sep");
  assert.ok(report.series.some((p) => p.key === "10" && p.sales === 1000 && p.compareSales === 400));
});
