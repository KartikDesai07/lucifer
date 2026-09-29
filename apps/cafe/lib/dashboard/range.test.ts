// Dashboard date range math — pure, DB-free. Every expected value below is a
// LITERAL hand-computed against the IST fixed offset (+05:30), never
// recomputed with the code under test. IST has no DST, so a whole-day shift
// in milliseconds is exact — see range.ts's own compareWindow comment.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  presetRange,
  rangeDays,
  seriesMode,
  rangeIncludesToday,
  currentWindow,
  compareShiftDays,
  compareRange,
  compareWindow,
  insightRange,
  weekdayCounts,
  mondayIndex,
  dayLabel,
  weekdayDayLabel,
  hourLabel,
  compareLabel,
  parseDashboardRange,
  addDays,
  MAX_DASHBOARD_RANGE_DAYS,
} from "@/lib/dashboard/range";

// ── presetRange ──────────────────────────────────────────────────────────────

test("presetRange: today/yesterday/7d/30d at a fixed now (14:30 IST, 29 Sep)", () => {
  const now = new Date("2026-09-29T09:00:00Z"); // 14:30 IST, Tue 29 Sep
  assert.deepEqual(presetRange("today", now), { from: "2026-09-29", to: "2026-09-29" });
  assert.deepEqual(presetRange("yesterday", now), { from: "2026-09-28", to: "2026-09-28" });
  assert.deepEqual(presetRange("7d", now), { from: "2026-09-23", to: "2026-09-29" });
  assert.deepEqual(presetRange("30d", now), { from: "2026-08-31", to: "2026-09-29" });
});

test("presetRange: now at 23:59 IST (still the same IST day, 18:29:00Z)", () => {
  const now = new Date("2026-09-28T18:29:00Z"); // 23:59 IST, 28 Sep
  assert.deepEqual(presetRange("today", now), { from: "2026-09-28", to: "2026-09-28" });
  assert.deepEqual(presetRange("yesterday", now), { from: "2026-09-27", to: "2026-09-27" });
});

test("presetRange: now at 00:01 IST (crossed the IST midnight boundary, 18:31:00Z the day before)", () => {
  const now = new Date("2026-09-28T18:31:00Z"); // 00:01 IST, 29 Sep
  assert.deepEqual(presetRange("today", now), { from: "2026-09-29", to: "2026-09-29" });
  assert.deepEqual(presetRange("yesterday", now), { from: "2026-09-28", to: "2026-09-28" });
});

// ── rangeDays ────────────────────────────────────────────────────────────────

test("rangeDays: inclusive day count", () => {
  assert.equal(rangeDays({ from: "2026-09-29", to: "2026-09-29" }), 1);
  assert.equal(rangeDays({ from: "2026-09-23", to: "2026-09-29" }), 7);
  assert.equal(rangeDays({ from: "2026-08-31", to: "2026-09-29" }), 30);
  assert.equal(rangeDays({ from: "2026-09-28", to: "2026-09-29" }), 2);
});

// ── seriesMode ───────────────────────────────────────────────────────────────

test("seriesMode: hour for a one-day range, day otherwise", () => {
  assert.equal(seriesMode({ from: "2026-09-29", to: "2026-09-29" }), "hour");
  assert.equal(seriesMode({ from: "2026-09-28", to: "2026-09-29" }), "day");
});

// ── rangeIncludesToday / currentWindow clipping ─────────────────────────────

test("rangeIncludesToday: true only when range.to >= today", () => {
  const now = new Date("2026-09-29T09:00:00Z");
  assert.equal(rangeIncludesToday({ from: "2026-09-29", to: "2026-09-29" }, now), true);
  assert.equal(rangeIncludesToday({ from: "2026-09-28", to: "2026-09-28" }, now), false);
});

test("currentWindow: a range ending TODAY clips its end at `now`", () => {
  const now = new Date("2026-09-29T09:00:00Z"); // 14:30 IST
  const w = currentWindow({ from: "2026-09-29", to: "2026-09-29" }, now);
  assert.equal(w.start.toISOString(), "2026-09-28T18:30:00.000Z"); // IST midnight of 29 Sep
  assert.equal(w.end.toISOString(), now.toISOString()); // clipped at now, not end-of-day
});

test("currentWindow: a PAST range is NOT clipped — its own day's end stands", () => {
  const now = new Date("2026-09-29T09:00:00Z");
  const w = currentWindow({ from: "2026-09-28", to: "2026-09-28" }, now);
  assert.equal(w.start.toISOString(), "2026-09-27T18:30:00.000Z");
  assert.equal(w.end.toISOString(), "2026-09-28T18:29:59.999Z"); // full IST day end, untouched by now
});

// ── compareShiftDays ─────────────────────────────────────────────────────────

test("compareShiftDays: 1 day -> 7 (same weekday); N days -> N", () => {
  assert.equal(compareShiftDays({ from: "2026-09-29", to: "2026-09-29" }), 7);
  assert.equal(compareShiftDays({ from: "2026-09-23", to: "2026-09-29" }), 7);
  assert.equal(compareShiftDays({ from: "2026-08-31", to: "2026-09-29" }), 30);
  assert.equal(compareShiftDays({ from: "2026-09-27", to: "2026-09-29" }), 3);
});

// ── compareRange ─────────────────────────────────────────────────────────────

test("compareRange: shifts both ends back by compareShiftDays", () => {
  assert.deepEqual(compareRange({ from: "2026-09-29", to: "2026-09-29" }), {
    from: "2026-09-22",
    to: "2026-09-22",
  });
  assert.deepEqual(compareRange({ from: "2026-09-23", to: "2026-09-29" }), {
    from: "2026-09-16",
    to: "2026-09-22",
  });
});

// ── compareWindow ────────────────────────────────────────────────────────────

test("compareWindow: end = current window's (clipped) end minus the shift, in milliseconds", () => {
  const now = new Date("2026-09-29T09:00:00Z"); // 14:30 IST, today range clips at now
  const w = compareWindow({ from: "2026-09-29", to: "2026-09-29" }, now);
  const shiftMs = 7 * 24 * 60 * 60 * 1000;
  assert.equal(w.end.getTime(), now.getTime() - shiftMs);
  // start = current window's start (IST midnight of 29 Sep) minus the same 7-day shift.
  assert.equal(w.start.toISOString(), "2026-09-21T18:30:00.000Z");
});

// ── insightRange ─────────────────────────────────────────────────────────────

test("insightRange: <7 days -> 28 days ending at `to`; >=7 -> itself", () => {
  assert.deepEqual(insightRange({ from: "2026-09-29", to: "2026-09-29" }), {
    from: "2026-09-02",
    to: "2026-09-29",
  });
  assert.deepEqual(insightRange({ from: "2026-09-28", to: "2026-09-29" }), {
    from: "2026-09-02",
    to: "2026-09-29",
  });
  const sevenDay = { from: "2026-09-23", to: "2026-09-29" };
  assert.deepEqual(insightRange(sevenDay), sevenDay);
  const thirtyDay = { from: "2026-08-31", to: "2026-09-29" };
  assert.deepEqual(insightRange(thirtyDay), thirtyDay);
});

// ── weekdayCounts ────────────────────────────────────────────────────────────

test("weekdayCounts: a 28-day window (4 full weeks) gives exactly 4 of each weekday", () => {
  const counts = weekdayCounts({ from: "2026-09-02", to: "2026-09-29" });
  assert.deepEqual(counts, [4, 4, 4, 4, 4, 4, 4]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 28);
});

test("weekdayCounts: a 10-day window (2026-09-20..2026-09-29) counts Mon..Sun correctly", () => {
  // 20 Sun,21 Mon,22 Tue,23 Wed,24 Thu,25 Fri,26 Sat,27 Sun,28 Mon,29 Tue
  // Monday-first index: Mon=0 Tue=1 Wed=2 Thu=3 Fri=4 Sat=5 Sun=6
  const counts = weekdayCounts({ from: "2026-09-20", to: "2026-09-29" });
  assert.deepEqual(counts, [2, 2, 1, 1, 1, 1, 2]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 10);
});

// ── mondayIndex ──────────────────────────────────────────────────────────────

test("mondayIndex: 2026-09-28 is a Monday (index 0); 2026-09-29 Tuesday (1)", () => {
  assert.equal(mondayIndex("2026-09-28"), 0);
  assert.equal(mondayIndex("2026-09-29"), 1);
  assert.equal(mondayIndex("2026-09-22"), 1); // same weekday one week earlier: also Tuesday
});

// ── dayLabel / weekdayDayLabel / hourLabel ──────────────────────────────────

test('dayLabel: "2026-09-29" -> "29 Sep"', () => {
  assert.equal(dayLabel("2026-09-29"), "29 Sep");
  assert.equal(dayLabel("2026-01-01"), "1 Jan");
});

test('weekdayDayLabel: "2026-09-22" -> "Tue, 22 Sep"', () => {
  assert.equal(weekdayDayLabel("2026-09-22"), "Tue, 22 Sep");
  assert.equal(weekdayDayLabel("2026-09-28"), "Mon, 28 Sep");
});

test("hourLabel: 0/12/13/23", () => {
  assert.equal(hourLabel(0), "12 am");
  assert.equal(hourLabel(12), "12 pm");
  assert.equal(hourLabel(13), "1 pm");
  assert.equal(hourLabel(23), "11 pm");
});

// ── compareLabel ─────────────────────────────────────────────────────────────

test('compareLabel: 1-day range -> "vs <weekday>, <day label>" of the SAME weekday one week earlier', () => {
  assert.equal(compareLabel({ from: "2026-09-29", to: "2026-09-29" }), "vs Tue, 22 Sep");
});

test('compareLabel: 7-day range -> "vs previous 7 days"', () => {
  assert.equal(compareLabel({ from: "2026-09-23", to: "2026-09-29" }), "vs previous 7 days");
});

// ── parseDashboardRange ──────────────────────────────────────────────────────

test("parseDashboardRange: absent from/to defaults to today", () => {
  const now = new Date("2026-09-29T09:00:00Z");
  const result = parseDashboardRange({ from: null, to: null }, now);
  assert.deepEqual(result, { range: { from: "2026-09-29", to: "2026-09-29" } });
});

test("parseDashboardRange: from > to is an error", () => {
  const now = new Date("2026-09-29T09:00:00Z");
  const result = parseDashboardRange({ from: "2026-09-29", to: "2026-09-20" }, now);
  assert.ok("error" in result, "expected an error result");
});

test(`parseDashboardRange: a range wider than ${MAX_DASHBOARD_RANGE_DAYS} days is an error`, () => {
  const now = new Date("2026-09-29T09:00:00Z");
  const from = addDays("2026-09-29", -MAX_DASHBOARD_RANGE_DAYS); // 93 days inclusive
  const result = parseDashboardRange({ from, to: "2026-09-29" }, now);
  assert.ok("error" in result, "expected an error result");
});

test("parseDashboardRange: to after today is an error", () => {
  const now = new Date("2026-09-29T09:00:00Z"); // today = 2026-09-29
  const result = parseDashboardRange({ from: "2026-09-25", to: "2026-09-30" }, now);
  assert.deepEqual(result, { error: "The range cannot end after today" });
});

test("parseDashboardRange: an impossible calendar date (2026-02-30) is an error", () => {
  const now = new Date("2026-09-29T09:00:00Z");
  const result = parseDashboardRange({ from: "2026-02-30", to: "2026-02-30" }, now);
  assert.ok("error" in result, "expected an error result");
});

test("parseDashboardRange: a valid 7-day range parses through unchanged", () => {
  const now = new Date("2026-09-29T09:00:00Z");
  const result = parseDashboardRange({ from: "2026-09-23", to: "2026-09-29" }, now);
  assert.deepEqual(result, { range: { from: "2026-09-23", to: "2026-09-29" } });
});
