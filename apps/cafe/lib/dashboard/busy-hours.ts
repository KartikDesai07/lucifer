// The dashboard's Busy hours card as the owner's HTML draws it (values 3.15, U0 match Task 9, ruling R19), as pure
// functions: a cell's level on the HTML's six-step ramp, the busiest cell, the cap box's read-out, the footer's words,
// the hour ticks and each cell's full name. Fed with our heat (DashboardHeat: orders per hour on an average day of
// each weekday over the insight window). components/dashboard/BusyHours.tsx draws what this returns.
import { hourLabel, WEEKDAYS_MONDAY_FIRST } from "@/lib/dashboard/range";
import type { DashboardHeat } from "@/types/dashboard";

/** The HTML's LV: level 0 (surface-2) and five accent steps. */
export const HEAT_LEVELS = 6;
const TOP_LEVEL = HEAT_LEVELS - 1;
const HOURS_PER_DAY = 24;
const TICK_EVERY = 2;

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** One cell: a weekday (0 = Monday) and a column of `heat.hours`. */
export interface HeatCell {
  weekday: number;
  hourIndex: number;
}

/** The HTML's lvl(v): 0 for none, else min(5, ceil(v / max * 5)). */
export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(TOP_LEVEL, Math.ceil((value / max) * TOP_LEVEL));
}

/** "3.5 orders", "1 order", "0 orders" (our averages carry one decimal). */
export const fmtOrders = (v: number): string => `${Number.isInteger(v) ? v : v.toFixed(1)} ${v === 1 ? "order" : "orders"}`;

/** The busiest weekday and hour (the first of equals), or null when nothing was ordered. */
export function busiestCell(heat: DashboardHeat): HeatCell | null {
  let best: HeatCell | null = null;
  heat.avg.forEach((row, weekday) =>
    row.forEach((v, hourIndex) => {
      if (v > 0 && (!best || v > heat.avg[best.weekday][best.hourIndex])) best = { weekday, hourIndex };
    }),
  );
  return best;
}

const valueOf = (heat: DashboardHeat, c: HeatCell) => heat.avg[c.weekday]?.[c.hourIndex] ?? 0;
const nextHour = (hour: number) => hourLabel((hour + 1) % HOURS_PER_DAY);

/** The footer (values 3.15): "Busiest: {Saturday, 8 pm – 9 pm} · {23.7 orders} on average". */
export function busiestWords(heat: DashboardHeat): { when: string; orders: string } | null {
  const c = busiestCell(heat);
  if (!c) return null;
  const hour = heat.hours[c.hourIndex];
  return { when: `${WEEKDAY_NAMES[c.weekday]}, ${hourLabel(hour)} – ${nextHour(hour)}`, orders: fmtOrders(valueOf(heat, c)) };
}

/** The cap box (values 3.15 capLabel / cap): the HTML's hint until a cell is picked, then "{Sat}, {7 pm}" / "{v} orders". */
export function heatCap(heat: DashboardHeat | undefined, cell: HeatCell | null): { label: string; value: string } {
  if (!heat || !cell) return { label: "Hover any hour", value: "to see the average" };
  return { label: `${WEEKDAYS_MONDAY_FIRST[cell.weekday]}, ${hourLabel(heat.hours[cell.hourIndex])}`, value: fmtOrders(valueOf(heat, cell)) };
}

/** A cell's accessible name: "Saturday, 8 pm to 9 pm: 5.5 orders on average". */
export function heatCellLabel(heat: DashboardHeat, cell: HeatCell): string {
  const hour = heat.hours[cell.hourIndex];
  return `${WEEKDAY_NAMES[cell.weekday]}, ${hourLabel(hour)} to ${nextHour(hour)}: ${fmtOrders(valueOf(heat, cell))} on average`;
}

/** The column labels (values 3.15): every other hour as the HTML's "11am", the rest empty. */
export const heatHourTick = (hour: number, index: number): string => (index % TICK_EVERY === 0 ? hourLabel(hour).replace(" ", "") : "");
