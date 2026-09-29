// buildDuesReport — the ONE place the Customer dues report's numbers are
// computed. Three independent reads: outstanding (LIVE, every customer who
// owes right now — not ranged), collected (DuePayment receipts in the range),
// creditGiven (new credit handed out on Completed bills in the range).
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { DuePayment } from "@/models/DuePayment";
import { ACTIVE_DUE_PAYMENT } from "@/lib/due-payment";
import { inWindow } from "@/lib/dashboard/pipelines";
import { currentWindow } from "@/lib/dashboard/range";
import { CREDIT_EXPR } from "@/lib/reports/received";
import type { DashboardRange } from "@/types/dashboard";
import type { DuesReceiptRow, DuesReport, OutstandingDueRow } from "@/types/reports";

export const OUTSTANDING_ROWS_LIMIT = 200;
export const DUES_RECEIPT_ROWS_LIMIT = 300;
const CASH_MODE = "Cash";
const ONLINE_MODE = "Online";

interface OutstandingTotalRow {
  total: number;
  count: number;
}
interface CustomerLean {
  _id: unknown;
  name: string;
  mobile: string;
  totalDue: number;
}
interface ReceiptModeRow {
  _id: string; // payment mode
  amount: number;
}
interface ReceiptLean {
  _id: unknown;
  customerId: unknown;
  amount: number;
  mode: string;
  receivedBy: string;
  createdAt: Date;
}
interface CreditGivenRow {
  total: number;
  orders: number;
}

export async function buildDuesReport(range: DashboardRange, now: Date = new Date()): Promise<DuesReport> {
  const current = currentWindow(range, now);

  const [outstandingTotalRows, outstandingRows, outstandingCount, modeRows, receiptRows, receiptCount, creditRows] =
    await Promise.all([
      Customer.aggregate<OutstandingTotalRow>([
        { $match: { totalDue: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$totalDue" }, count: { $sum: 1 } } },
      ]),
      Customer.find({ totalDue: { $gt: 0 } })
        .select("name mobile totalDue")
        .sort({ totalDue: -1, _id: 1 })
        .limit(OUTSTANDING_ROWS_LIMIT)
        .lean<CustomerLean[]>(),
      Customer.countDocuments({ totalDue: { $gt: 0 } }),
      DuePayment.aggregate<ReceiptModeRow>([
        { $match: { ...inWindow(current), ...ACTIVE_DUE_PAYMENT } },
        { $group: { _id: "$mode", amount: { $sum: "$amount" } } },
      ]),
      DuePayment.find({ ...inWindow(current), ...ACTIVE_DUE_PAYMENT })
        .select("customerId amount mode receivedBy createdAt")
        .sort({ createdAt: -1 })
        .limit(DUES_RECEIPT_ROWS_LIMIT)
        .lean<ReceiptLean[]>(),
      DuePayment.countDocuments({ ...inWindow(current), ...ACTIVE_DUE_PAYMENT }),
      Order.aggregate<CreditGivenRow>([
        { $match: { ...inWindow(current), status: "Completed" } },
        {
          $group: {
            _id: null,
            total: { $sum: CREDIT_EXPR },
            orders: { $sum: { $cond: [{ $gt: [CREDIT_EXPR, 0] }, 1, 0] } },
          },
        },
      ]),
    ]);

  const outstandingRowsOut: OutstandingDueRow[] = outstandingRows.map((c) => ({
    customerId: String(c._id),
    name: c.name,
    mobile: c.mobile,
    totalDue: c.totalDue,
  }));

  const names = await Customer.find({ _id: { $in: receiptRows.map((r) => r.customerId) } })
    .select("name")
    .lean<Array<{ _id: unknown; name: string }>>();
  const nameById = new Map(names.map((c) => [String(c._id), c.name]));

  const receiptRowsOut: DuesReceiptRow[] = receiptRows.map((r) => ({
    id: String(r._id),
    at: r.createdAt.toISOString(),
    customerId: String(r.customerId),
    customerName: nameById.get(String(r.customerId)) ?? "",
    amount: r.amount,
    mode: r.mode,
    receivedBy: r.receivedBy,
  }));

  const byMode = new Map(modeRows.map((r) => [r._id, r.amount]));
  const total = modeRows.reduce((s, r) => s + r.amount, 0);
  const cash = byMode.get(CASH_MODE) ?? 0;
  const online = byMode.get(ONLINE_MODE) ?? 0;

  const outstandingTotal = outstandingTotalRows[0];
  const credit = creditRows[0];

  return {
    range,
    outstanding: {
      total: outstandingTotal?.total ?? 0,
      customers: outstandingTotal?.count ?? 0,
      rows: outstandingRowsOut,
      truncated: outstandingCount > outstandingRowsOut.length,
    },
    collected: {
      cash,
      online,
      other: total - cash - online,
      total,
      // Every receipt in the range, not the capped rows shown below it.
      count: receiptCount,
      rows: receiptRowsOut,
      truncated: receiptCount > receiptRowsOut.length,
    },
    creditGiven: { total: credit?.total ?? 0, orders: credit?.orders ?? 0 },
  };
}
