import type { GstMode } from "@/lib/constants";

// GST configuration as held in Settings — the only fields the calculations need.
export interface GstConfig {
  gstEnabled: boolean;
  gstRate: number; // percentage
  gstMode: GstMode; // "inclusive" | "exclusive"
}

// POS-side: the GST to ADD on top of a (discounted) base when the cafe runs in
// exclusive mode. Inclusive mode adds nothing (tax is already in the price).
// Rounded to whole rupees to match the app's currency formatting.
export function computeExclusiveGst(base: number, cfg: GstConfig): number {
  if (!cfg.gstEnabled || cfg.gstMode !== "exclusive" || cfg.gstRate <= 0) {
    return 0;
  }
  return Math.round((base * cfg.gstRate) / 100);
}

// The authoritative bill math, derived from the item lines + the cafe's GST
// config. Used server-side so the persisted order can never disagree with its
// own items (and the same formula the POS shows). Discount is clamped to the
// subtotal; everything is whole rupees.
export interface OrderTotals {
  subtotal: number;
  discount: number;
  gstAmount: number;
  total: number;
}

export function computeOrderTotals(
  items: ReadonlyArray<{ price: number; qty: number }>,
  discount: number,
  cfg: GstConfig,
): OrderTotals {
  const subtotal = Math.round(
    items.reduce((sum, i) => sum + i.price * i.qty, 0),
  );
  const clampedDiscount = Math.min(Math.max(0, Math.round(discount)), subtotal);
  const base = subtotal - clampedDiscount;
  const gstAmount = computeExclusiveGst(base, cfg);
  return { subtotal, discount: clampedDiscount, gstAmount, total: base + gstAmount };
}

// Receipt-side: the GST breakdown to display for a placed order.
export interface GstBreakdown {
  show: boolean;
  inclusive: boolean; // tax already in the total (vs added on top)
  taxable: number; // value before GST
  gstAmount: number; // GST portion
  rate: number;
}

export function receiptGst(
  order: { total: number; gstAmount?: number; gstRate?: number; gstMode?: GstMode },
  cfg: GstConfig,
): GstBreakdown {
  // Prefer the GST config snapshotted on the order (the tax actually charged at
  // sale time) so old receipts stay correct after the cafe changes its rate or
  // mode. Orders placed before snapshots existed fall back to current settings.
  const eff: GstConfig =
    order.gstMode != null
      ? {
          gstEnabled: (order.gstRate ?? 0) > 0,
          gstRate: order.gstRate ?? 0,
          gstMode: order.gstMode,
        }
      : cfg;

  const base = { show: false, inclusive: true, taxable: 0, gstAmount: 0, rate: eff.gstRate };
  if (!eff.gstEnabled || eff.gstRate <= 0) return base;

  if (eff.gstMode === "exclusive") {
    // Only orders that actually had GST added carry a gstAmount; older orders
    // (placed before GST was enabled) show no tax line.
    const gst = order.gstAmount ?? 0;
    if (gst <= 0) return base;
    return {
      show: true,
      inclusive: false,
      taxable: order.total - gst,
      gstAmount: gst,
      rate: eff.gstRate,
    };
  }

  // Inclusive: back-calculate the GST component out of the total.
  const taxable = Math.round(order.total / (1 + eff.gstRate / 100));
  return {
    show: true,
    inclusive: true,
    taxable,
    gstAmount: order.total - taxable,
    rate: eff.gstRate,
  };
}
