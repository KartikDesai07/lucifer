/**
 * Per-day KOT/bill numbering + void/cancel resolution + assembly, for
 * orders-plan.ts. Split out to keep files under the ~300-line cap: drafting
 * lives in orders-plan-draft.ts, line composition in orders-plan-lines.ts,
 * per-draft money/assembly in orders-plan-assemble.ts.
 *
 * VERIFIED FINDING (contrary to this plan's own assumption): the POS DOES
 * apply a product's `discount` % to the line price — see orders-plan-lines.ts's
 * file comment for the full trace (`hooks/use-cart.ts`'s `effectivePrice()` →
 * `effectiveUnitPrice()` from `@pos/shared/public`). The order-LEVEL `discount`
 * (computeOrderTotals) is a separate, additional discount on top.
 */
import { printedSlipNumber } from "@/lib/print";
import type { PlanContext, PlannedOrder, PlannedOrderVoid, PlannedOrderRequest, PlannedTableState } from "./types";
import { addMinutes, dayKeyToCompact } from "./rng";
import { VOID_REASONS } from "./people-data";
import { assembleOrder, type ResolvedDraft } from "./orders-plan-assemble";
import { draftDayOrders, pickReceiver, type DraftLine, type OrderDraft } from "./orders-plan-draft";

// Re-exported so orders-plan.ts (the orchestrator) only needs one import path
// for the drafting-side constants/helpers it still uses directly.
export { pickReceiver };

const TAKEAWAY_SETTLE_MIN_MINUTES = 2;
const TAKEAWAY_SETTLE_MAX_MINUTES = 5;
const DINEIN_SETTLE_MIN_MINUTES = 25;
const DINEIN_SETTLE_MAX_MINUTES = 70;
const CANCEL_MIN_MINUTES = 10;
const CANCEL_MAX_MINUTES = 40;
const VOID_MIN_MINUTES = 5;
const VOID_MAX_MINUTES = 20;
const CANCEL_CHANCE = 0.02;
const VOID_CHANCE = 0.015;

// ── Self-order (QR) — the pool sizing orders-plan.ts needs ────────────────
export const SELF_ORDER_COUNT = 6;
export const SELF_ORDER_DAY_START = -10;
export const SELF_ORDER_DAY_END = -1;

// Applies the 1.5% single-void rule to a Completed dine-in order with >=2
// lines: snapshots qty 1 of a random line, then reduces/removes it — BEFORE
// totals are computed by the caller. Never voids the last remaining line.
function maybeVoid(
  ctx: PlanContext,
  lines: DraftLine[],
  createdAt: Date,
  receiver: string,
  dineIn: boolean,
  nextKotNumber: () => number | undefined,
): PlannedOrderVoid | undefined {
  if (!dineIn) return undefined;
  if (lines.length < 2) return undefined;
  if (!ctx.rng.chance(VOID_CHANCE)) return undefined;

  const idx = ctx.rng.int(0, lines.length - 1);
  const line = lines[idx];
  const at = addMinutes(createdAt, ctx.rng.int(VOID_MIN_MINUTES, VOID_MAX_MINUTES));
  // When the cafe has switched numberVoidSlips off, void slips still go to
  // the kitchen but are not numbered.
  const kotNumber = ctx.print.kot.showNumber && ctx.print.kot.numberVoidSlips ? nextKotNumber() : undefined;

  const voidEntry: PlannedOrderVoid = {
    productId: line.productId,
    name: line.name,
    price: line.price,
    qty: 1,
    kotRound: line.kotRound,
    instructions: line.instructions || undefined,
    modifiers: line.modifiers.length > 0 ? line.modifiers : undefined,
    variation: line.variation,
    reason: ctx.rng.pick(VOID_REASONS),
    voidedBy: receiver,
    at,
    kotNumber,
  };

  if (line.qty <= 1) {
    lines.splice(idx, 1);
  } else {
    lines[idx] = { ...line, qty: line.qty - 1 };
  }
  return voidEntry;
}

export interface DayCounters {
  order: number;
  kot: number;
  bill: number;
}

export interface DayPlanResult {
  orders: PlannedOrder[];
  requests: PlannedOrderRequest[];
  tableStates: PlannedTableState[];
  counters: DayCounters;
}

// Resolves the void/cancel outcome of every non-pending draft (money and
// final assembly happen per-draft afterwards, once numbering is known).
function resolveDrafts(
  ctx: PlanContext,
  drafts: OrderDraft[],
  isToday: boolean,
  selfOrderDrafts: ReadonlySet<OrderDraft>,
  nextKotNumberFns: Map<OrderDraft, () => number | undefined>,
): ResolvedDraft[] {
  return drafts.map((draft) => {
    if (draft.isPending) {
      return { draft, lines: draft.lines, status: "Pending", selfOrder: false };
    }
    const dineIn = !!draft.tableNo;
    const settleAt = addMinutes(
      draft.secondRoundAt ?? draft.createdAt,
      dineIn
        ? ctx.rng.int(DINEIN_SETTLE_MIN_MINUTES, DINEIN_SETTLE_MAX_MINUTES)
        : ctx.rng.int(TAKEAWAY_SETTLE_MIN_MINUTES, TAKEAWAY_SETTLE_MAX_MINUTES),
    );
    const cappedSettleAt = isToday && settleAt > ctx.now ? ctx.now : settleAt;

    const lines = [...draft.lines];
    const voidEntry = maybeVoid(ctx, lines, draft.createdAt, draft.receiver.name, dineIn, nextKotNumberFns.get(draft)!);

    const cancelled = !isToday && ctx.rng.chance(CANCEL_CHANCE);
    return {
      draft,
      lines,
      voidEntry,
      status: cancelled ? "Cancelled" : "Completed",
      settleAt: cappedSettleAt,
      cancelAt: cancelled ? addMinutes(draft.createdAt, ctx.rng.int(CANCEL_MIN_MINUTES, CANCEL_MAX_MINUTES)) : undefined,
      selfOrder: selfOrderDrafts.has(draft),
    };
  });
}

// Resolves one full day: drafts orders, allocates KOT/bill numbers, applies
// voids/cancellations/payment, and marks self-order (qr) provenance for the
// day's share of the caller's self-order pool.
export function planDay(
  ctx: PlanContext,
  dayKey: string,
  dayIndex: number,
  totalDays: number,
  isToday: boolean,
  selfOrderWantedToday: number,
): DayPlanResult {
  const occupiedTablesToday = new Set<string>();
  const dayCounter: DayCounters = { order: 0, kot: 0, bill: 0 };
  const orders: PlannedOrder[] = [];
  const requests: PlannedOrderRequest[] = [];
  const tableStates: PlannedTableState[] = [];

  const drafts = draftDayOrders(ctx, dayKey, dayIndex, totalDays, isToday, occupiedTablesToday);

  const eligibleForSelfOrder = drafts.filter((d) => !d.isPending && d.tableNo);
  const selfOrderDrafts = new Set(ctx.rng.shuffle(eligibleForSelfOrder).slice(0, selfOrderWantedToday));

  // KOT numbering: allocate by the instant each round fired (round 1 =
  // createdAt, round 2 = secondRoundAt), across the whole day, in order.
  const firedRounds: { draft: OrderDraft; at: Date }[] = [];
  for (const draft of drafts) {
    firedRounds.push({ draft, at: draft.createdAt });
    if (draft.secondRoundAt) firedRounds.push({ draft, at: draft.secondRoundAt });
  }
  firedRounds.sort((a, b) => a.at.getTime() - b.at.getTime());

  let kotSeq = 0;
  const roundKotNumber = new Map<OrderDraft, number[]>();
  for (const fr of firedRounds) {
    kotSeq += 1;
    dayCounter.kot += 1;
    const nums = roundKotNumber.get(fr.draft) ?? [];
    const number = ctx.print.kot.showNumber ? printedSlipNumber(kotSeq, ctx.print.kot.numberStart) : undefined;
    if (number !== undefined) nums.push(number);
    roundKotNumber.set(fr.draft, nums);
  }
  const nextKotNumberFns = new Map<OrderDraft, () => number | undefined>();
  for (const draft of drafts) {
    nextKotNumberFns.set(draft, () => {
      kotSeq += 1;
      dayCounter.kot += 1;
      return ctx.print.kot.showNumber ? printedSlipNumber(kotSeq, ctx.print.kot.numberStart) : undefined;
    });
  }

  const resolved = resolveDrafts(ctx, drafts, isToday, selfOrderDrafts, nextKotNumberFns);

  // Bill numbers in settle order (Pending/Cancelled get none).
  const billOrder = resolved.filter((r) => r.status === "Completed").sort((a, b) => a.settleAt!.getTime() - b.settleAt!.getTime());
  let billSeq = 0;
  const billNumberOf = new Map<ResolvedDraft, number | undefined>();
  for (const r of billOrder) {
    billSeq += 1;
    dayCounter.bill += 1;
    billNumberOf.set(r, ctx.print.bill.showNumber ? printedSlipNumber(billSeq, ctx.print.bill.numberStart) : undefined);
  }

  let orderSeq = 0;
  for (const r of resolved) {
    orderSeq += 1;
    dayCounter.order += 1;
    const orderId = `ORD-${dayKeyToCompact(dayKey)}-${String(orderSeq).padStart(3, "0")}`;
    const kotNums = roundKotNumber.get(r.draft) ?? [];
    const billNumber = r.status === "Completed" ? billNumberOf.get(r) : undefined;

    const { order, request } = assembleOrder(ctx, orderId, r, kotNums, billNumber);
    orders.push(order);
    if (request) requests.push(request);
    if (r.status === "Pending") {
      tableStates.push({ tableNo: r.draft.tableNo!, status: "Occupied", currentOrderId: orderId });
    }
  }

  return { orders, requests, tableStates, counters: dayCounter };
}
