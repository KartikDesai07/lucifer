// U0 match Task 7 (values 3.5): the dashboard's Sales by hour card as the owner's HTML draws it, as pure functions —
// the window of bars, the y scale and its ticks, each bar's height, tone and tooltip, the dashed comparison line and the
// footer — fed with our series (DashboardSeriesPoint) and our comparison words (compareShort).
import { test } from "node:test";
import assert from "node:assert/strict";

import { barGapPx, chartSubline, hourWindow, kf, salesChart, tipShift, xLabelStep, yStep } from "@/lib/dashboard/hour-bars";
import type { DashboardSeriesPoint } from "@/types/dashboard";

const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
const pt = (h: number, sales: number, compareSales: number): DashboardSeriesPoint => ({
  key: String(h),
  label: hourLabel(h),
  sales,
  orders: sales > 0 ? 1 : 0,
  compareLabel: hourLabel(h),
  compareSales,
});
const day = (key: string, label: string, sales: number, compareSales: number, compareLabel = label): DashboardSeriesPoint => ({
  key,
  label,
  sales,
  orders: 1,
  compareLabel,
  compareSales,
});

// The HTML's "today" at 12:2x (values 3.5): 11 am and 12 pm sold, the rest of the day not yet; last Monday peaked at 1 pm.
const HTML_TODAY_CMP = [1180, 2630, 5360, 3600, 2100, 1400, 1500, 2700, 4200, 5300, 5300, 3500, 1000];
const htmlToday = () =>
  salesChart({
    points: HTML_TODAY_CMP.map((c, i) => pt(11 + i, i === 0 ? 1520 : i === 1 ? 3470 : 0, c)),
    mode: "hour",
    isToday: true,
    currentHour: 12,
    compareShort: "Last Mon",
  });

test("hourWindow: first to last hour with sales in either series, at least 8 hours, padded evenly and clamped to 0-23", () => {
  assert.deepEqual(hourWindow([]), [], "no sales in either series: no window (the card shows its empty state)");
  const mid = hourWindow([pt(12, 100, 0), pt(13, 0, 0), pt(14, 0, 50)]);
  assert.deepEqual(mid.map((p) => p.key), ["10", "11", "12", "13", "14", "15", "16", "17"], "3 hours grow to 8: 2 before, 3 after");
  assert.equal(mid[0].sales, 0, "a padded hour has no sales");
  assert.equal(mid[0].compareSales, 0, "…and no comparison");
  assert.equal(mid[0].label, "10 am", "…and its hour's label");
  assert.equal(mid[2].sales, 100, "a real hour keeps its figures");
  assert.equal(mid[4].compareSales, 50, "…and its comparison");
  const early = hourWindow([pt(0, 10, 0), pt(1, 0, 0), pt(2, 0, 10)]);
  assert.deepEqual(early.map((p) => p.key), ["0", "1", "2", "3", "4", "5", "6", "7"], "clamped at midnight: the padding moves after");
  const late = hourWindow([pt(21, 10, 0), pt(22, 0, 0), pt(23, 0, 10)]);
  assert.deepEqual(late.map((p) => p.key), ["16", "17", "18", "19", "20", "21", "22", "23"], "clamped at 11 pm: the padding moves before");
  const full = hourWindow(HTML_TODAY_CMP.map((c, i) => pt(11 + i, 0, c)));
  assert.equal(full.length, 13, "13 open hours stay 13 bars");
  assert.equal(full[0].key, "11", "…from 11 am");
});

test("kf, yStep and the ticks: the HTML's ₹6k, ₹4k, ₹2k, ₹0 for a 5,360 max; 2.5k steps; a ₹500 floor", () => {
  assert.equal(kf(0), "₹0", "zero is ₹0");
  assert.equal(kf(500), "₹500", "under a thousand: the rupees");
  assert.equal(kf(2000), "₹2k", "whole thousands: no decimal");
  assert.equal(kf(2500), "₹2.5k", "half thousands: one decimal");
  assert.equal(yStep(5360), 2000, "5,360 / 3 rounded up to a 500 step");
  assert.equal(yStep(7300), 2500, "the HTML's 7 days");
  assert.equal(yStep(100), 500, "a quiet day still has a ₹500 step");
  assert.deepEqual(htmlToday().ticks, ["₹6k", "₹4k", "₹2k", "₹0"], "top to bottom, as the HTML's today");
  const week = salesChart({ points: [day("a", "13 Oct", 7300, 6000), day("b", "14 Oct", 4000, 5000)], mode: "day", isToday: false, currentHour: 12, compareShort: "Previous 7 days" });
  assert.deepEqual(week.ticks, ["₹7.5k", "₹5k", "₹2.5k", "₹0"], "the HTML's 7 days ticks");
});

test("salesChart: heights of the 3-step top, the future hours of today, the peak and the tints", () => {
  const c = htmlToday();
  assert.equal(c.bars.length, 13, "one bar per hour");
  assert.equal(c.bars[0].height, "25.3", "₹1,520 of ₹6,000 = 25.3%");
  assert.equal(c.bars[1].height, "57.8", "₹3,470 of ₹6,000 = 57.8%");
  assert.equal(c.bars[2].height, "0.0", "a future hour has no height (its 2px floor is the bar's min-height)");
  assert.deepEqual(c.bars.map((b) => b.future), [false, false, ...Array(11).fill(true)], "hours after the current one are not yet");
  assert.deepEqual(c.bars.map((b) => b.tone), ["bar", "peak", ...Array(11).fill("future")], "the peak past bar is accent, others the tint, future hours surface-3");
  assert.equal(c.bars[1].label, "12 pm", "the tooltip's hour");
  assert.equal(c.bars[0].tick, "11am", "the x label: the hour without its space");
  assert.equal(c.bars[1].value, 3470, "the bar's own figure");
  assert.equal(c.bars[2].compare, 5360, "…and the comparison's");
  const yesterday = salesChart({ points: HTML_TODAY_CMP.map((cmp, i) => pt(11 + i, 100 * (i + 1), cmp)), mode: "hour", isToday: false, currentHour: 12, compareShort: "Week before" });
  assert.ok(yesterday.bars.every((b) => !b.future), "a past day has no future hours");
  const noClock = salesChart({ points: [pt(11, 100, 50), pt(15, 0, 80)], mode: "hour", isToday: true, currentHour: null, compareShort: "Last Mon" });
  assert.ok(noClock.bars.every((b) => !b.future), "before the clock is known nothing is marked future");
  const skew = salesChart({ points: [pt(12, 100, 50), pt(13, 300, 80)], mode: "hour", isToday: true, currentHour: 12, compareShort: "Last Mon" });
  const one = skew.bars.find((b) => b.key === "13");
  assert.equal(one?.future, false, "an hour that already sold is never 'not yet' (a device clock behind the server)");
  assert.equal(one?.tone, "peak", "…and it can be the peak");
  assert.equal(skew.bars.find((b) => b.key === "14")?.future, true, "a later hour with nothing sold is still not yet");
});

test("salesChart: the tooltip and aria words, the HTML's '12 pm · ₹3,470' / '₹2,630 · last mon' and '1 pm · not yet'", () => {
  const c = htmlToday();
  assert.deepEqual(c.bars[1].tip, ["12 pm · ₹3,470", "₹2,630 · last mon"], "a past hour: its sales, then the comparison");
  assert.deepEqual(c.bars[2].tip, ["1 pm · not yet", "₹5,360 · last mon"], "a future hour: not yet");
  assert.equal(c.bars[1].aria, "12 pm: ₹3,470. Last Mon: ₹2,630", "the column's label reads the hour and both figures");
  assert.equal(c.bars[2].aria, "1 pm: not yet. Last Mon: ₹5,360", "a future column says not yet");
  const week = salesChart({
    points: [day("2026-10-13", "13 Oct", 45000, 41000, "6 Oct"), day("2026-10-14", "14 Oct", 30000, 32000, "7 Oct")],
    mode: "day",
    isToday: false,
    currentHour: 12,
    compareShort: "Previous 7 days",
  });
  // Fix round 1: a day's comparison is ONE aligned day, so it is named by its own date, never 'previous 7 days'.
  assert.deepEqual(week.bars[0].tip, ["13 Oct · ₹45,000", "₹41,000 · 6 Oct"], "a day: '{day} · ₹X' / '₹Y · {its comparison day}'");
  assert.equal(week.bars[0].aria, "13 Oct: ₹45,000. 6 Oct: ₹41,000", "…and its column's label too");
  assert.equal(week.bars[0].tick, "13 Oct", "a day's x label is its date");
});

test("salesChart: the dashed comparison line's points in the 0..100 box", () => {
  const points = htmlToday().line.split(" ");
  assert.equal(points.length, 13, "one point per bar");
  assert.equal(points[0], "3.85,80.33", "x at the bar's middle, y = 100 - cmp / top");
  assert.equal(points[2], "19.23,10.67", "1 pm's ₹5,360 near the top");
  assert.equal(points[12], "96.15,83.33", "the last bar's middle");
});

test("salesChart: the footer - Peak, Quietest (past hours only), 'So far vs last mon +31%' and its colour", () => {
  const c = htmlToday();
  assert.equal(c.peak, "12 pm · ₹3,470", "the peak hour");
  assert.equal(c.low, "11 am · ₹1,520", "the quietest past hour (future hours do not count)");
  assert.equal(c.vsLabel, "So far vs last mon", "today: so far");
  assert.equal(c.vs, "+31%", "(4,990 - 3,810) / 3,810 over the past hours only");
  assert.equal(c.vsTone, "up", "up is the ok ink");
  const down = salesChart({ points: [pt(11, 100, 200), pt(12, 100, 200)], mode: "hour", isToday: false, currentHour: 12, compareShort: "Week before" });
  assert.equal(down.vsLabel, "vs week before", "another day: no 'so far'");
  assert.equal(down.vs, "-50%", "a fall carries its minus");
  assert.equal(down.vsTone, "down", "down is the bad ink");
  const flat = salesChart({ points: [pt(11, 200, 200)], mode: "hour", isToday: false, currentHour: 12, compareShort: "Week before" });
  assert.equal(flat.vs, "+0%", "no change reads +0%");
  assert.equal(flat.vsTone, "up", "…in the ok ink, as the HTML's vsP >= 0");
  const none = salesChart({ points: [pt(11, 200, 0)], mode: "hour", isToday: false, currentHour: 12, compareShort: "Week before" });
  assert.equal(none.vs, "—", "nothing to compare with: a dash, never a made-up +0%");
  assert.equal(none.vsTone, "none", "…in the plain text colour");
  const quiet = salesChart({ points: [pt(11, 0, 200), pt(12, 0, 100)], mode: "hour", isToday: false, currentHour: 12, compareShort: "Week before" });
  assert.equal(quiet.peak, "—", "no sales: no peak");
  assert.ok(quiet.bars.every((b) => b.tone !== "peak"), "…and no accent bar when every value is 0");
  const padded = salesChart({ points: [pt(12, 100, 0), pt(13, 50, 0), pt(14, 0, 30)], mode: "hour", isToday: false, currentHour: 12, compareShort: "Week before" });
  assert.equal(padded.bars[0].key, "10", "landmark: the window is padded from 10 am");
  assert.equal(padded.low, "2 pm · ₹0", "Quietest is an hour of the span with sales, never a padded hour");
  const morning = salesChart({ points: [pt(15, 0, 200)], mode: "hour", isToday: true, currentHour: 8, compareShort: "Last Mon" });
  assert.equal(morning.low, "—", "before the first hour: no past hour, no quietest");
});

test("chartSubline: the HTML's '{period} · open hours, 11 am – 11 pm'; a span names its days", () => {
  const c = htmlToday();
  assert.equal(chartSubline("Today", c.bars, "hour"), "Today · open hours, 11 am – 11 pm", "the window's first and last hour");
  const week = salesChart({ points: [day("a", "13 Oct", 1, 1), day("b", "19 Oct", 1, 1)], mode: "day", isToday: false, currentHour: 12, compareShort: "Previous 7 days" });
  assert.equal(chartSubline("Last 7 days", week.bars, "day"), "Last 7 days · 13 Oct – 19 Oct", "a named span: its dates");
  assert.equal(chartSubline("13 Oct – 19 Oct", week.bars, "day"), "13 Oct – 19 Oct · 2 days", "a span already named by its dates: the day count");
  assert.equal(chartSubline("Today", [], "hour"), "Today", "no bars: the period alone");
});

test("xLabelStep and barGapPx: the HTML's every 2nd (every 3rd on a phone), more only when labels would touch", () => {
  assert.equal(xLabelStep(13, 584, 8, 4, 2), 2, "1280: 13 hours, every 2nd");
  assert.equal(xLabelStep(13, 290, 3, 4, 3), 3, "390: every 3rd");
  assert.equal(xLabelStep(24, 290, 3, 4, 3), 3, "24 hours on a phone still fit every 3rd");
  assert.equal(xLabelStep(30, 584, 8, 6, 2), 3, "30 days at 1280: every 3rd");
  assert.equal(xLabelStep(30, 290, 3, 6, 3), 5, "30 days on a phone: every 5th");
  assert.equal(xLabelStep(13, 0, 8, 4, 2), 2, "not measured yet: the HTML's rule");
  assert.equal(barGapPx(13, false), 8, "the HTML's 8px");
  assert.equal(barGapPx(13, true), 3, "the HTML's 3px on a phone (xs)");
  assert.equal(barGapPx(30, false), 8, "30 days keep the HTML's gap");
  assert.equal(barGapPx(92, false), 3, "a 92-day range narrows the gap so every bar keeps a width");
  assert.equal(barGapPx(92, true), 1, "…on a phone to 1px");
});

test("tipShift: a tooltip that would leave the card moves back inside it, one that fits stays centred", () => {
  assert.equal(tipShift(40, 155, 14, 376), 0, "inside the card: no shift");
  assert.equal(tipShift(290, 405, 14, 376), -29, "past the right edge: back by the overflow");
  assert.equal(tipShift(2, 117, 14, 376), 12, "past the left edge: forward by the overflow");
  assert.equal(tipShift(0, 500, 14, 376), 14, "wider than the card: its left edge stays inside");
});
