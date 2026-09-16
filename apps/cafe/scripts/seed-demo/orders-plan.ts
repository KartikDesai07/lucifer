/**
 * Pure planner: builds a month of orders, self-order requests, per-day
 * counters, and the resulting table states — everything driven off `ctx.rng`
 * and `ctx.now`, never `Date.now()`. Thin orchestrator: per-day drafting/
 * resolution lives in orders-plan-day.ts, line composition in
 * orders-plan-lines.ts (both split out to stay under the file-size cap).
 */
import { Types } from "mongoose";
import { mintPublicCode } from "@/lib/public-token";
import { computeOrderTotals, type GstConfig, type OrderTotals } from "@/lib/receipt";
import type { DiscountKind } from "@/lib/constants";
import type { PlanContext, PlannedOrderRequest, PlannedCounters, OrdersPlan } from "./types";
import { addMinutes, dayKeyToCompact } from "./rng";
import { composeLines, pickLineCount } from "./orders-plan-lines";
import { planDay, pickReceiver, SELF_ORDER_COUNT, SELF_ORDER_DAY_START, SELF_ORDER_DAY_END } from "./orders-plan-day";
import { WALKIN_DINER_NAMES, WALKIN_DINER_MOBILE_PREFIX } from "./orders-plan-assemble";
import { SELF_ORDER_NOTES } from "./people-data";

const TODAY_PENDING_REQUEST_COUNT = 2;
const TODAY_REQUEST_LEAD_MIN_MINUTES = 3;
const TODAY_REQUEST_LEAD_MAX_MINUTES = 12;
const REJECTED_REASON = "Item not available right now";
const REQUEST_NOTE_CHANCE = 0.4;

function randomMobile(rng: PlanContext["rng"]): string {
  return `${WALKIN_DINER_MOBILE_PREFIX}${String(rng.int(0, 99999)).padStart(5, "0")}`;
}

// Builds today's two standalone `pending` requests + one `rejected` request
// (not on Occupied tables), each with its own composed line set and quoted
// totals — these never become Orders.
function planTodayStandaloneRequests(
  ctx: PlanContext,
  occupiedTableNos: ReadonlySet<string>,
): PlannedOrderRequest[] {
  const requests: PlannedOrderRequest[] = [];
  const freeTables = ctx.rng.shuffle(ctx.tables.filter((t) => !occupiedTableNos.has(t.tableNo)));

  const buildOne = (
    table: PlanContext["tables"][number],
  ): { subtotal: number; charge: number; items: PlannedOrderRequest["items"]; createdAt: Date } => {
    const lines = composeLines(ctx.rng, ctx.products, pickLineCount(ctx.rng));
    const subtotal = Math.round(lines.reduce((sum, l) => sum + l.price * l.qty, 0));
    const charge = table.chargeAmount ?? 0;
    const createdAt = addMinutes(ctx.now, -ctx.rng.int(TODAY_REQUEST_LEAD_MIN_MINUTES, TODAY_REQUEST_LEAD_MAX_MINUTES));
    return {
      subtotal,
      charge,
      createdAt,
      items: lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        price: l.price,
        qty: l.qty,
        variation: l.variation,
        modifiers: l.modifiers,
        instructions: l.instructions,
      })),
    };
  };

  for (let i = 0; i < TODAY_PENDING_REQUEST_COUNT && i < freeTables.length; i++) {
    const table = freeTables[i];
    const built = buildOne(table);
    requests.push({
      _id: new Types.ObjectId(),
      shortCode: mintPublicCode(),
      status: "pending",
      targetKind: "table",
      tableNo: table.tableNo,
      items: built.items,
      quotedSubtotal: built.subtotal,
      quotedCharge: built.charge,
      ...(table.chargeLabel ? { quotedChargeLabel: table.chargeLabel } : {}),
      quotedTotal: built.subtotal + built.charge,
      note: ctx.rng.chance(REQUEST_NOTE_CHANCE) ? ctx.rng.pick(SELF_ORDER_NOTES) : undefined,
      mobile: randomMobile(ctx.rng),
      name: ctx.rng.pick(WALKIN_DINER_NAMES),
      createdAt: built.createdAt,
      updatedAt: built.createdAt,
    });
  }

  if (freeTables.length > TODAY_PENDING_REQUEST_COUNT) {
    const table = freeTables[TODAY_PENDING_REQUEST_COUNT];
    const built = buildOne(table);
    requests.push({
      _id: new Types.ObjectId(),
      shortCode: mintPublicCode(),
      status: "rejected",
      targetKind: "table",
      tableNo: table.tableNo,
      items: built.items,
      quotedSubtotal: built.subtotal,
      quotedCharge: built.charge,
      ...(table.chargeLabel ? { quotedChargeLabel: table.chargeLabel } : {}),
      quotedTotal: built.subtotal + built.charge,
      mobile: randomMobile(ctx.rng),
      name: ctx.rng.pick(WALKIN_DINER_NAMES),
      rejectedReason: REJECTED_REASON,
      actor: pickReceiver(ctx.rng, ctx.staff).name,
      createdAt: built.createdAt,
      updatedAt: built.createdAt,
    });
  }

  return requests;
}

export function planOrders(ctx: PlanContext): OrdersPlan {
  const orders: OrdersPlan["orders"] = [];
  const requests: PlannedOrderRequest[] = [];
  const counters: PlannedCounters = {};
  const tableStates: OrdersPlan["tableStates"] = [];

  const todayKey = ctx.days[ctx.days.length - 1];

  // Pre-plan which days get a self-order (qr) order, so each day's planDay()
  // call knows how many of its drafts to mark.
  const selfOrderDayKeys = ctx.days.filter((_, idx) => {
    const offsetFromToday = idx - (ctx.days.length - 1); // 0 = today, negative = past
    return offsetFromToday >= SELF_ORDER_DAY_START && offsetFromToday <= SELF_ORDER_DAY_END;
  });
  const selfOrderDayPool = ctx.rng.shuffle(selfOrderDayKeys).slice(0, SELF_ORDER_COUNT);

  for (let dayIndex = 0; dayIndex < ctx.days.length; dayIndex++) {
    const dayKey = ctx.days[dayIndex];
    const isToday = dayKey === todayKey;
    const selfOrderWantedToday = selfOrderDayPool.filter((d) => d === dayKey).length;

    const dayResult = planDay(ctx, dayKey, dayIndex, ctx.days.length, isToday, selfOrderWantedToday);
    orders.push(...dayResult.orders);
    requests.push(...dayResult.requests);
    tableStates.push(...dayResult.tableStates);

    counters[`order-${dayKeyToCompact(dayKey)}`] = dayResult.counters.order;
    if (dayResult.counters.kot > 0) counters[`kot-${dayKeyToCompact(dayKey)}`] = dayResult.counters.kot;
    if (dayResult.counters.bill > 0) counters[`bill-${dayKeyToCompact(dayKey)}`] = dayResult.counters.bill;
  }

  const occupiedTableNos = new Set(tableStates.filter((t) => t.status === "Occupied").map((t) => t.tableNo));
  requests.push(...planTodayStandaloneRequests(ctx, occupiedTableNos));

  orders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return { orders, requests, counters, tableStates };
}

// Re-check helper used by tests/smoke: recompute an order's totals from its
// own stored items/discount/charge/gst, exactly as verifySeed will.
export function orderTotalsOf(
  items: ReadonlyArray<{ price: number; qty: number; reward?: boolean }>,
  discount: number,
  discountKind: DiscountKind | undefined,
  charge: number,
  gst: GstConfig,
): OrderTotals {
  return computeOrderTotals({ items, discount, discountKind, charge, cfg: gst });
}
