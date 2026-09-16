import type { Report } from "@/types";
import type { ReportRange } from "@/hooks/use-reports";

// Section labels, in the fixed column-1 order the CSV is built in.
const SECTION_TOTALS = "Totals";
const SECTION_SALES_BY_DAY = "Sales by day";
const SECTION_SALES_BY_PAYMENT = "Sales by payment";
const SECTION_TOP_PRODUCTS = "Top products";
const SECTION_CUSTOMER_DUES = "Customer dues";

const NA = "" as const;

// Every row carries all five keys (empty string where N/A) — exportToCSV
// (lib/export.ts) takes its headers from row 0, so a row missing a key would
// silently drop that column for every other row too.
export type ReportCsvRow = Record<string, unknown> & {
  Section: string;
  Item: string;
  Qty: number | "";
  Amount: number | "";
  Count: number | "";
};

function row(
  section: string,
  item: string,
  qty: number | "" = NA,
  amount: number | "" = NA,
  count: number | "" = NA,
): ReportCsvRow {
  return { Section: section, Item: item, Qty: qty, Amount: amount, Count: count };
}

// Flattens a date-range /api/reports payload into one uniform-shape row list
// for lib/export.ts's exportToCSV (Reports page "Download CSV").
//
// `_range` is intentionally unused: `report.range` (set by the server from
// the same request) already carries identical start/end values, so there is
// nothing this parameter would add — it is accepted for call-site symmetry
// with the page's fetch range (repo convention: `_`-prefixed = seam param,
// see eslint.config.mjs).
export function buildReportCsvRows(
  report: Report,
  _range: ReportRange,
): ReportCsvRow[] {
  const rows: ReportCsvRow[] = [];
  const { totals } = report;

  // Totals: one row per KPI. Money KPIs use Amount; the orders KPI is a
  // count. duesCollected is the CR1.4 date-ranged dues receipt total from
  // /api/reports — a plain number (no per-mode breakdown; that shape only
  // exists on /api/orders/summary's duesCollected, a different endpoint).
  rows.push(row(SECTION_TOTALS, "Total orders", NA, NA, totals.totalOrders));
  rows.push(row(SECTION_TOTALS, "Total sales", NA, totals.totalSales));
  rows.push(row(SECTION_TOTALS, "Total collected", NA, totals.totalCollected));
  rows.push(row(SECTION_TOTALS, "Dues collected", NA, totals.duesCollected));

  for (const d of report.dayWise) {
    rows.push(row(SECTION_SALES_BY_DAY, d.date, NA, d.sales, d.orders));
  }

  for (const p of report.salesByPayment) {
    rows.push(row(SECTION_SALES_BY_PAYMENT, p.payment, NA, p.amount, p.count));
  }

  for (const p of report.topProducts) {
    rows.push(row(SECTION_TOP_PRODUCTS, p.name, p.qty, p.revenue));
  }

  for (const c of report.customerDues) {
    rows.push(row(SECTION_CUSTOMER_DUES, `${c.name} (${c.mobile})`, NA, c.totalDue));
  }

  return rows;
}
