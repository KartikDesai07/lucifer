import { TABLE_CHARGE_MAX, type GstMode } from "@/lib/constants";

// GST configuration as held in Settings — the only fields the calculations need.
export interface GstConfig {
  gstEnabled: boolean;
  gstRate: number; // percentage
  gstMode: GstMode; // "inclusive" | "exclusive"
}

// Client-side twin of `lib/settings.gstConfigOf` — same defaults, but accepts
// a possibly-still-loading (undefined) or partial Settings object, so client
// components can build a GstConfig straight from the TanStack Query hook
// without waiting on a fully-typed ISettings doc.
export function gstConfigOfSettings(
  settings: { gstEnabled?: boolean; gstRate?: number; gstMode?: GstMode } | undefined,
): GstConfig {
  return {
    gstEnabled: settings?.gstEnabled ?? false,
    gstRate: settings?.gstRate ?? 0,
    gstMode: settings?.gstMode ?? "inclusive",
  };
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

// ── Table charge ─────────────────────────────────────────────────────────────
// What a table is configured to add to a bill. ONE implementation, used by both
// sides: the POS reads it off the selected table to show the operator, and the
// order route re-reads it off the stored document to price the bill. If these
// two ever disagreed, the counter would show one figure and the customer would
// be charged another.

export interface TableChargeConfig {
  amount: number; // whole rupees; 0 = this table adds nothing
  label: string; // "" exactly when amount is 0
}

export const NO_TABLE_CHARGE: TableChargeConfig = { amount: 0, label: "" };

// A charge must be NAMED to be chargeable: an amount with no label would print
// as a bare rupee figure the customer cannot question, so an unnamed charge is
// treated as no charge at all rather than as a mystery line on the slip.
export function tableChargeOf(
  table: { chargeAmount?: number; chargeLabel?: string } | null | undefined,
): TableChargeConfig {
  const amount = Math.max(0, Math.round(table?.chargeAmount ?? 0));
  const label = (table?.chargeLabel ?? "").trim();
  if (amount <= 0 || !label) return NO_TABLE_CHARGE;
  return { amount, label };
}

// The authoritative bill math, derived from the item lines + the cafe's GST
// config. Used server-side so the persisted order can never disagree with its
// own items (and the same formula the POS shows). Discount is clamped to the
// subtotal; everything is whole rupees.
export interface OrderTotals {
  subtotal: number;
  discount: number;
  gstAmount: number;
  charge: number; // the table's extra charge, after clamping
  total: number;
}

export interface OrderTotalsInput {
  items: ReadonlyArray<{ price: number; qty: number }>;
  discount: number;
  // The table's extra charge, in rupees. REQUIRED, and an options object rather
  // than a fourth positional argument, both for the same reason: every writer
  // that re-prices a bill (create, add-a-round, settle) has to state out loud
  // what happens to the charge. Defaulting it to 0 would let a writer that
  // never heard of charges silently wipe one off a tab mid-service — the
  // reciprocal-guard failure CR1.3 hit when only one writer of a document knew
  // about a new field. Here the type checker is the guard.
  charge: number;
  cfg: GstConfig;
}

export function computeOrderTotals({
  items,
  discount,
  charge,
  cfg,
}: OrderTotalsInput): OrderTotals {
  const subtotal = Math.round(
    items.reduce((sum, i) => sum + i.price * i.qty, 0),
  );
  const clampedDiscount = Math.min(Math.max(0, Math.round(discount)), subtotal);
  const base = subtotal - clampedDiscount;
  const gstAmount = computeExclusiveGst(base, cfg);
  // The charge rides on TOP of the taxed bill and is not part of the taxable
  // base (owner decision, 2026-08-16) — which is why GST is computed above it,
  // not after. It is also outside the discount: a percentage off the food does
  // not quietly become a percentage off the cover charge.
  const clampedCharge = Math.min(Math.max(0, Math.round(charge)), TABLE_CHARGE_MAX);
  return {
    subtotal,
    discount: clampedDiscount,
    gstAmount,
    charge: clampedCharge,
    total: base + gstAmount + clampedCharge,
  };
}

// Rebuild the GstConfig that was in effect when an order was created, from the
// rate/mode snapshotted on the order — so recomputing money while adding items
// to an open tab uses the tab's original tax, not whatever the cafe set later.
// Pre-snapshot legacy orders (gstMode == null) fall back to the live config;
// those are always already-Completed historical orders, never open tabs (POST
// writes a snapshot on every order).
export function gstConfigFromOrder(
  order: { gstRate?: number; gstMode?: GstMode },
  liveFallback: GstConfig,
): GstConfig {
  if (order.gstMode == null) return liveFallback;
  return {
    gstEnabled: (order.gstRate ?? 0) > 0,
    gstRate: order.gstRate ?? 0,
    gstMode: order.gstMode,
  };
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
  order: {
    total: number;
    gstAmount?: number;
    gstRate?: number;
    gstMode?: GstMode;
    // The table charge folded into `total`. It is NOT taxed, so both branches
    // below have to lift it back out before they reason about tax: exclusive
    // mode would otherwise report it as taxable value, and inclusive mode would
    // back-calculate GST out of money that never carried any — inventing tax on
    // a cover charge and under-reporting the food's own.
    chargeAmount?: number;
  },
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

  // The billed total minus the untaxed table charge — i.e. the part of what the
  // customer pays that tax has anything to do with.
  const taxedTotal = order.total - (order.chargeAmount ?? 0);

  if (eff.gstMode === "exclusive") {
    // Only orders that actually had GST added carry a gstAmount; older orders
    // (placed before GST was enabled) show no tax line.
    const gst = order.gstAmount ?? 0;
    if (gst <= 0) return base;
    return {
      show: true,
      inclusive: false,
      taxable: taxedTotal - gst,
      gstAmount: gst,
      rate: eff.gstRate,
    };
  }

  // Inclusive: back-calculate the GST component out of the taxed portion.
  const taxable = Math.round(taxedTotal / (1 + eff.gstRate / 100));
  return {
    show: true,
    inclusive: true,
    taxable,
    gstAmount: taxedTotal - taxable,
    rate: eff.gstRate,
  };
}
