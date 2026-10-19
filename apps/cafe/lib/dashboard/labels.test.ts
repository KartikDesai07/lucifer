import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billPeriodTag,
  chartNames,
  compareShort,
  compareWords,
  insightPeriod,
  noCompareWords,
  kpiCompareText,
  noCompareText,
  periodDates,
  periodLabel,
  periodSubline,
} from "@/lib/dashboard/labels";
import type { DashboardData } from "@/types/dashboard";

// The Dashboard's plain-English period wording (owner: professional copy).
// Literal expectations — 2026-09-29 is a Tuesday.

const TODAY = "2026-09-29";

function data(over: Partial<DashboardData>): DashboardData {
  return {
    range: { from: TODAY, to: TODAY },
    mode: "hour",
    compare: { from: "2026-09-22", to: "2026-09-22", label: "vs Tue, 22 Sep" },
    kpis: {
      current: { sales: 0, orders: 0, averageOrder: 0, collected: 0 },
      previous: { sales: 0, orders: 0, averageOrder: 0, collected: 0 },
    },
    series: [],
    payments: [],
    topItems: [],
    slowItems: [],
    categories: [],
    channels: [],
    heat: { from: "2026-09-02", to: TODAY, hours: [], avg: [], max: 0 },
    leaks: {
      cancelled: { count: 0, value: 0 },
      voids: { lines: 0, qty: 0, value: 0 },
      discounts: { orders: 0, amount: 0 },
      rewards: { orders: 0, amount: 0 },
    },
    money: { gross: 0, discount: 0, reward: 0, gst: 0, charges: 0 },
    duesCollected: 0,
    ...over,
  };
}

test("periodLabel names today, yesterday, a past day, the 7/30-day presets and a custom span", () => {
  assert.equal(periodLabel({ from: TODAY, to: TODAY }, TODAY), "Today");
  assert.equal(periodLabel({ from: "2026-09-28", to: "2026-09-28" }, TODAY), "Yesterday");
  assert.equal(periodLabel({ from: "2026-09-22", to: "2026-09-22" }, TODAY), "Tue, 22 Sep");
  assert.equal(periodLabel({ from: "2026-09-23", to: TODAY }, TODAY), "Last 7 days");
  assert.equal(periodLabel({ from: "2026-08-31", to: TODAY }, TODAY), "Last 30 days");
  // Seven days that do NOT end today are a date span, not "Last 7 days".
  assert.equal(periodLabel({ from: "2026-09-16", to: "2026-09-22" }, TODAY), "16 Sep – 22 Sep");
});

test("periodDates spells the dates behind a named period", () => {
  assert.equal(periodDates({ from: TODAY, to: TODAY }), "Tue, 29 Sep");
  assert.equal(periodDates({ from: "2026-09-23", to: TODAY }), "23 Sep – 29 Sep");
});

test("chartNames: one day by weekday, a range as the period vs the previous days", () => {
  assert.deepEqual(chartNames(data({}), TODAY), { current: "Today", compare: "Tue, 22 Sep" });
  assert.deepEqual(
    chartNames(data({ range: { from: "2026-09-28", to: "2026-09-28" }, compare: { from: "2026-09-21", to: "2026-09-21", label: "vs Mon, 21 Sep" } }), TODAY),
    { current: "Mon, 28 Sep", compare: "Mon, 21 Sep" }, // the chart legend names the day, not "Yesterday"
  );
  const week = data({
    mode: "day",
    range: { from: "2026-09-23", to: TODAY },
    compare: { from: "2026-09-16", to: "2026-09-22", label: "vs previous 7 days" },
  });
  assert.deepEqual(chartNames(week, TODAY), { current: "Last 7 days", compare: "Previous 7 days" });
});

test("the KPI delta suffix is the comparison's own short label", () => {
  assert.equal(kpiCompareText(data({})), "vs Tue, 22 Sep");
});

// U0 match (Task 5, values 3.2, ruling R9): the HTML's "{range} · compared with {comparison}" under the period's name,
// built from the range alone (our comparison rule: one day against the same weekday a week before, N days against the
// N days before), so it never waits for the figures and never moves when they arrive.
test("periodSubline: the dates, then 'compared with …' in the HTML's words, from the range alone", () => {
  assert.equal(periodSubline({ from: TODAY, to: TODAY }, TODAY), "Tue, 29 Sep · compared with last Tuesday", "today: last {weekday}");
  assert.equal(periodSubline({ from: "2026-09-28", to: "2026-09-28" }, TODAY), "Mon, 28 Sep · compared with the same day last week", "yesterday");
  assert.equal(periodSubline({ from: "2026-09-23", to: TODAY }, TODAY), "23 Sep – 29 Sep · compared with the previous 7 days", "7 days");
  assert.equal(periodSubline({ from: "2026-08-31", to: TODAY }, TODAY), "31 Aug – 29 Sep · compared with the previous 30 days", "30 days");
  assert.equal(periodSubline({ from: "2026-09-01", to: "2026-09-14" }, TODAY), "Compared with the previous 14 days", "a custom span: its title already is the dates");
  assert.equal(periodSubline({ from: "2026-09-22", to: "2026-09-22" }, TODAY), "Compared with the same day last week", "a picked day is its own title: no dates twice");
  assert.equal(periodSubline({ from: "2026-10-19", to: "2026-10-19" }, "2026-10-19"), "Mon, 19 Oct · compared with last Monday", "the HTML's own line (values 3.19)");
});

// U0 match Task 6 (values 3.3, 3.4, ruling R12): the hero's "vs {db.P.cmp}", the minis' "vs {cmpShort}", the line when
// the comparison had no orders, and the receipt's period tag ({db.P.short}, shown upper-cased) - from the range alone.
test("compareWords / compareShort: the HTML's cmp and cmpShort for our comparison", () => {
  assert.equal(compareWords({ from: TODAY, to: TODAY }, TODAY), "last Tuesday", "today: last {weekday}");
  assert.equal(compareShort({ from: TODAY, to: TODAY }, TODAY), "Last Tue", "today: Last {wkd}");
  assert.equal(compareWords({ from: "2026-09-28", to: "2026-09-28" }, TODAY), "the same day last week", "yesterday");
  assert.equal(compareShort({ from: "2026-09-28", to: "2026-09-28" }, TODAY), "Week before", "yesterday, short");
  assert.equal(compareWords({ from: "2026-09-23", to: TODAY }, TODAY), "the previous 7 days", "7 days");
  assert.equal(compareShort({ from: "2026-09-23", to: TODAY }, TODAY), "Previous 7 days", "7 days, short");
  assert.equal(compareShort({ from: "2026-09-01", to: "2026-09-14" }, TODAY), "Previous 14 days", "a custom span");
  assert.equal(compareWords({ from: "2026-10-19", to: "2026-10-19" }, "2026-10-19"), "last Monday", "the HTML's own (values 3.19)");
  assert.equal(compareShort({ from: "2026-10-19", to: "2026-10-19" }, "2026-10-19"), "Last Mon", "the HTML's own short");
});

test("noCompareWords: 'No orders {last Monday | the same day last week | in the previous N days}' (ruling R12)", () => {
  assert.equal(noCompareWords({ from: TODAY, to: TODAY }, TODAY), "No orders last Tuesday", "today");
  assert.equal(noCompareWords({ from: "2026-09-28", to: "2026-09-28" }, TODAY), "No orders the same day last week", "yesterday");
  assert.equal(noCompareWords({ from: "2026-09-23", to: TODAY }, TODAY), "No orders in the previous 7 days", "7 days");
});

test("billPeriodTag: Today, a day as '28 Sep', a span as 'N days' (the receipt upper-cases it)", () => {
  assert.equal(billPeriodTag({ from: TODAY, to: TODAY }, TODAY), "Today", "today");
  assert.equal(billPeriodTag({ from: "2026-09-28", to: "2026-09-28" }, TODAY), "28 Sep", "yesterday: its date, as the HTML's short");
  assert.equal(billPeriodTag({ from: "2026-09-22", to: "2026-09-22" }, TODAY), "22 Sep", "a picked day");
  assert.equal(billPeriodTag({ from: "2026-09-23", to: TODAY }, TODAY), "7 days", "7 days");
  assert.equal(billPeriodTag({ from: "2026-08-31", to: TODAY }, TODAY), "30 days", "30 days");
  assert.equal(billPeriodTag({ from: "2026-09-01", to: "2026-09-14" }, TODAY), "14 days", "a custom span");
});

test("noCompareText says which period had no orders", () => {
  assert.equal(noCompareText(data({})), "No orders on Tue, 22 Sep");
  assert.equal(
    noCompareText(data({ mode: "day", range: { from: "2026-09-23", to: TODAY }, compare: { from: "2026-09-16", to: "2026-09-22", label: "vs previous 7 days" } })),
    "No orders in the previous 7 days",
  );
});

test("insightPeriod: a short range reads the last four weeks; a long one reads itself", () => {
  assert.equal(insightPeriod(data({}), TODAY), "Last 4 weeks");
  assert.equal(
    insightPeriod(data({ range: { from: "2026-09-21", to: "2026-09-21" }, heat: { from: "2026-08-25", to: "2026-09-21", hours: [], avg: [], max: 0 } }), TODAY),
    "4 weeks to 21 Sep",
  );
  const month = data({ mode: "day", range: { from: "2026-08-31", to: TODAY }, heat: { from: "2026-08-31", to: TODAY, hours: [], avg: [], max: 0 } });
  assert.equal(insightPeriod(month, TODAY), "Last 30 days");
});
