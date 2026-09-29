// Facet rows -> OrderTypesReport / HourDetail — pure, DB-free. Expected values
// are hand-computed against fold.ts's own comments, never recomputed with the
// code under test, mirroring lib/dashboard/fold.test.ts's own discipline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANNELS, foldHeat } from "@/lib/dashboard/fold";
import type { HeatRow } from "@/lib/dashboard/pipelines";
import { foldHourDetail, foldOrderTypesReport, hourSpanLabel } from "@/lib/reports/order-types-fold";
import type { HeatTypeRow, HourDayRow, HourTypeRow, OrderTypesFacet } from "@/lib/reports/order-types-pipelines";
import type { DashboardChannel } from "@/types/dashboard";

const RANGE = { from: "2026-09-29", to: "2026-09-29" };

function emptyFacet(): OrderTypesFacet {
  return { totals: [], types: [], hours: [] };
}

// ── hourSpanLabel ────────────────────────────────────────────────────────────

test('hourSpanLabel(23) === "11 pm – 12 am"', () => {
  assert.equal(hourSpanLabel(23), "11 pm – 12 am");
});

test('hourSpanLabel(9) === "9 am – 10 am"', () => {
  assert.equal(hourSpanLabel(9), "9 am – 10 am");
});

// ── kpis / compare ───────────────────────────────────────────────────────────

test("foldOrderTypesReport: kpis current/previous fold via foldKpis, compare label/range from compareRange/compareLabel", () => {
  const result = foldOrderTypesReport({
    range: RANGE,
    facet: { totals: [{ orders: 4, sales: 1000, collected: 800 }], types: [], hours: [] },
    compareTotals: [{ orders: 2, sales: 400, collected: 400 }],
    heatRows: [],
    heatRange: RANGE,
  });
  assert.deepEqual(result.kpis.current, { sales: 1000, orders: 4, averageOrder: 250, collected: 800 });
  assert.deepEqual(result.kpis.previous, { sales: 400, orders: 2, averageOrder: 200, collected: 400 });
  assert.equal(result.compare.label, "vs Tue, 22 Sep");
  assert.equal(result.compare.from, "2026-09-22");
});

// ── types mapping ────────────────────────────────────────────────────────────

test("foldOrderTypesReport: types map foldChannels rows, averageOrder = sales/orders, zero-type omitted", () => {
  const result = foldOrderTypesReport({
    range: RANGE,
    facet: {
      totals: [],
      types: [
        { _id: "dine-in", amount: 1000, count: 4 },
        { _id: "qr", amount: 500, count: 2 },
        // "takeaway"/"counter" absent -> zero -> foldChannels drops them
      ],
      hours: [],
    },
    compareTotals: [],
    heatRows: [],
    heatRange: RANGE,
  });
  assert.deepEqual(
    result.types.map((t) => t.key),
    ["dine-in", "qr"],
  );
  assert.deepEqual(result.types[0], { key: "dine-in", label: "Dine-in", orders: 4, sales: 1000, averageOrder: 250, share: 1000 / 1500 });
  assert.deepEqual(result.types[1], { key: "qr", label: "QR self-order", orders: 2, sales: 500, averageOrder: 250, share: 500 / 1500 });
});

// ── hours span + byType ──────────────────────────────────────────────────────

test("foldOrderTypesReport: hours span is contiguous incl. an EMPTY hour inside, every channel key present in byType, orders/sales are the Σ", () => {
  const hours: HourTypeRow[] = [
    { _id: { hour: 9, type: "dine-in" }, orders: 2, sales: 500 },
    { _id: { hour: 9, type: "qr" }, orders: 1, sales: 100 },
    // hour 10 deliberately has NO rows at all -> must still appear, all-zero
    { _id: { hour: 11, type: "counter" }, orders: 3, sales: 300 },
  ];
  const result = foldOrderTypesReport({
    range: RANGE,
    facet: { totals: [], types: [], hours },
    compareTotals: [],
    heatRows: [],
    heatRange: RANGE,
  });
  assert.equal(result.hours.length, 3); // 9, 10, 11
  assert.deepEqual(
    result.hours.map((h) => h.hour),
    [9, 10, 11],
  );

  const hour9 = result.hours[0];
  assert.equal(hour9.label, "9 am");
  assert.equal(hour9.span, hourSpanLabel(9));
  assert.equal(hour9.orders, 3); // 2 + 1
  assert.equal(hour9.sales, 600); // 500 + 100
  for (const c of CHANNELS) assert.ok(c in hour9.byType, `byType must carry key ${c}`);
  assert.deepEqual(hour9.byType["dine-in"], { orders: 2, sales: 500 });
  assert.deepEqual(hour9.byType.qr, { orders: 1, sales: 100 });
  assert.deepEqual(hour9.byType.counter, { orders: 0, sales: 0 });
  assert.deepEqual(hour9.byType.takeaway, { orders: 0, sales: 0 });

  const hour10 = result.hours[1];
  assert.equal(hour10.orders, 0);
  assert.equal(hour10.sales, 0);
  for (const c of CHANNELS) assert.deepEqual(hour10.byType[c], { orders: 0, sales: 0 });

  const hour11 = result.hours[2];
  assert.equal(hour11.orders, 3);
  assert.deepEqual(hour11.byType.counter, { orders: 3, sales: 300 });
});

test("foldOrderTypesReport: no hour rows at all -> hours []", () => {
  const result = foldOrderTypesReport({
    range: RANGE,
    facet: emptyFacet(),
    compareTotals: [],
    heatRows: [],
    heatRange: RANGE,
  });
  assert.deepEqual(result.hours, []);
});

// ── busiestHour ──────────────────────────────────────────────────────────────

test("foldOrderTypesReport: busiestHour picks most orders", () => {
  const hours: HourTypeRow[] = [
    { _id: { hour: 9, type: "counter" }, orders: 5, sales: 100 },
    { _id: { hour: 10, type: "counter" }, orders: 8, sales: 50 },
  ];
  const result = foldOrderTypesReport({ range: RANGE, facet: { totals: [], types: [], hours }, compareTotals: [], heatRows: [], heatRange: RANGE });
  assert.equal(result.busiestHour, 10);
});

test("foldOrderTypesReport: busiestHour tie on orders breaks on most sales", () => {
  const hours: HourTypeRow[] = [
    { _id: { hour: 9, type: "counter" }, orders: 5, sales: 500 },
    { _id: { hour: 10, type: "counter" }, orders: 5, sales: 900 },
  ];
  const result = foldOrderTypesReport({ range: RANGE, facet: { totals: [], types: [], hours }, compareTotals: [], heatRows: [], heatRange: RANGE });
  assert.equal(result.busiestHour, 10);
});

test("foldOrderTypesReport: tie on orders AND sales breaks on the earliest hour", () => {
  const hours: HourTypeRow[] = [
    { _id: { hour: 9, type: "counter" }, orders: 5, sales: 500 },
    { _id: { hour: 10, type: "counter" }, orders: 5, sales: 500 },
  ];
  const result = foldOrderTypesReport({ range: RANGE, facet: { totals: [], types: [], hours }, compareTotals: [], heatRows: [], heatRange: RANGE });
  assert.equal(result.busiestHour, 9);
});

test("foldOrderTypesReport: busiestHour is null when hours is empty", () => {
  const result = foldOrderTypesReport({ range: RANGE, facet: emptyFacet(), compareTotals: [], heatRows: [], heatRange: RANGE });
  assert.equal(result.busiestHour, null);
});

// ── heat.all / heat.byType ───────────────────────────────────────────────────

test("foldOrderTypesReport: heat.all equals a HAND-BUILT expected grid AND equals foldHeat of the rows ungrouped by type", () => {
  const heatRange = { from: "2026-09-14", to: "2026-09-27" }; // 2-week window, weekdayCounts all 2
  const heatRows: HeatTypeRow[] = [
    { _id: { dow: 1, hour: 9, type: "dine-in" }, orders: 2 }, // Monday hour 9
    { _id: { dow: 1, hour: 9, type: "qr" }, orders: 1 }, // same cell, different type -> must SUM to 3
    { _id: { dow: 3, hour: 9, type: "counter" }, orders: 4 }, // Wednesday hour 9
  ];
  const result = foldOrderTypesReport({ range: RANGE, facet: emptyFacet(), compareTotals: [], heatRows, heatRange });

  // Hand-built expected: Monday hour9 = 3 orders / 2 Mondays = 1.5; Wednesday hour9 = 4/2 = 2.0.
  assert.equal(result.heat.all.hours.length, 1); // only hour 9 seen
  assert.deepEqual(result.heat.all.hours, [9]);
  assert.equal(result.heat.all.avg[0][0], 1.5); // Monday
  assert.equal(result.heat.all.avg[2][0], 2); // Wednesday
  assert.equal(result.heat.all.max, 2);

  // Cross-check against foldHeat fed the SAME rows collapsed across type.
  const ungrouped: HeatRow[] = [
    { _id: { dow: 1, hour: 9 }, orders: 3 },
    { _id: { dow: 3, hour: 9 }, orders: 4 },
  ];
  assert.deepEqual(result.heat.all, foldHeat(ungrouped, heatRange));
});

test("foldOrderTypesReport: heat.byType has EVERY channel key; a type with no rows -> hours []", () => {
  const heatRange = { from: "2026-09-14", to: "2026-09-27" };
  const heatRows: HeatTypeRow[] = [{ _id: { dow: 1, hour: 9, type: "dine-in" }, orders: 2 }];
  const result = foldOrderTypesReport({ range: RANGE, facet: emptyFacet(), compareTotals: [], heatRows, heatRange });
  for (const c of CHANNELS) assert.ok(c in result.heat.byType, `byType must carry key ${c}`);
  assert.deepEqual(result.heat.byType["dine-in"], foldHeat([{ _id: { dow: 1, hour: 9 }, orders: 2 }], heatRange));
  assert.deepEqual(result.heat.byType.qr.hours, []);
  assert.deepEqual(result.heat.byType.counter.hours, []);
});

// ── foldHourDetail ───────────────────────────────────────────────────────────

test("foldHourDetail: sorts ascending by date, omits zero-order days, weekdayDayLabel labels", () => {
  const rows: HourDayRow[] = [
    { _id: "2026-09-29", orders: 5, sales: 500 },
    { _id: "2026-09-27", orders: 0, sales: 0 }, // must be omitted
    { _id: "2026-09-28", orders: 3, sales: 300 },
  ];
  const result = foldHourDetail({ range: RANGE, hour: 9, type: null, rows });
  assert.deepEqual(
    result.days.map((d) => d.date),
    ["2026-09-28", "2026-09-29"],
  );
  assert.equal(result.days[0].label, "Mon, 28 Sep");
  assert.equal(result.hour, 9);
  assert.equal(result.type, null);
});

test("foldHourDetail: carries the requested type through untouched", () => {
  const type: DashboardChannel = "takeaway";
  const result = foldHourDetail({ range: RANGE, hour: 14, type, rows: [] });
  assert.equal(result.type, "takeaway");
  assert.deepEqual(result.days, []);
});
