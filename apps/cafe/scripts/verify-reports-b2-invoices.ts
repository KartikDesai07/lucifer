/**
 * GST-invoice legs of the Reports Batch-2 live leg (print customization S10-D), split out of
 * verify-reports-b2-live.ts to keep that file small. Every number is hand-counted from the invoice block in
 * verify-reports-b2-seed.ts: FY 2026-27 serials 1..11 over O1 (27 Sep), O4 O7 O8 O9 O10 O11 O13(cancelled) O14
 * (28 Sep), O16 O17 (29 Sep); GST bills left without a number: O12 (28 Sep) and O18 (29 Sep); the legacy O2 is
 * never a tax invoice.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { Order } from "@/models/Order";
import { buildGstReport } from "@/lib/reports/gst-build";
import type { DashboardRange } from "@/types/dashboard";
import type { GstReport } from "@/types/reports-b2";

type Check = (label: string, ok: boolean) => void;

const FY = 2026;
const EXTRA_SERIAL = 12;
const EXTRA_TOTAL = 100;

function same(a: object, b: object): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function assertGstInvoices(check: Check, r: GstReport, withBills: GstReport): void {
  const [d27, d28, d29] = r.days;
  check("GST invoices: day27 fy2026 1..1 numbered1 cancelled0 without0", same(d27.invoices, { fy: FY, first: 1, last: 1, numbered: 1, cancelled: 0, without: 0 }));
  // O4 O7 O8 O9 O10 O11 O13 O14 hold 2..9; O12 is a GST bill with no number.
  check("GST invoices: day28 fy2026 2..9 numbered8 cancelled1(O13) without1(O12)", same(d28.invoices, { fy: FY, first: 2, last: 9, numbered: 8, cancelled: 1, without: 1 }));
  check("GST invoices: day29 fy2026 10..11 numbered2 cancelled0 without1(O18)", same(d29.invoices, { fy: FY, first: 10, last: 11, numbered: 2, cancelled: 0, without: 1 }));
  check("GST invoices: range fy2026 1..11 numbered11 cancelled1 without2", same(r.invoices, { fy: FY, first: 1, last: 11, numbered: 11, cancelled: 1, without: 2 }));
  check("GST invoices: the bill-number docs block is unchanged by invoices", r.docs.numbered === 15 && r.docs.cancelled === 1 && r.docs.unnumbered === 1);
  const rows = withBills.billRows ?? [];
  const withInvoice = rows.filter((x) => x.invoiceNumber !== undefined);
  check("GST invoices: 10 Completed bill rows carry an invoice (O13 is cancelled, so no row)", withInvoice.length === 10 && withInvoice.every((x) => x.invoiceFy === FY));
  check("GST invoices: the 27 Sep bill row is invoice 1", rows[0]?.invoiceNumber === 1 && rows[0]?.invoiceFy === FY);
}

/** A bill cancelled after payment with NO daily bill number still keeps its invoice and counts as cancelled. */
export async function assertCancelledInvoiceOnly(check: Check, range: DashboardRange, now: Date): Promise<void> {
  const cancelledBill: Record<string, unknown> = {
    orderId: "SCRATCH-RPTB2-invoice-only-cancel",
    customerName: "Walk-In",
    items: [],
    subtotal: EXTRA_TOTAL,
    discount: 0,
    gstAmount: 0,
    total: EXTRA_TOTAL,
    paidAmount: EXTRA_TOTAL,
    payment: "Cash",
    status: "Cancelled",
    receiver: "Verifier",
    kotRounds: 1,
    gstMode: "inclusive",
    gstRate: 5,
    invoiceNumber: EXTRA_SERIAL,
    invoiceFy: FY,
    createdAt: new Date("2026-09-29T05:00:00Z"), // 10:30 IST on 29 Sep, before NOW
  };
  await Order.insertMany([cancelledBill]);
  const after = await buildGstReport(range, now);
  const d29 = after.days[2];
  check("GST invoices: a Cancelled bill holding only an invoice is read (day29 numbered3 cancelled1 last12)", same(d29.invoices, { fy: FY, first: 10, last: EXTRA_SERIAL, numbered: 3, cancelled: 1, without: 1 }));
  check("GST invoices: that cancelled bill adds no money and no bill-number doc", after.bills === 15 && after.netSales === 2960 && same(d29.docs, { first: 1, last: 2, numbered: 2, cancelled: 0, unnumbered: 1 }));
}
