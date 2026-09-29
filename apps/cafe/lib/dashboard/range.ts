// Dashboard date ranges — pure (no DB). Every instant comes from dayRange /
// cafeDateString (@pos/shared, IST fixed offset, server-timezone-independent);
// nothing here re-derives day boundaries. Day keys are the IST calendar date
// "YYYY-MM-DD"; a key parsed at UTC midnight lands at 05:30 IST on the same
// date, so dayRange() of it is that IST day (the reports route's idiom).
import { z } from "zod";
import { cafeDateString, dayRange } from "@/lib/utils";
import type { DashboardRange, DashboardSeriesMode } from "@/types/dashboard";

export const DASHBOARD_PRESETS = ["today", "yesterday", "7d", "30d", "custom"] as const;
export type DashboardPreset = (typeof DASHBOARD_PRESETS)[number];
export type FixedDashboardPreset = Exclude<DashboardPreset, "custom">;

/** Widest range the dashboard aggregates (routes stay well inside Vercel's 8 s). */
export const MAX_DASHBOARD_RANGE_DAYS = 92;
/** A one-day range compares with the same weekday one week earlier. */
export const SAME_WEEKDAY_SHIFT_DAYS = 7;
/** Busy hours and slow movers need at least a week of history to mean anything… */
export const INSIGHT_MIN_DAYS = 7;
/** …so a shorter range reads the four weeks ending on its last day instead. */
export const INSIGHT_FALLBACK_DAYS = 28;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_LENGTH = 7;
const PRESET_SPAN_DAYS: Readonly<Record<"7d" | "30d", number>> = { "7d": 7, "30d": 30 };
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface TimeWindow {
  start: Date;
  end: Date; // inclusive, like dayRange().end
}

function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

export function addDays(key: string, days: number): string {
  return new Date(keyToDate(key).getTime() + days * ONE_DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive day count of a range (one day → 1). */
export function rangeDays(range: DashboardRange): number {
  return Math.round((keyToDate(range.to).getTime() - keyToDate(range.from).getTime()) / ONE_DAY_MS) + 1;
}

export function presetRange(preset: FixedDashboardPreset, now: Date = new Date()): DashboardRange {
  const today = cafeDateString(now);
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const yesterday = addDays(today, -1);
    return { from: yesterday, to: yesterday };
  }
  return { from: addDays(today, -(PRESET_SPAN_DAYS[preset] - 1)), to: today };
}

export function seriesMode(range: DashboardRange): DashboardSeriesMode {
  return range.from === range.to ? "hour" : "day";
}

/** Does the range still include the live day (so its numbers move)? */
export function rangeIncludesToday(range: DashboardRange, now: Date = new Date()): boolean {
  return range.to >= cafeDateString(now);
}

/** Every IST day of the range, as whole days. */
export function spanWindow(range: DashboardRange): TimeWindow {
  return { start: dayRange(keyToDate(range.from)).start, end: dayRange(keyToDate(range.to)).end };
}

/** The range as it has happened so far — a range ending today stops at `now`. */
export function currentWindow(range: DashboardRange, now: Date = new Date()): TimeWindow {
  const span = spanWindow(range);
  return { start: span.start, end: new Date(Math.min(span.end.getTime(), now.getTime())) };
}

export function compareShiftDays(range: DashboardRange): number {
  const days = rangeDays(range);
  return days === 1 ? SAME_WEEKDAY_SHIFT_DAYS : days;
}

/** The period a range is compared with, as whole days. */
export function compareRange(range: DashboardRange): DashboardRange {
  const shift = compareShiftDays(range);
  return { from: addDays(range.from, -shift), to: addDays(range.to, -shift) };
}

/**
 * The comparison window for the KPI totals: the current window moved back by
 * the shift, so "today so far" is compared with the same elapsed time — never
 * a half day against a whole one. The IST offset has no DST, so a whole-day
 * shift in milliseconds is exact.
 */
export function compareWindow(range: DashboardRange, now: Date = new Date()): TimeWindow {
  const current = currentWindow(range, now);
  const shiftMs = compareShiftDays(range) * ONE_DAY_MS;
  return { start: new Date(current.start.getTime() - shiftMs), end: new Date(current.end.getTime() - shiftMs) };
}

/** Busy hours / slow movers: the range when it is a week or longer, else the four weeks ending on its last day. */
export function insightRange(range: DashboardRange): DashboardRange {
  if (rangeDays(range) >= INSIGHT_MIN_DAYS) return range;
  return { from: addDays(range.to, -(INSIGHT_FALLBACK_DAYS - 1)), to: range.to };
}

/** Monday-first weekday index (0 = Monday … 6 = Sunday) of an IST day key. */
export function mondayIndex(key: string): number {
  return (keyToDate(key).getUTCDay() + WEEK_LENGTH - 1) % WEEK_LENGTH;
}

/** How many of each weekday (Monday first) the range contains. */
export function weekdayCounts(range: DashboardRange): number[] {
  const counts = new Array<number>(WEEK_LENGTH).fill(0);
  for (let key = range.from; key <= range.to; key = addDays(key, 1)) counts[mondayIndex(key)] += 1;
  return counts;
}

// Fixed English names, not Intl: ICU versions disagree ("Sep" vs "Sept"), and
// the server-built labels must read the same as the browser-built ones.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const WEEKDAYS_MONDAY_FIRST = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "29 Sep" */
export function dayLabel(key: string): string {
  const d = keyToDate(key);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Tue, 22 Sep" */
export function weekdayDayLabel(key: string): string {
  return `${WEEKDAYS_MONDAY_FIRST[mondayIndex(key)]}, ${dayLabel(key)}`;
}

const HOURS_PER_HALF_DAY = 12;

/** 0 → "12 am", 13 → "1 pm". */
export function hourLabel(hour: number): string {
  const suffix = hour < HOURS_PER_HALF_DAY ? "am" : "pm";
  const h = hour % HOURS_PER_HALF_DAY === 0 ? HOURS_PER_HALF_DAY : hour % HOURS_PER_HALF_DAY;
  return `${h} ${suffix}`;
}

/** "vs Tue, 22 Sep" for one day, "vs previous 7 days" otherwise. */
export function compareLabel(range: DashboardRange): string {
  const days = rangeDays(range);
  return days === 1 ? `vs ${weekdayDayLabel(compareRange(range).from)}` : `vs previous ${days} days`;
}

const dayKeySchema = z
  .string()
  .regex(DAY_KEY, "Use YYYY-MM-DD")
  .refine((key) => !Number.isNaN(keyToDate(key).getTime()) && keyToDate(key).toISOString().startsWith(key), {
    message: "Not a real date",
  });

const rangeSchema = z
  .object({ from: dayKeySchema, to: dayKeySchema })
  .refine((r) => r.from <= r.to, { message: "The start date must be on or before the end date", path: ["from"] });

/**
 * Query params → a validated range; absent params mean today. A range ending
 * after today is refused. `maxDays` is a caller-supplied cap (not baked into
 * the schema) so the Reports routes can pass their own, wider
 * MAX_REPORT_RANGE_DAYS while the Dashboard keeps MAX_DASHBOARD_RANGE_DAYS.
 */
export function parseDashboardRange(
  input: { from: string | null; to: string | null },
  now: Date = new Date(),
  maxDays: number = MAX_DASHBOARD_RANGE_DAYS,
): { range: DashboardRange } | { error: string } {
  const today = cafeDateString(now);
  const from = input.from ?? input.to ?? today;
  const to = input.to ?? from;
  const parsed = rangeSchema.safeParse({ from, to });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid date range" };
  if (rangeDays(parsed.data) > maxDays) return { error: `A range can cover at most ${maxDays} days` };
  if (parsed.data.to > today) return { error: "The range cannot end after today" };
  return { range: parsed.data };
}
