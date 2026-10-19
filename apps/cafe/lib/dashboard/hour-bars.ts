// The dashboard's Sales by hour card as the owner's HTML draws it (values 3.5, U0 match Task 7), as pure functions:
// the window of bars, the y scale and its ticks, each bar's height, tone, tooltip and label, the dashed comparison line
// and the footer. Fed with our series (DashboardSeriesPoint: by hour for one day, by day for a span, ruling R15) and
// our comparison words (lib/dashboard/labels compareShort). components/dashboard/HourBars.tsx draws what this returns.
import { inr } from "@/lib/utils";
import { hourLabel } from "@/lib/dashboard/range";
import type { DashboardSeriesMode, DashboardSeriesPoint } from "@/types/dashboard";

/** The HTML's chart always spans at least its eight hours (design 5.5). */
export const MIN_HOUR_BARS = 8;
const LAST_HOUR = 23;
/** kf's ticks are three equal steps of a multiple of ₹500 over a ₹500 floor (values 3.5 `step`). */
const STEP_UNIT = 500;
const STEP_COUNT = 3;
const MIN_TOP = 500;
const PERCENT = 100;
const NONE = "—";

export type BarTone = "peak" | "bar" | "future";

export interface ChartBar {
  key: string;
  /** The tooltip's and footer's name: "12 pm" or "13 Oct". */
  label: string;
  /** The x label: the HTML's `hl(x).replace(' ', '')` ("12pm"), or the day ("13 Oct"). */
  tick: string;
  value: number;
  compare: number;
  /** Today, after the current cafe hour, with nothing sold: "not yet". */
  future: boolean;
  /** The bar's height in percent of the plot, one decimal (the HTML's `toFixed(1)`). */
  height: string;
  tone: BarTone;
  /** The tooltip's two lines. */
  tip: [string, string];
  /** The column's accessible name. */
  aria: string;
  /** Inside the span our series has (not a padded hour). */
  inSpan: boolean;
}

export interface ChartModel {
  bars: ChartBar[];
  /** Top to bottom: the HTML's `[3,2,1,0].map(i => kf(step*i))`. */
  ticks: string[];
  /** The comparison polyline's points in a 0..100 box. */
  line: string;
  peak: string;
  low: string;
  vsLabel: string;
  vs: string;
  vsTone: "up" | "down" | "none";
}

export interface ChartInput {
  points: readonly DashboardSeriesPoint[];
  mode: DashboardSeriesMode;
  /** The period is one day and it is today: hours after `currentHour` are "not yet". */
  isToday: boolean;
  /** The cafe's current hour (0-23), or null while the clock is not known yet. */
  currentHour: number | null;
  /** The HTML's cmpShort: "Last Mon", "Week before", "Previous 7 days". */
  compareShort: string;
}

const emptyHour = (h: number): DashboardSeriesPoint => ({
  key: String(h),
  label: hourLabel(h),
  sales: 0,
  orders: 0,
  compareLabel: hourLabel(h),
  compareSales: 0,
});

/**
 * One bar per hour from the first to the last hour with sales in either series (our series already spans exactly
 * that), at least MIN_HOUR_BARS: a shorter day is padded evenly (the odd hour after), clamped to 0-23.
 */
export function hourWindow(points: readonly DashboardSeriesPoint[], min = MIN_HOUR_BARS): DashboardSeriesPoint[] {
  if (points.length === 0) return [];
  const hours = points.map((p) => Number(p.key));
  let start = Math.min(...hours);
  let end = Math.max(...hours);
  const short = min - (end - start + 1);
  if (short > 0) {
    start -= Math.floor(short / 2);
    end += short - Math.floor(short / 2);
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > LAST_HOUR) {
      start = Math.max(0, start - (end - LAST_HOUR));
      end = LAST_HOUR;
    }
  }
  const byHour = new Map(points.map((p) => [Number(p.key), p]));
  const out: DashboardSeriesPoint[] = [];
  for (let h = start; h <= end; h++) out.push(byHour.get(h) ?? emptyHour(h));
  return out;
}

/** The HTML's tick label: ₹0, ₹500, ₹2k, ₹2.5k. */
export function kf(v: number): string {
  if (!v) return "₹0";
  return v >= 1000 ? `₹${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `₹${v}`;
}

/** One of the three tick steps: the larger series' top, a third of it rounded up to ₹500, never under ₹500 in all. */
export function yStep(max: number): number {
  return Math.ceil(Math.max(max, MIN_TOP) / STEP_COUNT / STEP_UNIT) * STEP_UNIT;
}

export function salesChart(input: ChartInput): ChartModel {
  const hour = input.mode === "hour";
  const points = hour ? hourWindow(input.points) : [...input.points];
  const n = points.length;
  // A bar that already sold is never "not yet", even if this device's clock runs behind the server's.
  const future = points.map(
    (p) => hour && input.isToday && input.currentHour !== null && Number(p.key) > input.currentHour && p.sales === 0,
  );
  const vals = points.map((p, i) => (future[i] ? 0 : p.sales));
  const cmps = points.map((p) => p.compareSales);
  const step = yStep(Math.max(0, ...vals, ...cmps));
  const top = step * STEP_COUNT;
  // The accent marks the peak only when something sold (fix round 1: never a 2px accent floor on an empty day).
  const peakAt = Math.max(...vals) > 0 ? vals.indexOf(Math.max(...vals)) : -1;
  const lower = input.compareShort.toLowerCase();
  // The hours our series spans (first to last with sales in either series); the padding around them never counts as
  // the quietest hour.
  const spanHours = input.points.map((p) => Number(p.key));
  const inSpan = (p: DashboardSeriesPoint) =>
    !hour || (Number(p.key) >= Math.min(...spanHours) && Number(p.key) <= Math.max(...spanHours));

  const bars: ChartBar[] = points.map((p, i) => {
    const label = hour ? hourLabel(Number(p.key)) : p.label;
    const shown = future[i] ? "not yet" : inr(vals[i]);
    // An hour is compared with the comparison day's same hour ("last mon"); a day with ONE aligned day, named by its date.
    const against = hour ? lower : p.compareLabel;
    return {
      key: p.key,
      label,
      tick: hour ? label.replace(" ", "") : p.label,
      value: vals[i],
      compare: cmps[i],
      future: future[i],
      height: ((vals[i] / top) * PERCENT).toFixed(1),
      tone: future[i] ? "future" : i === peakAt ? "peak" : "bar",
      tip: [`${label} · ${shown}`, `${inr(cmps[i])} · ${against}`],
      aria: `${label}: ${shown}. ${hour ? input.compareShort : p.compareLabel}: ${inr(cmps[i])}`,
      inSpan: inSpan(p),
    };
  });

  const line = cmps
    .map((c, i) => `${(((i + 0.5) / n) * PERCENT).toFixed(2)},${(PERCENT - (c / top) * PERCENT).toFixed(2)}`)
    .join(" ");

  const past = bars.filter((b) => !b.future);
  const low = past
    .filter((b) => b.inSpan)
    .reduce<ChartBar | undefined>((m, b) => (m === undefined || b.value < m.value ? b : m), undefined);
  const sumValues = vals.reduce((s, v) => s + v, 0);
  const sumCompare = past.reduce((s, b) => s + b.compare, 0);
  // Nothing to compare with: a dash, never the HTML's `sumC ? … : 0` "+0%" (our cafe may have no such day).
  const change = sumCompare ? Math.round(((sumValues - sumCompare) / sumCompare) * PERCENT) : null;

  return {
    bars,
    ticks: [3, 2, 1, 0].map((k) => kf(step * k)),
    line,
    peak: peakAt >= 0 ? `${bars[peakAt].label} · ${inr(vals[peakAt])}` : NONE,
    low: low ? `${low.label} · ${inr(low.value)}` : NONE,
    vsLabel: input.isToday ? `So far vs ${lower}` : `vs ${lower}`,
    vs: change === null ? NONE : `${change >= 0 ? "+" : ""}${change}%`,
    vsTone: change === null ? "none" : change >= 0 ? "up" : "down",
  };
}

/** The card's sub line: the HTML's "{period} · open hours, 11 am – 11 pm"; a span names its dates (or its day count). */
export function chartSubline(period: string, bars: readonly ChartBar[], mode: DashboardSeriesMode): string {
  if (bars.length === 0) return period;
  const span = `${bars[0].label} – ${bars[bars.length - 1].label}`;
  if (mode === "hour") return `${period} · open hours, ${span}`;
  return span === period ? `${period} · ${bars.length} days` : `${period} · ${span}`;
}

/** An 11px Geist label's width per character, and the room kept between two labels. */
const LABEL_CHAR_PX = 6.5;
const LABEL_ROOM_PX = 6;

/**
 * Every how-many-th x label is written: the HTML's every 2nd (every 3rd on a phone) — `base` — or more when the
 * labels would touch at the row's measured width (a month of days). 0 width (not measured yet) keeps `base`.
 */
export function xLabelStep(count: number, rowPx: number, gapPx: number, maxChars: number, base: number): number {
  if (count <= 0 || rowPx <= 0) return base;
  const pitch = (rowPx + gapPx) / count;
  return Math.max(base, Math.ceil((maxChars * LABEL_CHAR_PX + LABEL_ROOM_PX) / pitch));
}

/** db.L.barGap: 8px, 3px on a phone (xs); a range longer than a month narrows it so every bar keeps a width. */
const GAP_KEPT_UP_TO = 31;
export function barGapPx(count: number, xs: boolean): number {
  const base = xs ? 3 : 8;
  return count <= GAP_KEPT_UP_TO ? base : Math.max(1, Math.round((base * GAP_KEPT_UP_TO) / count));
}

/**
 * How far a tooltip moves to stay inside the card (fix round 1): 0 when it fits, back by its overflow at the right,
 * forward by it at the left; a tooltip wider than the card keeps its left edge inside.
 */
export function tipShift(left: number, right: number, boxLeft: number, boxRight: number): number {
  let dx = right > boxRight ? boxRight - right : 0;
  if (left + dx < boxLeft) dx = boxLeft - left;
  return dx;
}
