/**
 * Per-day order drafting (timing, table/customer/receiver pick, line
 * composition) — split out of orders-plan-day.ts to stay under the
 * file-size cap. No money/payment/void/cancel here; that happens once
 * numbering is known (orders-plan-day.ts / orders-plan-assemble.ts).
 */
import type { PlanContext, PlannedOrderItem } from "./types";
import { istInstant, addMinutes, weekdayOf } from "./rng";
import { composeLines, pickLineCount } from "./orders-plan-lines";
import { ORDER_NOTES } from "./people-data";

// ── Volume ────────────────────────────────────────────────────────────────
const BASE_VOLUME = 22;
const FRIDAY_VOLUME = 28;
const WEEKEND_VOLUME = 36;
const VOLUME_NOISE_BASE = 0.85;
const VOLUME_NOISE_SPREAD = 0.3;
const GROWTH_START = 1.0;
const GROWTH_END = 1.12;
export const TODAY_FRACTION = 0.55;
export const TODAY_PENDING_COUNT = 3;
const TODAY_PENDING_MIN_AGO = 5;
const TODAY_PENDING_MAX_AGO = 40;

// ── Order timing ──────────────────────────────────────────────────────────
const HOUR_WEIGHTS: Record<number, number> = {
  11: 3, 12: 5, 13: 6, 14: 4, 15: 3,
  16: 8, 17: 9, 18: 9, 19: 8,
  20: 8, 21: 7, 22: 5,
};
const SECOND_ROUND_MIN_MINUTES = 15;
const SECOND_ROUND_MAX_MINUTES = 35;

// ── Composition ───────────────────────────────────────────────────────────
const SECOND_ROUND_CHANCE = 0.15;
const DINEIN_CHANCE = 0.6;
const CUSTOMER_ORDER_CHANCE = 0.45;
const VIP_WEIGHT_MULTIPLIER = 3;
const ORDER_NOTE_CHANCE = 0.06;

function dailyVolume(rng: PlanContext["rng"], dayKey: string, dayIndex: number, totalDays: number): number {
  const weekday = weekdayOf(dayKey);
  const base = weekday === 5 ? FRIDAY_VOLUME : weekday === 0 || weekday === 6 ? WEEKEND_VOLUME : BASE_VOLUME;
  const noise = VOLUME_NOISE_BASE + rng.next() * VOLUME_NOISE_SPREAD;
  const growth = totalDays > 1 ? GROWTH_START + (GROWTH_END - GROWTH_START) * (dayIndex / (totalDays - 1)) : GROWTH_START;
  return Math.round(base * noise * growth);
}

function pickOrderHour(rng: PlanContext["rng"]): number {
  const entries = Object.entries(HOUR_WEIGHTS).map(([hour, weight]) => ({ hour: Number(hour), weight }));
  return rng.weighted(entries, (e) => e.weight).hour;
}

function pickDineInTable(
  rng: PlanContext["rng"],
  tables: PlanContext["tables"],
  occupiedTablesToday: Set<string>,
): PlanContext["tables"][number] | undefined {
  const free = tables.filter((t) => !occupiedTablesToday.has(t.tableNo));
  if (free.length === 0) return undefined;
  return rng.weighted(free, (t) => (t.capacity <= 4 ? 3 : 1));
}

function pickCustomer(
  rng: PlanContext["rng"],
  customers: PlanContext["customers"],
): PlanContext["customers"][number] | undefined {
  if (customers.length === 0) return undefined;
  return rng.weighted(customers, (c) => (c.notes === "VIP" ? VIP_WEIGHT_MULTIPLIER : 1));
}

export function pickReceiver(rng: PlanContext["rng"], staff: PlanContext["staff"]): PlanContext["staff"][number] {
  return rng.weighted(staff, (s) => s.weight);
}

export interface DraftLine {
  productId: PlannedOrderItem["productId"];
  name: string;
  price: number;
  qty: number;
  variation?: string;
  modifiers: string[];
  instructions: string;
  kotRound: number;
}

export interface OrderDraft {
  dayKey: string;
  createdAt: Date;
  customer?: PlanContext["customers"][number];
  tableNo?: string;
  chargeAmount?: number;
  chargeLabel?: string;
  lines: DraftLine[];
  receiver: PlanContext["staff"][number];
  notes?: string;
  isPending: boolean; // today's 3 open tabs
  secondRoundAt?: Date;
}

function buildLines(
  ctx: PlanContext,
  createdAt: Date,
  dineIn: boolean,
  isPending: boolean,
): { lines: DraftLine[]; secondRoundAt?: Date } {
  const count = pickLineCount(ctx.rng);
  const composed = composeLines(ctx.rng, ctx.products, count);
  const lines: DraftLine[] = composed.map((l) => ({ ...l, kotRound: 1 }));

  let secondRoundAt: Date | undefined;
  if (!isPending && dineIn && ctx.rng.chance(SECOND_ROUND_CHANCE)) {
    const extraCount = ctx.rng.int(1, 2);
    const extra = composeLines(ctx.rng, ctx.products, extraCount).filter(
      (l) => !lines.some((existing) => existing.productId.equals(l.productId)),
    );
    if (extra.length > 0) {
      secondRoundAt = addMinutes(createdAt, ctx.rng.int(SECOND_ROUND_MIN_MINUTES, SECOND_ROUND_MAX_MINUTES));
      lines.push(...extra.map((l) => ({ ...l, kotRound: 2 })));
    }
  }
  return { lines, secondRoundAt };
}

// One day's worth of order drafts (timing + composition, no money/payment yet).
export function draftDayOrders(
  ctx: PlanContext,
  dayKey: string,
  dayIndex: number,
  totalDays: number,
  isToday: boolean,
  occupiedTablesToday: Set<string>,
): OrderDraft[] {
  const volume = dailyVolume(ctx.rng, dayKey, dayIndex, totalDays);
  const targetCount = isToday ? Math.round(volume * TODAY_FRACTION) : volume;
  const drafts: OrderDraft[] = [];

  for (let i = 0; i < targetCount; i++) {
    const hour = pickOrderHour(ctx.rng);
    const minute = ctx.rng.int(0, 59);
    const second = ctx.rng.int(0, 59);
    const createdAt = istInstant(dayKey, hour, minute, second);
    if (isToday && createdAt > ctx.now) continue; // never an order after "now"

    const dineIn = ctx.rng.chance(DINEIN_CHANCE);
    const table = dineIn ? pickDineInTable(ctx.rng, ctx.tables, occupiedTablesToday) : undefined;
    const customer = ctx.rng.chance(CUSTOMER_ORDER_CHANCE) ? pickCustomer(ctx.rng, ctx.customers) : undefined;
    const receiver = pickReceiver(ctx.rng, ctx.staff);
    const notes = ctx.rng.chance(ORDER_NOTE_CHANCE) ? ctx.rng.pick(ORDER_NOTES) : undefined;
    const { lines, secondRoundAt } = buildLines(ctx, createdAt, dineIn, false);

    drafts.push({
      dayKey,
      createdAt,
      customer,
      tableNo: table?.tableNo,
      chargeAmount: table?.chargeAmount,
      chargeLabel: table?.chargeLabel,
      lines,
      receiver,
      notes,
      isPending: false,
      secondRoundAt,
    });
  }

  // Sort by createdAt; nudge exact collisions forward by 1s so every order in
  // the day has a strictly increasing createdAt (NNN assignment relies on it).
  drafts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (let i = 1; i < drafts.length; i++) {
    if (drafts[i].createdAt.getTime() <= drafts[i - 1].createdAt.getTime()) {
      drafts[i].createdAt = new Date(drafts[i - 1].createdAt.getTime() + 1000);
    }
  }

  if (isToday) {
    const usedTables = new Set(drafts.map((d) => d.tableNo).filter((t): t is string => !!t));
    const availableForPending = ctx.tables.filter((t) => !usedTables.has(t.tableNo));
    const pendingTables = ctx.rng.shuffle(availableForPending).slice(0, TODAY_PENDING_COUNT);
    for (const table of pendingTables) {
      const minutesAgo = ctx.rng.int(TODAY_PENDING_MIN_AGO, TODAY_PENDING_MAX_AGO);
      const createdAt = addMinutes(ctx.now, -minutesAgo);
      const { lines, secondRoundAt } = buildLines(ctx, createdAt, true, true);
      const customer = ctx.rng.chance(CUSTOMER_ORDER_CHANCE) ? pickCustomer(ctx.rng, ctx.customers) : undefined;
      drafts.push({
        dayKey,
        createdAt,
        customer,
        tableNo: table.tableNo,
        chargeAmount: table.chargeAmount,
        chargeLabel: table.chargeLabel,
        lines,
        receiver: pickReceiver(ctx.rng, ctx.staff),
        notes: undefined,
        isPending: true,
        secondRoundAt,
      });
      occupiedTablesToday.add(table.tableNo);
    }
  }

  return drafts;
}
