/**
 * Turns one resolved order draft into the final `PlannedOrder` (+ its
 * self-order `PlannedOrderRequest` when applicable) — split out of
 * orders-plan-day.ts to stay under the file-size cap. Pure; every draw comes
 * from `ctx.rng`.
 */
import { Types } from "mongoose";
import { mintPublicCode } from "@/lib/public-token";
import { computeOrderTotals, type OrderTotals } from "@/lib/receipt";
import { derivePayment } from "@/lib/order";
import type {
  PlanContext,
  PlannedOrder,
  PlannedOrderItem,
  PlannedOrderVoid,
  PlannedOrderRequest,
  PlannedRequestItem,
} from "./types";
import type { PaymentMode } from "@/lib/constants";
import { addMinutes } from "./rng";
import type { DraftLine, OrderDraft } from "./orders-plan-draft";
import { CANCEL_REASONS, SELF_ORDER_NOTES } from "./people-data";

const FLAT_DISCOUNT_CHANCE = 0.08;
const FLAT_DISCOUNT_VALUES = [10, 20, 30, 50] as const;
const GST_DISCOUNT_CHANCE = 0.03;
const PAYMENT_WEIGHTS: { mode: PaymentMode; weight: number }[] = [
  { mode: "Cash", weight: 45 },
  { mode: "Online", weight: 42 },
  { mode: "Split", weight: 6 },
  { mode: "Due", weight: 5 },
  { mode: "Credit", weight: 2 },
];
const PARTIAL_CASH_CHANCE = 0.02;
const PARTIAL_SHORTFALLS = [50, 100, 200] as const;
const SPLIT_CASH_STEP = 50;
const SELF_ORDER_LEAD_MIN_MINUTES = 3;
const SELF_ORDER_LEAD_MAX_MINUTES = 8;
const SELF_ORDER_KOT_PRINT_LAG_MINUTES = 1;
const SELF_ORDER_SOURCE = "qr";
const SELF_ORDER_NOTE_CHANCE = 0.4;
export const WALKIN_DINER_NAMES = ["Rohit Sharma", "Kavya Menon", "Sahil Kapoor", "Meera Iyer"] as const;
export const WALKIN_DINER_MOBILE_PREFIX = "98765";

export interface ResolvedDraft {
  draft: OrderDraft;
  lines: DraftLine[];
  voidEntry?: PlannedOrderVoid;
  status: "Pending" | "Completed" | "Cancelled";
  settleAt?: Date;
  cancelAt?: Date;
  selfOrder: boolean;
}

function pickDiscount(ctx: PlanContext): { discount: number; discountKind?: "gst" } {
  if (ctx.gst.gstEnabled && ctx.rng.chance(GST_DISCOUNT_CHANCE)) {
    return { discount: 0, discountKind: "gst" };
  }
  if (ctx.rng.chance(FLAT_DISCOUNT_CHANCE)) {
    return { discount: ctx.rng.pick(FLAT_DISCOUNT_VALUES) };
  }
  return { discount: 0 };
}

function pickPayment(
  ctx: PlanContext,
  total: number,
  hasCustomer: boolean,
): { payment: PaymentMode; paidAmount: number; splitCash?: number; splitOnline?: number } {
  const pool = hasCustomer ? PAYMENT_WEIGHTS : PAYMENT_WEIGHTS.filter((w) => w.mode !== "Due" && w.mode !== "Credit");
  const mode = ctx.rng.weighted(pool, (w) => w.weight).mode;

  if (mode === "Split") {
    const maxSteps = Math.floor(total / SPLIT_CASH_STEP);
    const cash = maxSteps > 0 ? ctx.rng.int(0, maxSteps) * SPLIT_CASH_STEP : 0;
    const online = total - cash;
    const derived = derivePayment(mode, total, cash, online);
    if ("error" in derived) throw new Error(`planner bug: derivePayment(Split): ${derived.error}`);
    return { payment: mode, paidAmount: derived.paidAmount, splitCash: derived.splitCash, splitOnline: derived.splitOnline };
  }

  let paidAmount: number | undefined;
  if (mode === "Cash" && hasCustomer && ctx.rng.chance(PARTIAL_CASH_CHANCE)) {
    const shortfall = ctx.rng.pick(PARTIAL_SHORTFALLS);
    paidAmount = Math.max(0, total - shortfall);
  }
  const derived = derivePayment(mode, total, undefined, undefined, paidAmount);
  if ("error" in derived) throw new Error(`planner bug: derivePayment(${mode}): ${derived.error}`);
  return { payment: mode, paidAmount: derived.paidAmount };
}

export interface AssembledOrder {
  order: PlannedOrder;
  request?: PlannedOrderRequest;
}

// Builds the final PlannedOrder (money, payment, cancel/void fields) and, when
// this draft was picked as a self-order, its matching accepted
// PlannedOrderRequest — from one resolved draft + its already-allocated
// orderId/kotNumbers/billNumber.
export function assembleOrder(
  ctx: PlanContext,
  orderId: string,
  r: ResolvedDraft,
  kotNums: number[],
  billNumber: number | undefined,
): AssembledOrder {
  const items: PlannedOrderItem[] = r.lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    price: l.price,
    qty: l.qty,
    variation: l.variation,
    modifiers: l.modifiers,
    instructions: l.instructions,
    kotRound: l.kotRound,
  }));

  const charge = r.draft.chargeAmount ?? 0;
  const { discount, discountKind } =
    r.status === "Pending" ? { discount: 0, discountKind: undefined as "gst" | undefined } : pickDiscount(ctx);
  const totals: OrderTotals = computeOrderTotals({ items, discount, discountKind, charge, cfg: ctx.gst });

  let paidAmount = 0;
  let splitCash: number | undefined;
  let splitOnline: number | undefined;
  let finalPayment: PaymentMode = "Unpaid";
  if (r.status !== "Pending") {
    // Cancelled orders are modeled as created-then-cancelled: the money
    // fields carry exactly what a real settled-then-cancelled bill would
    // (never Unpaid — a still-open tab is never cancelled in this dataset).
    const paid = pickPayment(ctx, totals.total, !!r.draft.customer);
    finalPayment = paid.payment;
    paidAmount = paid.paidAmount;
    splitCash = paid.splitCash;
    splitOnline = paid.splitOnline;
  }

  const order: PlannedOrder = {
    orderId,
    customerId: r.draft.customer?._id,
    customerName: r.draft.customer?.name ?? "Walk-In",
    items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    ...(totals.discount > 0 && discountKind ? { discountKind } : {}),
    gstAmount: totals.gstAmount,
    gstRate: ctx.gst.gstEnabled ? ctx.gst.gstRate : 0,
    gstMode: ctx.gst.gstMode,
    ...(totals.charge > 0 ? { chargeAmount: totals.charge, chargeLabel: r.draft.chargeLabel } : {}),
    total: totals.total,
    paidAmount,
    payment: finalPayment,
    ...(splitCash !== undefined ? { splitCash } : {}),
    ...(splitOnline !== undefined ? { splitOnline } : {}),
    status: r.status,
    receiver: r.draft.receiver.name,
    staffId: r.draft.receiver._id,
    ...(r.draft.tableNo ? { tableNo: r.draft.tableNo } : {}),
    ...(r.draft.notes ? { notes: r.draft.notes } : {}),
    kotRounds: r.draft.secondRoundAt ? 2 : 1,
    ...(kotNums.length > 0 ? { kotNumbers: kotNums } : {}),
    ...(billNumber !== undefined ? { billNumber } : {}),
    ...(r.voidEntry ? { voids: [r.voidEntry] } : {}),
    ...(r.status === "Cancelled"
      ? {
          cancelReason: ctx.rng.pick(CANCEL_REASONS),
          cancelledBy: ctx.rng.pick(ctx.staff.map((s) => s.name)),
          cancelledAt: r.cancelAt,
        }
      : {}),
    ...(r.selfOrder ? { source: SELF_ORDER_SOURCE } : {}),
    createdAt: r.draft.createdAt,
    updatedAt: r.status === "Completed" ? r.settleAt! : r.status === "Cancelled" ? r.cancelAt! : (r.draft.secondRoundAt ?? r.draft.createdAt),
  };

  if (!r.selfOrder) return { order };

  const requestId = new Types.ObjectId();
  order.sourceRequestIds = [requestId];

  const roundOneItems = r.lines.filter((l) => l.kotRound === 1);
  const requestItems: PlannedRequestItem[] = roundOneItems.map((l) => ({
    productId: l.productId,
    name: l.name,
    price: l.price,
    qty: l.qty,
    variation: l.variation,
    modifiers: l.modifiers,
    instructions: l.instructions,
  }));
  const requestSubtotal = Math.round(roundOneItems.reduce((sum, l) => sum + l.price * l.qty, 0));
  const requestCreatedAt = addMinutes(r.draft.createdAt, -ctx.rng.int(SELF_ORDER_LEAD_MIN_MINUTES, SELF_ORDER_LEAD_MAX_MINUTES));
  const dinerName = r.draft.customer?.name ?? ctx.rng.pick(WALKIN_DINER_NAMES);
  const dinerMobile = r.draft.customer?.mobile ?? `${WALKIN_DINER_MOBILE_PREFIX}${String(ctx.rng.int(0, 99999)).padStart(5, "0")}`;

  const request: PlannedOrderRequest = {
    _id: requestId,
    shortCode: mintPublicCode(),
    status: "accepted",
    targetKind: "table",
    tableNo: r.draft.tableNo,
    items: requestItems,
    quotedSubtotal: requestSubtotal,
    quotedCharge: charge,
    ...(r.draft.chargeLabel ? { quotedChargeLabel: r.draft.chargeLabel } : {}),
    quotedTotal: requestSubtotal + charge,
    note: ctx.rng.chance(SELF_ORDER_NOTE_CHANCE) ? ctx.rng.pick(SELF_ORDER_NOTES) : undefined,
    mobile: dinerMobile,
    name: dinerName,
    acceptedOrderId: orderId,
    acceptedAt: r.draft.createdAt,
    actor: r.draft.receiver.name,
    acceptedKotRound: 1,
    kotPrintedAt: addMinutes(r.draft.createdAt, SELF_ORDER_KOT_PRINT_LAG_MINUTES),
    createdAt: requestCreatedAt,
    updatedAt: r.draft.createdAt,
  };

  return { order, request };
}
