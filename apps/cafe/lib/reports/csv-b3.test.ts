// orderTypesCsvRows — pure, DB-free. Pins that every row shares the same
// keys (exportToCSV takes headers from the first row), the section order,
// that Total rows come from kpis even when the rows don't sum to them, that
// heat rows are avg > 0 only, and rounding, mirroring csv-b2.test.ts's own
// discipline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderTypesCsvRows } from "@/lib/reports/csv-b3";
import { hourSpanLabel } from "@/lib/reports/order-types-fold";
import type { OrderTypesReport } from "@/types/reports-b3";
import type { DashboardChannel } from "@/types/dashboard";

function zeroCell() {
  return { orders: 0, sales: 0 };
}

function makeReport(): OrderTypesReport {
  const byType = {
    "dine-in": { orders: 3, sales: 300 },
    takeaway: zeroCell(),
    qr: { orders: 1, sales: 100 },
    counter: zeroCell(),
  } as Record<DashboardChannel, { orders: number; sales: number }>;

  return {
    range: { from: "2026-09-29", to: "2026-09-29" },
    compare: { from: "2026-09-22", to: "2026-09-22", label: "vs Tue, 22 Sep" },
    // kpis.current deliberately does NOT equal the Σ of the listed rows below,
    // so the Total-row-from-kpis pin actually distinguishes it.
    kpis: {
      current: { sales: 5000, orders: 50, averageOrder: 100, collected: 4000 },
      previous: { sales: 0, orders: 0, averageOrder: 0, collected: 0 },
    },
    types: [
      { key: "dine-in", label: "Dine-in", orders: 3, sales: 300, averageOrder: 100, share: 0.75 },
      { key: "qr", label: "QR self-order", orders: 1, sales: 100, averageOrder: 100, share: 0.25 },
    ],
    hours: [
      { hour: 9, label: "9 am", span: hourSpanLabel(9), orders: 4, sales: 400, byType },
      { hour: 10, label: "10 am", span: hourSpanLabel(10), orders: 0, sales: 0, byType: { "dine-in": zeroCell(), takeaway: zeroCell(), qr: zeroCell(), counter: zeroCell() } },
    ],
    busiestHour: 9,
    heat: {
      all: { from: "2026-09-01", to: "2026-09-29", hours: [9, 10], avg: [[1.5, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], max: 1.5 },
      byType: {
        "dine-in": { from: "2026-09-01", to: "2026-09-29", hours: [], avg: [[], [], [], [], [], [], []], max: 0 },
        takeaway: { from: "2026-09-01", to: "2026-09-29", hours: [], avg: [[], [], [], [], [], [], []], max: 0 },
        qr: { from: "2026-09-01", to: "2026-09-29", hours: [], avg: [[], [], [], [], [], [], []], max: 0 },
        counter: { from: "2026-09-01", to: "2026-09-29", hours: [], avg: [[], [], [], [], [], [], []], max: 0 },
      },
    },
  };
}

test("orderTypesCsvRows: every row carries the same keys, in the same order", () => {
  const rows = orderTypesCsvRows(makeReport());
  assert.ok(rows.length > 0);
  const expectedKeys = Object.keys(rows[0]);
  for (const row of rows) assert.deepEqual(Object.keys(row), expectedKeys);
});

test("orderTypesCsvRows: sections appear in order — Order types, By hour, By hour and type, Busy hours", () => {
  const rows = orderTypesCsvRows(makeReport());
  const sections = [...new Set(rows.map((r) => r.Section))];
  assert.deepEqual(sections, [
    "Order types",
    "By hour",
    "By hour and type",
    `Busy hours (average orders, 2026-09-01 to 2026-09-29)`,
  ]);
});

test("orderTypesCsvRows: Order types Total row equals kpis.current, not the Σ of listed type rows", () => {
  const rows = orderTypesCsvRows(makeReport());
  const total = rows.find((r) => r.Section === "Order types" && r["Order type"] === "Total");
  assert.ok(total);
  assert.equal(total!.Orders, 50); // kpis.current.orders, NOT 3+1=4
  assert.equal(total!.Sales, 5000); // kpis.current.sales, NOT 300+100=400
  assert.equal(total!["% of orders"], 100);
  assert.equal(total!["% of sales"], 100);
  assert.equal(total!["Avg order"], 100);
});

test("orderTypesCsvRows: By hour Total row equals kpis.current too", () => {
  const rows = orderTypesCsvRows(makeReport());
  const total = rows.find((r) => r.Section === "By hour" && r["Order type"] === "Total");
  assert.ok(total);
  assert.equal(total!.Orders, 50);
  assert.equal(total!.Sales, 5000);
});

test("orderTypesCsvRows: By hour lists only hours with orders > 0 (hour 10 is all-zero and omitted)", () => {
  const rows = orderTypesCsvRows(makeReport());
  const byHourRows = rows.filter((r) => r.Section === "By hour" && r["Order type"] === "All types");
  assert.equal(byHourRows.length, 1);
  assert.equal(byHourRows[0].Hour, hourSpanLabel(9));
});

test("orderTypesCsvRows: By hour and type lists only nonzero cells, has NO total row, % relative to kpis.current", () => {
  const rows = orderTypesCsvRows(makeReport());
  const section = rows.filter((r) => r.Section === "By hour and type");
  assert.equal(section.length, 2); // dine-in and qr at hour 9 only
  assert.ok(!section.some((r) => r["Order type"] === "Total"));
  const dineIn = section.find((r) => r["Order type"] === "Dine-in");
  assert.equal(dineIn?.Orders, 3);
  assert.equal(dineIn?.["% of orders"], Math.round((3 / 50) * 1000) / 10);
  assert.equal(dineIn?.["% of sales"], Math.round((300 / 5000) * 1000) / 10);
});

test("orderTypesCsvRows: Busy hours lists only avg > 0 cells, Weekday/Hour set, other columns blank", () => {
  const rows = orderTypesCsvRows(makeReport());
  const busy = rows.filter((r) => String(r.Section).startsWith("Busy hours"));
  assert.equal(busy.length, 1); // only Monday hour 9 has avg 1.5 > 0
  assert.equal(busy[0].Weekday, "Mon");
  assert.equal(busy[0].Hour, hourSpanLabel(9));
  assert.equal(busy[0].Orders, 1.5);
  assert.equal(busy[0]["Order type"], "");
  assert.equal(busy[0].Sales, "");
  assert.equal(busy[0]["Avg order"], "");
});

test("orderTypesCsvRows: Avg order is rounded to paise (2 decimals)", () => {
  const report = makeReport();
  report.types = [{ key: "dine-in", label: "Dine-in", orders: 3, sales: 100, averageOrder: 100 / 3, share: 1 }];
  const rows = orderTypesCsvRows(report);
  const row = rows.find((r) => r.Section === "Order types" && r["Order type"] === "Dine-in");
  assert.equal(row?.["Avg order"], Math.round((100 / 3) * 100) / 100);
});
