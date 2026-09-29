import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chartNames,
  compareCaption,
  insightPeriod,
  kpiCompareText,
  noCompareText,
  periodDates,
  periodLabel,
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

test("the 'same time' note lives in the caption once, never on each KPI card", () => {
  const today = data({});
  assert.equal(kpiCompareText(today), "vs Tue, 22 Sep");
  assert.equal(compareCaption(today, TODAY), "Compared with Tue, 22 Sep at the same time of day");
  const past = data({ range: { from: "2026-09-28", to: "2026-09-28" }, compare: { from: "2026-09-21", to: "2026-09-21", label: "vs Mon, 21 Sep" } });
  assert.equal(compareCaption(past, TODAY), "Compared with Mon, 21 Sep");
  const week = data({ mode: "day", range: { from: "2026-09-23", to: TODAY }, compare: { from: "2026-09-16", to: "2026-09-22", label: "vs previous 7 days" } });
  assert.equal(compareCaption(week, TODAY), "Compared with the previous 7 days, up to the same time today");
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
