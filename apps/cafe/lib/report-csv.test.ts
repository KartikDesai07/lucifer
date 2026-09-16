import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReportCsvRows, type ReportCsvRow } from "./report-csv";
import type { Report } from "@/types";
import type { ReportRange } from "@/hooks/use-reports";

// CR1.5 Slice 4 — Reports CSV export. buildReportCsvRows flattens the
// date-range /api/reports payload into the uniform 5-column row shape
// lib/export.ts's exportToCSV needs (it takes headers from row 0, so a
// non-uniform key set would silently drop columns for every other row).

const RANGE: ReportRange = { startDate: "2026-08-01", endDate: "2026-08-11" };

function baseReport(overrides: Partial<Report> = {}): Report {
  return {
    range: RANGE,
    totals: {
      totalOrders: 12,
      totalSales: 24000,
      totalCollected: 20000,
      duesCollected: 800,
    },
    salesByPayment: [
      { payment: "Cash", amount: 15000, count: 8 },
      { payment: "Online", amount: 9000, count: 4 },
    ],
    topProducts: [{ name: "Cold Coffee", qty: 10, revenue: 3000 }],
    dayWise: [{ date: "2026-08-01", sales: 24000, orders: 12 }],
    customerDues: [{ _id: "c1", name: "Asha", mobile: "9000000001", totalDue: 500 }],
    ...overrides,
  };
}

const EXPECTED_KEYS = ["Section", "Item", "Qty", "Amount", "Count"];

test("every row carries the identical 5-key shape (header-from-row-0 trap)", () => {
  const rows = buildReportCsvRows(baseReport(), RANGE);
  assert.ok(rows.length > 0, "fixture must produce rows");
  for (const r of rows) {
    assert.deepEqual(Object.keys(r), EXPECTED_KEYS);
  }
});

test("each non-empty section contributes rows labeled with its own Section", () => {
  const rows = buildReportCsvRows(baseReport(), RANGE);
  const bySection = (s: string) => rows.filter((r) => r.Section === s);

  assert.equal(bySection("Totals").length, 4, "one row per totals KPI");
  assert.equal(bySection("Sales by day").length, 1);
  assert.equal(bySection("Sales by payment").length, 2);
  assert.equal(bySection("Top products").length, 1);
  assert.equal(bySection("Customer dues").length, 1);
});

test("an empty section (no customer dues) contributes zero rows for it, not empty-placeholder rows", () => {
  const rows = buildReportCsvRows(baseReport({ customerDues: [] }), RANGE);
  assert.equal(
    rows.filter((r) => r.Section === "Customer dues").length,
    0,
    "an empty section must be omitted entirely, not represented by a blank row",
  );
});

test("all four report sub-collections empty leaves only the Totals rows", () => {
  const rows = buildReportCsvRows(
    baseReport({ salesByPayment: [], topProducts: [], dayWise: [], customerDues: [] }),
    RANGE,
  );
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.Section === "Totals"));
});

test("a value with a comma and a double-quote survives into the row untouched — lib/export.ts's escapeField (private, not exported) does the RFC 4180 escaping on the way out", () => {
  const trickyName = 'Comma, "Quoted" Customer';
  const rows = buildReportCsvRows(
    baseReport({
      customerDues: [{ _id: "c2", name: trickyName, mobile: "9000000002", totalDue: 250 }],
    }),
    RANGE,
  );
  const dueRow = rows.find((r) => r.Section === "Customer dues");
  assert.ok(dueRow, "customer dues row must exist");
  // The builder must hand exportToCSV the RAW value — no pre-escaping here,
  // since escapeField (lib/export.ts) would then double-escape it.
  assert.equal(dueRow?.Item, `${trickyName} (9000000002)`);
  assert.match(String(dueRow?.Item), /,/);
  assert.match(String(dueRow?.Item), /"/);
});

test("the dues-collected KPI row carries the plain-number Amount from totals.duesCollected faithfully, with no fabricated per-mode breakdown rows", () => {
  const rows = buildReportCsvRows(baseReport({ totals: {
    totalOrders: 12,
    totalSales: 24000,
    totalCollected: 20000,
    duesCollected: 4200,
  } }), RANGE);

  const duesRow = rows.find((r) => r.Section === "Totals" && r.Item === "Dues collected");
  assert.ok(duesRow, "a 'Dues collected' Totals row must exist");
  assert.equal(duesRow?.Amount, 4200);
  assert.equal(duesRow?.Qty, "");
  assert.equal(duesRow?.Count, "", "reports' duesCollected is a plain number — no per-mode count exists to put here");

  // No row anywhere should carry a mode-specific dues breakdown label (that
  // shape belongs to /api/orders/summary's duesCollected, a different
  // endpoint — reports/route.ts is pinned to the plain-number shape).
  const fabricated = rows.filter(
    (r) => /due/i.test(r.Item) && (r.Item.includes("Cash") || r.Item.includes("Online")),
  );
  assert.equal(fabricated.length, 0);
});

test("totals KPI rows put money in Amount and the order count in Count", () => {
  const rows = buildReportCsvRows(baseReport(), RANGE);
  const totals = (rows as ReportCsvRow[]).filter((r) => r.Section === "Totals");

  const ordersRow = totals.find((r) => r.Item === "Total orders");
  assert.equal(ordersRow?.Count, 12);
  assert.equal(ordersRow?.Amount, "");

  const salesRow = totals.find((r) => r.Item === "Total sales");
  assert.equal(salesRow?.Amount, 24000);

  const collectedRow = totals.find((r) => r.Item === "Total collected");
  assert.equal(collectedRow?.Amount, 20000);
});
