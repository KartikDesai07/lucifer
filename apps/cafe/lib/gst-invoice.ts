// Print customization S10: which bills are GST tax invoices, and which numbers a paid bill still needs. Pure and
// client-safe: the settle and create routes, the create replay and the POS settle flow all ask this ONE rule, so the
// server never numbers a bill the screen would not wait for (and the other way round).
//
// A bill is a tax invoice by its OWN GST snapshot (gstMode / gstRate / gstAmount, written by every order writer),
// never by live settings: a tab opened with GST on and paid after GST was turned off still prints its GST lines, so
// it still needs its invoice number; a tab that never charged GST never takes one.
import { receiptGst, type GstConfig } from "@/lib/receipt";
import type { SeriesNumbering } from "@/lib/slip-numbers";

const ORDER_STATUS_COMPLETED = "Completed";

/** The live-settings fallback receiptGst takes here: none. Only the order's own snapshot can make it a tax invoice. */
export const NO_LIVE_GST: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };

type TaxedOrder = Parameters<typeof receiptGst>[0];

export interface NumberableOrder extends TaxedOrder {
  status: string;
  billNumber?: number;
  invoiceNumber?: number;
  invoiceFy?: number;
  createdAt?: Date | string;
}

/** True when the bill prints GST lines from its own snapshot: the same fact that makes it say "TAX INVOICE". */
export function isTaxInvoice(order: TaxedOrder): boolean {
  return receiptGst(order, NO_LIVE_GST).show;
}

/** A paid GST bill that does not hold its invoice number yet. */
export function invoicePending(order: NumberableOrder): boolean {
  return order.status === ORDER_STATUS_COMPLETED && order.invoiceNumber === undefined && isTaxInvoice(order);
}

/** The daily bill number a paid bill still needs: the series to draw from, when the cafe prints bill numbers. */
type BillSeries = SeriesNumbering & { showNumber: boolean };

/**
 * What to draw for a bill whose write has landed: `bill` = the daily bill number (only while "Show bill number" is
 * on), `invoiceAt` = the GST invoice serial, in the financial year of this instant (the order's createdAt: the date
 * the bill prints). Empty for an unpaid order and for a bill that already holds both.
 */
export interface BillNumberingPlan {
  bill?: SeriesNumbering;
  invoiceAt?: Date;
}

export function billNumberingPlan(order: NumberableOrder, bill: BillSeries): BillNumberingPlan {
  if (order.status !== ORDER_STATUS_COMPLETED) return {};
  const { numberStart, resetMinutes } = bill;
  return {
    ...(bill.showNumber && order.billNumber === undefined ? { bill: { numberStart, resetMinutes } } : {}),
    // A stored order always has createdAt (timestamps); the fallback only satisfies the type.
    ...(invoicePending(order) ? { invoiceAt: new Date(order.createdAt ?? Date.now()) } : {}),
  };
}

/** K1 (lib/settle-flow): a paid bill the server is still numbering — its bill number (numbered cafe) or invoice serial. */
export function numbersPending(order: NumberableOrder, billNumbered: boolean): boolean {
  return (billNumbered && typeof order.billNumber !== "number") || invoicePending(order);
}

export function planHasWork(plan: BillNumberingPlan): boolean {
  return plan.bill !== undefined || plan.invoiceAt !== undefined;
}
