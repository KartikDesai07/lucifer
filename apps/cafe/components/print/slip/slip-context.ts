import type { SlipLockContext } from "@pos/shared/print-template";
import { SLIP_DEVANAGARI_RE } from "@pos/shared/print-fonts";
import { payQrMinutesOf, payQrModeOf, type PayQrMode } from "@pos/shared/print-qr";
import { receiptGst, type GstBreakdown, type GstConfig } from "@/lib/receipt";
import { productImageUrl } from "@/lib/images";
import type { Order, OrderItem, Settings } from "@/types";

// Pure per-slip derivations for the block engine (print customization S1). Each context is exactly the set of
// values the legacy OrderReceipt / KOTReceipt computed before their JSX, lifted out so every block renderer
// reads the same numbers — no JSX, no React, so the lock gate can use them too.

export interface BillSlipContext {
  order: Order;
  name: string | undefined;
  tagline: string | undefined;
  address: string | undefined;
  mobile: string | undefined;
  header: string | undefined;
  footer: string | undefined;
  gstNumber: string | undefined;
  fssai: string | undefined;
  logoUrl: string | null;
  // The cafe's UPI id, trimmed; the pay QR checks it (isValidUpiId) before printing.
  upiId: string | undefined;
  // The pay QR's owner-rule inputs (payQrPlan): when it prints, how long it stays valid, and the render-time clock.
  payQrMode: PayQrMode;
  payQrMinutes: number;
  nowMs: number;
  gst: GstBreakdown;
  due: number;
  isCancelled: boolean;
  // What loyalty rewards took off this bill: the free lines' worth plus any reward discount.
  rewardSaved: number;
}

// What a design's bill renderers receive: the context plus one fact only the whole slip knows (see KotRenderContext).
export interface BillRenderContext extends BillSlipContext {
  devanagari: boolean;
}

// The legacy bill's derivations (OrderReceipt.tsx:57-75). A receipt must never print a fallback brand, so every
// text value stays undefined when Settings hasn't set it.
export function billSlipContext(order: Order, settings: Settings | null | undefined, nowMs: number = Date.now()): BillSlipContext {
  const gstCfg: GstConfig = {
    gstEnabled: settings?.gstEnabled ?? false,
    gstRate: settings?.gstRate ?? 0,
    gstMode: settings?.gstMode ?? "inclusive",
  };
  return {
    order,
    name: settings?.restaurantName?.trim(),
    tagline: settings?.tagline?.trim(),
    address: settings?.address?.trim(),
    mobile: settings?.mobile?.trim(),
    header: settings?.receiptHeader?.trim(),
    footer: settings?.receiptFooter?.trim(),
    gstNumber: settings?.gstNumber?.trim(),
    fssai: settings?.fssai?.trim(),
    logoUrl: productImageUrl(settings?.logo, undefined, { fit: true }),
    upiId: settings?.upiId?.trim(),
    payQrMode: payQrModeOf(settings?.payQrMode),
    payQrMinutes: payQrMinutesOf(settings?.payQrValidMinutes),
    nowMs,
    gst: receiptGst(order, gstCfg),
    due: order.total - order.paidAmount,
    isCancelled: order.status === "Cancelled",
    rewardSaved:
      order.items.reduce((sum, item) => sum + (item.reward ? item.price * item.qty : 0), 0) +
      (order.discountKind === "reward" ? order.discount : 0),
  };
}

/** The KOTReceipt props the blocks print verbatim (the rest are folded into the context below). */
export interface KotSlipInput {
  roundItems?: OrderItem[];
  roundLabel?: string;
  roundNumber?: number;
  variant?: "kot" | "void" | "moved";
  reason?: string;
  voidedBy?: string;
  voidedAt?: string | Date;
  movedFrom?: string;
  movedBy?: string;
  movedAt?: string | Date;
  /** Phase 2 (spec §8): the station a routed KOT is for ("BAR", "ALL STATIONS"); absent in simple mode. */
  stationLine?: string;
}

export interface KotSlipContext {
  order: Order;
  items: OrderItem[];
  isVoid: boolean;
  isMoved: boolean;
  voidMeta: { by: string; at: string | Date } | null;
  movedMeta: { by: string; at: string | Date } | null;
  logoUrl: string | null;
  restaurantName: string | undefined;
  roundTotal: number;
  roundLabel: string | undefined;
  roundNumber: number | undefined;
  reason: string | undefined;
  movedFrom: string | undefined;
  stationLine: string | undefined;
}

// The legacy kitchen ticket's derivations (KOTReceipt.tsx:93-105).
export function kotSlipContext(
  order: Order,
  settings: Settings | null | undefined,
  props: KotSlipInput,
): KotSlipContext {
  const items = props.roundItems ?? order.items;
  const isVoid = props.variant === "void";
  const isMoved = props.variant === "moved";
  // Both-or-neither: a slip naming only one of who/when is worse than naming the tab's opener/open-time, so an
  // incomplete pair falls back to those. Same rule for the moved variant.
  const voidMeta = isVoid && props.voidedBy && props.voidedAt ? { by: props.voidedBy, at: props.voidedAt } : null;
  const movedMeta = isMoved && props.movedBy && props.movedAt ? { by: props.movedBy, at: props.movedAt } : null;
  return {
    order,
    items,
    isVoid,
    isMoved,
    voidMeta,
    movedMeta,
    logoUrl: productImageUrl(settings?.logo, undefined, { fit: true }),
    restaurantName: settings?.restaurantName?.trim(),
    // This round's own total — never the bill total.
    roundTotal: items.reduce((sum, it) => sum + it.price * it.qty, 0),
    roundLabel: props.roundLabel,
    roundNumber: props.roundNumber,
    reason: props.reason,
    movedFrom: props.movedFrom,
    stationLine: props.stationLine,
  };
}

// What the KOT block renderers receive: the context plus one fact only the template knows. The round total is
// "meaningless with no line amounts" (KOTReceipt.tsx), so it prints only when the template's visible items block
// shows prices — KotSlip computes this once, after the visibility filter.
export interface KotRenderContext extends KotSlipContext {
  showsPrices: boolean;
  // The slip carries Devanagari text, so a themed renderer that sets its own face adds the Devanagari family.
  devanagari: boolean;
}

// Whether any of the slip's text needs the Devanagari face (print-fonts.ts keeps that ~100 KB family off every slip
// that does not). JSON.stringify keeps non-ASCII text as is, so one test covers every nested string.
export function slipHasDevanagari(parts: readonly unknown[]): boolean {
  return SLIP_DEVANAGARI_RE.test(JSON.stringify(parts));
}

// Lock inputs (packages/shared print-template.ts SlipLockContext): a block the law or the kitchen needs prints
// even when the template turns it off.
export function billLockContext(ctx: BillSlipContext): SlipLockContext {
  return { gst: ctx.gst.show === true, fssai: Boolean(ctx.fssai), banner: false };
}

export function kotLockContext(ctx: KotSlipContext): SlipLockContext {
  return { gst: false, fssai: false, banner: ctx.isVoid || ctx.isMoved };
}
