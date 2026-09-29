// Pure CSV row builders for the Reports screens — plain objects for the
// existing lib/export.ts exportToCSV(data, filename) (headers = the first
// row's keys). Labels come from lib/money-breakdown.ts's own MONEY_BREAKDOWN_LINES
// so the CSV never re-types what the UI already shows. Signed-money rule:
// discounts/rewards are POSITIVE numbers under a label that already says
// what they are ("Discounts", "Rewards given") — never negative in the sheet.
import { MONEY_BREAKDOWN_LINES, MONEY_NET_LABEL } from "@/lib/money-breakdown";
import { dayLabel } from "@/lib/dashboard/range";
import { CAFE_TIMEZONE } from "@/lib/constants";
import type { DuesReceiptRow, OutstandingDueRow, SalesDayRow, SalesReport, DuesReport } from "@/types/reports";

type CsvRow = Record<string, string | number>;

const TOTAL_ROW_LABEL = "Total";

/** One row per day of the range + a final Total row equal to the report's own totals. */
export function salesCsvRows(report: SalesReport): CsvRow[] {
  const dayRow = (day: string, label: string, r: Pick<SalesDayRow, "orders" | "money" | "net" | "cash" | "online" | "other" | "credit">): CsvRow => {
    const row: CsvRow = { Day: label, Orders: r.orders };
    for (const line of MONEY_BREAKDOWN_LINES) row[line.label] = r.money[line.key];
    row[MONEY_NET_LABEL] = r.net;
    row.Cash = r.cash;
    row.Online = r.online;
    row["Other paid"] = r.other;
    row["Credit given"] = r.credit;
    return row;
  };

  const rows = report.days.map((d) => dayRow(d.date, dayLabel(d.date), d));
  rows.push(
    dayRow(TOTAL_ROW_LABEL, TOTAL_ROW_LABEL, {
      orders: report.days.reduce((s, d) => s + d.orders, 0),
      money: report.money,
      net: report.days.reduce((s, d) => s + d.net, 0),
      cash: report.received.cash,
      online: report.received.online,
      other: report.received.other,
      credit: report.received.credit,
    }),
  );
  return rows;
}

/** Daily cash/online/other tally (bills + dues receipts) + a Total row. */
export function paymentsCsvRows(report: SalesReport): CsvRow[] {
  const row = (label: string, d: Pick<SalesDayRow, "cash" | "online" | "other" | "credit" | "dues">): CsvRow => ({
    Day: label,
    "Cash from bills": d.cash,
    "Cash dues received": d.dues.cash,
    "Cash total": d.cash + d.dues.cash,
    "Online from bills": d.online,
    "Online dues received": d.dues.online,
    "Online total": d.online + d.dues.online,
    "Other paid": d.other,
    "Other dues received": d.dues.other,
    "Credit given": d.credit,
  });

  const rows = report.days.map((d) => row(dayLabel(d.date), d));
  rows.push(
    row(TOTAL_ROW_LABEL, {
      cash: report.received.cash,
      online: report.received.online,
      other: report.received.other,
      credit: report.received.credit,
      dues: report.dues,
    }),
  );
  return rows;
}

const OUTSTANDING_SECTION = "Outstanding now";
const RECEIVED_SECTION = "Received in range";
const CREDIT_SECTION = "Credit given in range";

/**
 * Two sections, outstanding balances then receipts in the range, each closed by
 * a Total row that is the report's OWN total — over every customer / receipt,
 * even when the listed rows are capped — so the sheet tallies with the screen.
 */
export function duesCsvRows(report: DuesReport): CsvRow[] {
  const outstandingRows: CsvRow[] = report.outstanding.rows.map((r: OutstandingDueRow) => ({
    Section: OUTSTANDING_SECTION,
    Date: "",
    Customer: r.name,
    Mobile: r.mobile,
    Mode: "",
    "Received by": "",
    Amount: r.totalDue,
  }));
  const receivedRows: CsvRow[] = report.collected.rows.map((r: DuesReceiptRow) => ({
    Section: RECEIVED_SECTION,
    Date: new Date(r.at).toLocaleString("en-IN", { timeZone: CAFE_TIMEZONE }),
    Customer: r.customerName,
    Mobile: "",
    Mode: r.mode,
    "Received by": r.receivedBy,
    Amount: r.amount,
  }));
  const totalRow = (section: string, amount: number): CsvRow => ({
    Section: section,
    Date: "",
    Customer: TOTAL_ROW_LABEL,
    Mobile: "",
    Mode: "",
    "Received by": "",
    Amount: amount,
  });
  return [
    ...outstandingRows,
    totalRow(OUTSTANDING_SECTION, report.outstanding.total),
    ...receivedRows,
    totalRow(RECEIVED_SECTION, report.collected.total),
    // The page's third headline figure: new credit on this range's bills.
    totalRow(CREDIT_SECTION, report.creditGiven.total),
  ];
}
