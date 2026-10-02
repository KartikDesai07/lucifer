import { computeOrderTotals, receiptGst } from "@/lib/receipt";
import type { GstBreakdown, GstConfig } from "@/lib/receipt";

// The GST & taxes preview prices ONE sample item through the very functions the
// real bill uses, with no arithmetic here, so it can never disagree with a bill.
export const SAMPLE_ITEM_PRICE = 100;

const MIN_GST_RATE = 0;
const MAX_GST_RATE = 100;

export interface SampleGstBill {
  subtotal: number;
  total: number;
  gst: GstBreakdown;
}

// null while the rate is blank (a cleared number input reads as NaN) or out of
// range, so the page shows a prompt rather than a made-up bill.
export function sampleGstBill(cfg: GstConfig): SampleGstBill | null {
  if (!Number.isFinite(cfg.gstRate) || cfg.gstRate < MIN_GST_RATE || cfg.gstRate > MAX_GST_RATE) {
    return null;
  }
  const totals = computeOrderTotals({
    items: [{ price: SAMPLE_ITEM_PRICE, qty: 1 }],
    discount: 0,
    discountKind: undefined,
    charge: 0,
    cfg,
  });
  // The same GST snapshot rule app/api/orders/route.ts stamps on a new order.
  const gst = receiptGst(
    {
      total: totals.total,
      gstAmount: totals.gstAmount,
      gstRate: cfg.gstEnabled ? cfg.gstRate : 0,
      gstMode: cfg.gstMode,
    },
    cfg,
  );
  return { subtotal: totals.subtotal, total: totals.total, gst };
}
