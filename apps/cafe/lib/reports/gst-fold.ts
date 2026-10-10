// Order rows -> GstReport — pure (no DB), a JS fold rather than a pipeline
// twin: Mongo's $round is banker's rounding (round-half-to-even) while the
// printed bill rounds half-up (receiptGst -> Math.round), so a $group-based
// GST report would silently disagree with the paper on a ₹x.50 bill. This
// file therefore CALLS receiptGst() per order — never re-derives its rule —
// so the report and the reprinted bill can never drift apart.
import { receiptGst, type GstConfig } from "@/lib/receipt";
import { addDays } from "@/lib/dashboard/range";
import { cafeDateString } from "@/lib/utils";
import { isTaxInvoice } from "@/lib/gst-invoice";
import type { GstMode } from "@/lib/constants";
import type { DashboardRange } from "@/types/dashboard";
import type { GstBillRow, GstDayRow, GstDocs, GstInvoices, GstRateRow, GstReport } from "@/types/reports-b2";

const COMPLETED = "Completed";
const CANCELLED = "Cancelled";

export interface GstOrderView {
  orderId: string;
  createdAt: Date;
  status: string;
  total: number;
  gstAmount?: number;
  gstRate?: number;
  gstMode?: GstMode;
  chargeAmount?: number;
  billNumber?: number;
  invoiceNumber?: number;
  invoiceFy?: number;
  payment?: string;
}

export interface GstBillBreakdown {
  rate: number;
  inclusive: boolean;
  taxable: number;
  gst: number;
  noGst: number;
  charges: number;
  total: number;
}

/** One bill's GST breakdown — CALLS receiptGst(), never re-derives it (a source pin checks this). */
export function gstOfBill(order: GstOrderView, liveCfg: GstConfig): GstBillBreakdown {
  const g = receiptGst(order, liveCfg);
  const charges = order.chargeAmount ?? 0;
  if (g.show) {
    return { rate: g.rate, inclusive: g.inclusive, taxable: g.taxable, gst: g.gstAmount, noGst: 0, charges, total: order.total };
  }
  return { rate: 0, inclusive: false, taxable: 0, gst: 0, noGst: order.total - charges, charges, total: order.total };
}

interface InvoiceEntry {
  fy: number;
  serial: number;
}

/**
 * One day's (or the whole range's) GST invoice summary. The serials are only comparable inside one financial year,
 * so first/last are given only when every numbered invoice is in the same year; across 1 April they are null and
 * only the counts are reported.
 */
function summarizeInvoices(entries: InvoiceEntry[], cancelled: number, without: number): GstInvoices {
  const fys = new Set(entries.map((e) => e.fy));
  const single = fys.size === 1;
  const serials = entries.map((e) => e.serial);
  return {
    fy: single ? entries[0].fy : null,
    first: single ? Math.min(...serials) : null,
    last: single ? Math.max(...serials) : null,
    numbered: entries.length,
    cancelled,
    without,
  };
}

interface DayAccumulator {
  bills: number;
  taxable: number;
  gst: number;
  noGst: number;
  charges: number;
  value: number;
  noGstBills: number;
  numbered: number;
  cancelled: number;
  unnumbered: number;
  billNumbers: number[];
  invoices: InvoiceEntry[];
  invoicesCancelled: number;
  invoicesWithout: number;
}

function emptyDay(): DayAccumulator {
  return { bills: 0, taxable: 0, gst: 0, noGst: 0, charges: 0, value: 0, noGstBills: 0, numbered: 0, cancelled: 0, unnumbered: 0, billNumbers: [], invoices: [], invoicesCancelled: 0, invoicesWithout: 0 };
}

export interface FoldGstReportInput {
  range: DashboardRange;
  orders: GstOrderView[];
  liveCfg: GstConfig;
  withBills: boolean;
}

export function foldGstReport({ range, orders, liveCfg, withBills }: FoldGstReportInput): GstReport {
  const byDay = new Map<string, DayAccumulator>();
  const getDay = (day: string) => {
    const acc = byDay.get(day) ?? emptyDay();
    byDay.set(day, acc);
    return acc;
  };

  const rateAgg = new Map<number, { bills: number; taxable: number; gst: number }>();
  const billRows: GstBillRow[] = [];

  for (const order of orders) {
    const day = cafeDateString(order.createdAt);
    const acc = getDay(day);

    // Documents-issued block: every row with a numeric billNumber counts here
    // (Completed OR Cancelled-after-billing), regardless of the money block.
    if (typeof order.billNumber === "number") {
      acc.numbered += 1;
      acc.billNumbers.push(order.billNumber);
      if (order.status === CANCELLED) acc.cancelled += 1;
    } else if (order.status === COMPLETED) {
      acc.unnumbered += 1;
    }

    // GST invoice serials (S10): a paid GST bill holds one; a Completed GST bill without one is reported, never hidden.
    // Bucketed by the same createdAt day as everything else — the restart time never reaches this report.
    if (typeof order.invoiceNumber === "number" && typeof order.invoiceFy === "number") {
      acc.invoices.push({ fy: order.invoiceFy, serial: order.invoiceNumber });
      if (order.status === CANCELLED) acc.invoicesCancelled += 1;
    } else if (order.status === COMPLETED && isTaxInvoice(order)) {
      acc.invoicesWithout += 1;
    }

    if (order.status !== COMPLETED) continue;

    const b = gstOfBill(order, liveCfg);
    acc.bills += 1;
    acc.taxable += b.taxable;
    acc.gst += b.gst;
    acc.noGst += b.noGst;
    acc.charges += b.charges;
    acc.value += order.total;
    if (b.rate === 0) acc.noGstBills += 1;

    if (b.rate > 0) {
      const r = rateAgg.get(b.rate) ?? { bills: 0, taxable: 0, gst: 0 };
      r.bills += 1;
      r.taxable += b.taxable;
      r.gst += b.gst;
      rateAgg.set(b.rate, r);
    }

    if (withBills) {
      billRows.push({
        date: day,
        at: order.createdAt.toISOString(),
        ...(typeof order.billNumber === "number" ? { billNumber: order.billNumber } : {}),
        ...(typeof order.invoiceNumber === "number" && typeof order.invoiceFy === "number"
          ? { invoiceNumber: order.invoiceNumber, invoiceFy: order.invoiceFy }
          : {}),
        orderId: order.orderId,
        rate: b.rate,
        inclusive: b.inclusive,
        taxable: b.taxable,
        gst: b.gst,
        noGst: b.noGst,
        charges: b.charges,
        total: b.total,
        payment: order.payment ?? "",
      });
    }
  }

  const days: GstDayRow[] = [];
  for (let key = range.from; key <= range.to; key = addDays(key, 1)) {
    const acc = byDay.get(key) ?? emptyDay();
    const docs: GstDocs = {
      first: acc.billNumbers.length > 0 ? Math.min(...acc.billNumbers) : null,
      last: acc.billNumbers.length > 0 ? Math.max(...acc.billNumbers) : null,
      numbered: acc.numbered,
      cancelled: acc.cancelled,
      unnumbered: acc.unnumbered,
    };
    days.push({
      date: key,
      bills: acc.bills,
      taxable: acc.taxable,
      gst: acc.gst,
      noGst: acc.noGst,
      charges: acc.charges,
      value: acc.value,
      docs,
      invoices: summarizeInvoices(acc.invoices, acc.invoicesCancelled, acc.invoicesWithout),
    });
  }

  const rates: GstRateRow[] = [...rateAgg.entries()]
    .map(([rate, v]) => ({ rate, bills: v.bills, taxable: v.taxable, gst: v.gst, value: v.taxable + v.gst }))
    .sort((a, b) => b.rate - a.rate);

  const totals = days.reduce(
    (acc, d) => ({
      bills: acc.bills + d.bills,
      taxable: acc.taxable + d.taxable,
      gst: acc.gst + d.gst,
      noGst: acc.noGst + d.noGst,
      charges: acc.charges + d.charges,
      value: acc.value + d.value,
      numbered: acc.numbered + d.docs.numbered,
      cancelled: acc.cancelled + d.docs.cancelled,
      unnumbered: acc.unnumbered + d.docs.unnumbered,
    }),
    { bills: 0, taxable: 0, gst: 0, noGst: 0, charges: 0, value: 0, numbered: 0, cancelled: 0, unnumbered: 0 },
  );
  let noGstBills = 0;
  const rangeInvoices: InvoiceEntry[] = [];
  let invoicesCancelled = 0;
  let invoicesWithout = 0;
  for (const acc of byDay.values()) {
    noGstBills += acc.noGstBills;
    rangeInvoices.push(...acc.invoices);
    invoicesCancelled += acc.invoicesCancelled;
    invoicesWithout += acc.invoicesWithout;
  }

  return {
    range,
    bills: totals.bills,
    taxable: totals.taxable,
    gst: totals.gst,
    noGst: totals.noGst,
    noGstBills,
    charges: totals.charges,
    netSales: totals.value,
    rates,
    days,
    docs: { numbered: totals.numbered, cancelled: totals.cancelled, unnumbered: totals.unnumbered },
    invoices: summarizeInvoices(rangeInvoices, invoicesCancelled, invoicesWithout),
    ...(withBills ? { billRows: billRows.sort((a, b) => a.at.localeCompare(b.at) || a.orderId.localeCompare(b.orderId)) } : {}),
  };
}
