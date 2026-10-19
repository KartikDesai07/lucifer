// Plain-English period wording for the Dashboard — pure, so the page, the
// cards and the tests all say the same thing. Every label is derived from the
// data actually on screen (DashboardData.range), never the picker's pending
// choice, so a dimmed "updating" view never names a period it is not showing.
import {
  INSIGHT_FALLBACK_DAYS,
  WEEKDAYS_MONDAY_FIRST,
  addDays,
  dayLabel,
  mondayIndex,
  rangeDays,
  weekdayDayLabel,
} from "@/lib/dashboard/range";
import type { DashboardData, DashboardRange } from "@/types/dashboard";

const PRESET_SPANS = [7, 30] as const;
const DAYS_PER_WEEK = 7;

/** "Today" · "Yesterday" · "Tue, 22 Sep" · "Last 7 days" · "1 Sep – 14 Sep". */
export function periodLabel(range: DashboardRange, today: string): string {
  if (range.from === range.to) {
    if (range.from === today) return "Today";
    if (range.from === addDays(today, -1)) return "Yesterday";
    return weekdayDayLabel(range.from);
  }
  const days = rangeDays(range);
  if (range.to === today && (PRESET_SPANS as readonly number[]).includes(days)) return `Last ${days} days`;
  return `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
}

/** The dates behind a named period ("23 Sep – 29 Sep"), or "" when the name already is the date. */
export function periodDates(range: DashboardRange): string {
  if (range.from === range.to) return weekdayDayLabel(range.from);
  return `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
}

/** Legend names for the main chart: the period vs its comparison. */
export function chartNames(data: DashboardData, today: string): { current: string; compare: string } {
  if (data.mode === "hour") {
    return {
      current: data.range.from === today ? "Today" : weekdayDayLabel(data.range.from),
      compare: weekdayDayLabel(data.compare.from),
    };
  }
  const days = rangeDays(data.range);
  return { current: periodLabel(data.range, today), compare: `Previous ${days} days` };
}

/** The KPI delta suffix — kept short so it stays on one line in a four-up row. */
export function kpiCompareText(data: DashboardData): string {
  return data.compare.label;
}

const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/**
 * The line under the period's name, in the HTML's words (values 3.2, ruling R9): "{dates} · compared with {last
 * Monday | the same day last week | the previous N days}". It follows our comparison rule (compareRange: one day
 * against the same weekday a week before, N days against the N days before) from the range alone, so it never waits
 * for the figures and never moves when they arrive. The dates are left out when the name already is the date (a
 * picked day).
 */
export function periodSubline(range: DashboardRange, today: string): string {
  const against = compareWords(range, today);
  const dates = periodLabel(range, today) === periodDates(range) ? "" : periodDates(range);
  return dates ? `${dates} · compared with ${against}` : `Compared with ${against}`;
}

/**
 * The HTML's db.P.cmp for our comparison (values 3.2, 3.3): "last Monday" (today, against the same weekday a week
 * before), "the same day last week" (another day), "the previous N days" (a span). The hero says "vs {this}".
 */
export function compareWords(range: DashboardRange, today: string): string {
  const days = rangeDays(range);
  if (days > 1) return `the previous ${days} days`;
  return range.from === today ? `last ${WEEKDAYS_LONG[mondayIndex(range.from)]}` : "the same day last week";
}

/** The HTML's db.P.cmpShort: "Last Mon" · "Week before" · "Previous N days" (the minis say "vs {this, lower-cased}"). */
export function compareShort(range: DashboardRange, today: string): string {
  const days = rangeDays(range);
  if (days > 1) return `Previous ${days} days`;
  return range.from === today ? `Last ${WEEKDAYS_MONDAY_FIRST[mondayIndex(range.from)]}` : "Week before";
}

/** Ruling R12: the hero's line when the comparison had no orders ("No orders last Monday" / "… in the previous 7 days"). */
export function noCompareWords(range: DashboardRange, today: string): string {
  const days = rangeDays(range);
  return days > 1 ? `No orders in the previous ${days} days` : `No orders ${compareWords(range, today)}`;
}

/** The receipt's period tag, the HTML's db.P.short (shown upper-cased): "Today" · "18 Oct" · "7 days" · "N days". */
export function billPeriodTag(range: DashboardRange, today: string): string {
  if (range.from !== range.to) return `${rangeDays(range)} days`;
  return range.from === today ? "Today" : dayLabel(range.from);
}

/** Said instead of a % when the comparison period had no orders. */
export function noCompareText(data: DashboardData): string {
  return data.mode === "hour"
    ? `No orders on ${weekdayDayLabel(data.compare.from)}`
    : `No orders in the previous ${rangeDays(data.range)} days`;
}

/** Busy hours / slow movers read a wider window when the range is short. */
export function insightPeriod(data: DashboardData, today: string): string {
  const { from, to } = data.heat;
  if (from === data.range.from && to === data.range.to) return periodLabel(data.range, today);
  const weeks = INSIGHT_FALLBACK_DAYS / DAYS_PER_WEEK;
  return to === today ? `Last ${weeks} weeks` : `${weeks} weeks to ${dayLabel(to)}`;
}
