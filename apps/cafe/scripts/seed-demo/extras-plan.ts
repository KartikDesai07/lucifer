/**
 * Pure planner for events, reservations, and due payments. No DB, no
 * Date.now() — every random/temporal decision comes from `ctx.rng`/`ctx.now`.
 * Events/reservations logic lives in extras-plan-events.ts (split out to stay
 * under the ~300-line cap); this file owns due payments + the entry point.
 */
import { randomUUID } from "node:crypto";
import type { PlanContext, PlannedOrder, PlannedDuePayment, ExtrasPlan } from "./types";
import { addMinutes, dayKeysEndingToday } from "./rng";
import { DUE_NOTES } from "./people-data";
import { planEvents, planReservations } from "./extras-plan-events";
import { roundTo } from "./extras-plan-dates";

// ── Due payments ─────────────────────────────────────────────────────────────
const DUE_PROBABILITY = 0.55;
const DUE_FIRST_MIN_FRACTION = 0.4;
const DUE_FIRST_MAX_FRACTION = 1.0;
const DUE_ROUND_TO = 10;
const DUE_MODE_WEIGHTS: { mode: "Cash" | "Online"; weight: number }[] = [
  { mode: "Cash", weight: 60 },
  { mode: "Online", weight: 40 },
];
const DUE_NOTE_CHANCE = 0.3;
const DUE_SECOND_PAYMENT_CHANCE = 0.5;
const DUE_AFTER_MIN_MINUTES = 30;
const DUE_AFTER_MAX_MINUTES = 60 * 24 * 3;

interface CustomerDue {
  amount: number;
  lastOrderAt: Date;
}

// Outstanding due + the instant it was left, per customer — mirrors the
// ledgerContribution() zero-rating in lib/order.ts: Cancelled and Unpaid
// orders contribute nothing.
function dueByCustomerOf(orders: readonly PlannedOrder[]): Map<string, CustomerDue> {
  const dueByCustomer = new Map<string, CustomerDue>();
  for (const order of orders) {
    if (!order.customerId) continue;
    if (order.status === "Cancelled") continue;
    if (order.payment === "Unpaid") continue;
    const due = Math.max(0, order.total - order.paidAmount);
    if (due <= 0) continue;
    const key = order.customerId.toHexString();
    const existing = dueByCustomer.get(key);
    const lastOrderAt = existing && existing.lastOrderAt > order.createdAt ? existing.lastOrderAt : order.createdAt;
    dueByCustomer.set(key, { amount: (existing?.amount ?? 0) + due, lastOrderAt });
  }
  return dueByCustomer;
}

function pickDuePayment(
  ctx: PlanContext,
  customerId: PlanContext["customers"][number]["_id"],
  amount: number,
  at: Date,
): PlannedDuePayment {
  return {
    customerId,
    amount,
    mode: ctx.rng.weighted(DUE_MODE_WEIGHTS, (w) => w.weight).mode,
    note: ctx.rng.chance(DUE_NOTE_CHANCE) ? ctx.rng.pick(DUE_NOTES) : undefined,
    receivedBy: ctx.rng.pick(ctx.staff).name,
    clientRef: randomUUID(),
    createdAt: at,
    updatedAt: at,
  };
}

function planDuePayments(ctx: PlanContext, orders: readonly PlannedOrder[]): PlannedDuePayment[] {
  const duePayments: PlannedDuePayment[] = [];
  const dueByCustomer = dueByCustomerOf(orders);

  for (const customer of ctx.customers) {
    const entry = dueByCustomer.get(customer._id.toHexString());
    if (!entry || entry.amount <= 0) continue;
    if (!ctx.rng.chance(DUE_PROBABILITY)) continue;

    let remaining = entry.amount;
    let lastAt = entry.lastOrderAt;

    const firstFraction = DUE_FIRST_MIN_FRACTION + ctx.rng.next() * (DUE_FIRST_MAX_FRACTION - DUE_FIRST_MIN_FRACTION);
    const firstAmount = Math.min(remaining, Math.max(DUE_ROUND_TO, roundTo(remaining * firstFraction, DUE_ROUND_TO)));
    if (firstAmount <= 0) continue;
    const firstAt = addMinutes(lastAt, ctx.rng.int(DUE_AFTER_MIN_MINUTES, DUE_AFTER_MAX_MINUTES));
    if (firstAt > ctx.now) continue; // never a future due payment
    duePayments.push(pickDuePayment(ctx, customer._id, firstAmount, firstAt));
    remaining -= firstAmount;
    lastAt = firstAt;

    if (remaining > 0 && ctx.rng.chance(DUE_SECOND_PAYMENT_CHANCE)) {
      const secondAmount = Math.min(remaining, Math.max(DUE_ROUND_TO, roundTo(remaining * ctx.rng.next(), DUE_ROUND_TO)));
      const secondAt = addMinutes(lastAt, ctx.rng.int(DUE_AFTER_MIN_MINUTES, DUE_AFTER_MAX_MINUTES));
      if (secondAmount > 0 && secondAt <= ctx.now) {
        duePayments.push(pickDuePayment(ctx, customer._id, secondAmount, secondAt));
      }
    }
  }

  return duePayments;
}

// ── Entry point ───────────────────────────────────────────────────────────────
export function planExtras(ctx: PlanContext, orders: PlannedOrder[], occupiedTables: string[]): ExtrasPlan {
  const todayKey = ctx.days[ctx.days.length - 1];
  const events = planEvents(ctx, todayKey);
  const { reservations, reservedTable } = planReservations(ctx, todayKey, occupiedTables);
  const duePayments = planDuePayments(ctx, orders);
  return { events, reservations, duePayments, reservedTable };
}

// Re-exported for the smoke script / tests, which need to build a fake ctx
// spanning the same day range this planner assumes.
export { dayKeysEndingToday };
