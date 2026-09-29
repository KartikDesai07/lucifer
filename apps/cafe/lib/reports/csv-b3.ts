// Pure CSV row builders for the Order types & busy hours report screen — same
// idiom as csv-b2.ts (plain objects for lib/export.ts's exportToCSV; headers
// come from the FIRST row's keys, so every row here carries the same keys in
// the same order). Every Total row is the report's OWN kpis.current, never a
// re-sum of the (possibly capped) listed rows.
import { CHANNEL_LABELS } from "@/lib/dashboard/fold";
import { WEEKDAYS_MONDAY_FIRST } from "@/lib/dashboard/range";
import { TOTAL_ROW_LABEL } from "@/lib/reports/csv";
import { hourSpanLabel } from "@/lib/reports/order-types-fold";
import type { OrderTypesReport } from "@/types/reports-b3";

type CsvRow = Record<string, string | number>;

const SHARE_DECIMALS = 1;
const AVG_ORDER_DECIMALS = 2;
const PERCENT_SCALE = 100;
const ALL_TYPES_LABEL = "All types";

const ORDER_TYPES_SECTION = "Order types";
const BY_HOUR_SECTION = "By hour";
const BY_HOUR_TYPE_SECTION = "By hour and type";

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * PERCENT_SCALE * 10 ** SHARE_DECIMALS) / 10 ** SHARE_DECIMALS;
}

function round2(value: number): number {
  return Math.round(value * 10 ** AVG_ORDER_DECIMALS) / 10 ** AVG_ORDER_DECIMALS;
}

function row(
  section: string,
  orderType: string,
  weekday: string,
  hour: string,
  orders: number | "",
  ordersShare: number | "",
  sales: number | "",
  salesShare: number | "",
  avgOrder: number | "",
): CsvRow {
  return {
    Section: section,
    "Order type": orderType,
    Weekday: weekday,
    Hour: hour,
    Orders: orders,
    "% of orders": ordersShare,
    Sales: sales,
    "% of sales": salesShare,
    "Avg order": avgOrder,
  };
}

export function orderTypesCsvRows(report: OrderTypesReport): CsvRow[] {
  const { kpis, types, hours, heat } = report;
  const rows: CsvRow[] = [];

  // Section 1: Order types — one row per type + the report's own Total.
  for (const t of types) {
    rows.push(
      row(
        ORDER_TYPES_SECTION,
        t.label,
        "",
        "",
        t.orders,
        pct(t.orders, kpis.current.orders),
        t.sales,
        pct(t.sales, kpis.current.sales),
        round2(t.averageOrder),
      ),
    );
  }
  rows.push(
    row(
      ORDER_TYPES_SECTION,
      TOTAL_ROW_LABEL,
      "",
      "",
      kpis.current.orders,
      PERCENT_SCALE,
      kpis.current.sales,
      PERCENT_SCALE,
      round2(kpis.current.averageOrder),
    ),
  );

  // Section 2: By hour — one row per hour with orders, + the report's own Total.
  const activeHours = hours.filter((h) => h.orders > 0);
  for (const h of activeHours) {
    rows.push(
      row(
        BY_HOUR_SECTION,
        ALL_TYPES_LABEL,
        "",
        h.span,
        h.orders,
        pct(h.orders, kpis.current.orders),
        h.sales,
        pct(h.sales, kpis.current.sales),
        round2(h.orders > 0 ? h.sales / h.orders : 0),
      ),
    );
  }
  rows.push(
    row(
      BY_HOUR_SECTION,
      TOTAL_ROW_LABEL,
      "",
      "",
      kpis.current.orders,
      PERCENT_SCALE,
      kpis.current.sales,
      PERCENT_SCALE,
      round2(kpis.current.averageOrder),
    ),
  );

  // Section 3: By hour and type — one row per (hour, type) with orders, no total.
  for (const h of activeHours) {
    for (const c of Object.keys(CHANNEL_LABELS) as Array<keyof typeof CHANNEL_LABELS>) {
      const cell = h.byType[c];
      if (cell.orders <= 0) continue;
      rows.push(
        row(
          BY_HOUR_TYPE_SECTION,
          CHANNEL_LABELS[c],
          "",
          h.span,
          cell.orders,
          pct(cell.orders, kpis.current.orders),
          cell.sales,
          pct(cell.sales, kpis.current.sales),
          round2(cell.orders > 0 ? cell.sales / cell.orders : 0),
        ),
      );
    }
  }

  // Section 4: Busy hours — one row per (weekday, hour) with a positive average.
  const busySection = `Busy hours (average orders, ${heat.all.from} to ${heat.all.to})`;
  for (let weekday = 0; weekday < WEEKDAYS_MONDAY_FIRST.length; weekday++) {
    const avgRow = heat.all.avg[weekday] ?? [];
    for (let i = 0; i < heat.all.hours.length; i++) {
      const avg = avgRow[i] ?? 0;
      if (avg <= 0) continue;
      rows.push(row(busySection, "", WEEKDAYS_MONDAY_FIRST[weekday], hourSpanLabel(heat.all.hours[i]), avg, "", "", "", ""));
    }
  }

  return rows;
}
