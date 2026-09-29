// Pure CSV row builders for the Items / Cancel & discounts / GST report
// screens — same idiom as lib/reports/csv.ts (plain objects for
// lib/export.ts's exportToCSV). Every Total row is the report's OWN sum, even
// when the on-screen rows are capped, so the sheet always tallies with the
// headline the page shows.
import { CAFE_TIMEZONE } from "@/lib/constants";
import { TOTAL_ROW_LABEL } from "@/lib/reports/csv";
import type { CancelsReport, GstBillRow, GstReport, ItemsReport } from "@/types/reports-b2";

type CsvRow = Record<string, string | number>;

const SHARE_DECIMALS = 1;
const HALF = 2;

function istDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: CAFE_TIMEZONE });
}

/** One row per item sold, Category/Qty/Free/Sales/Share, + a Total row. */
export function itemsCsvRows(report: ItemsReport): CsvRow[] {
  const rows: CsvRow[] = report.items.map((item) => ({
    Item: item.label,
    Category: item.categoryName,
    Qty: item.qty,
    Free: item.freeQty,
    Sales: item.sales,
    "Share %": Math.round(item.share * 100 * 10 ** SHARE_DECIMALS) / 10 ** SHARE_DECIMALS,
  }));
  rows.push({
    Item: TOTAL_ROW_LABEL,
    Category: "",
    Qty: report.kpis.current.qty,
    Free: report.items.reduce((s, r) => s + r.freeQty, 0),
    Sales: report.kpis.current.sales,
    "Share %": 100,
  });
  return rows;
}

const CANCELLED_SECTION = "Cancelled bills";
const REMOVED_SECTION = "Items removed";
const DISCOUNTS_SECTION = "Discounts & rewards";

/** Three sections (cancelled bills, items removed, discounts & rewards), each closed by its own KPI total. */
export function cancelsCsvRows(report: CancelsReport): CsvRow[] {
  const row = (section: string, date: string, ref: string, item: string, qty: number | "", amount: number, by: string, reason: string): CsvRow => ({
    Section: section,
    Date: date,
    "Bill/Order": ref,
    Item: item,
    Qty: qty,
    Amount: amount,
    By: by,
    Reason: reason,
  });

  const rows: CsvRow[] = report.cancelled.rows.map((r) =>
    row(CANCELLED_SECTION, istDate(r.at), r.billNumber !== undefined ? `#${r.billNumber}` : r.orderId, "", "", r.value, r.by, r.reason),
  );
  rows.push(row(CANCELLED_SECTION, "", "", "", "", report.kpis.current.cancelled.value, "", TOTAL_ROW_LABEL));

  rows.push(
    ...report.removed.rows.map((r) => row(REMOVED_SECTION, istDate(r.at), r.orderId, r.item, r.qty, r.value, r.by, r.reason)),
  );
  rows.push(row(REMOVED_SECTION, "", "", "", "", report.kpis.current.voids.value, "", TOTAL_ROW_LABEL));

  rows.push(
    ...report.discounts.rows.map((r) =>
      row(DISCOUNTS_SECTION, istDate(r.at), r.billNumber !== undefined ? `#${r.billNumber}` : r.orderId, r.kind, "", r.amount, r.by, ""),
    ),
  );
  rows.push(
    row(
      DISCOUNTS_SECTION,
      "",
      "",
      "",
      "",
      report.kpis.current.discounts.amount + report.kpis.current.rewards.amount,
      "",
      TOTAL_ROW_LABEL,
    ),
  );
  return rows;
}

/** One row per day, GST breakdown + documents issued, + a Total row. */
export function gstDayCsvRows(report: GstReport): CsvRow[] {
  const row = (
    day: string,
    bills: number,
    first: number | string,
    last: number | string,
    cancelled: number,
    taxable: number,
    gst: number,
    noGstBills: number | string,
    charges: number,
    value: number,
  ): CsvRow => ({
    Day: day,
    Bills: bills,
    "First bill": first,
    "Last bill": last,
    "Cancelled after billing": cancelled,
    "Taxable value": taxable,
    CGST: gst / HALF,
    SGST: gst / HALF,
    "Total GST": gst,
    "No-GST bills": noGstBills,
    "Charges (no GST)": charges,
    "Bill value": value,
  });

  const rows: CsvRow[] = report.days.map((d) =>
    row(d.date, d.bills, d.docs.first ?? "", d.docs.last ?? "", d.docs.cancelled, d.taxable, d.gst, "", d.charges, d.value),
  );
  rows.push(
    row(TOTAL_ROW_LABEL, report.bills, "", "", report.docs.cancelled, report.taxable, report.gst, report.noGstBills, report.charges, report.netSales),
  );
  return rows;
}

/** The bill-wise CSV (?bills=1) — one row per Completed bill, oldest first. */
export function gstBillCsvRows(rows: GstBillRow[]): CsvRow[] {
  return rows.map((r) => ({
    Date: r.date,
    "Bill no.": r.billNumber ?? "",
    "Order no.": r.orderId,
    "GST rate %": r.rate,
    "Taxable value": r.taxable,
    CGST: r.gst / HALF,
    SGST: r.gst / HALF,
    "No-GST value": r.noGst,
    Charges: r.charges,
    "Bill total": r.total,
    Payment: r.payment,
  }));
}
