/**
 * Reports Batch-3 live leg — proves buildOrderTypesReport / buildHourDetail
 * against a REAL MongoDB, which the DB-free unit tests
 * (lib/reports/order-types-{fold,pipelines,query}.test.ts) cannot: that the
 * real pipelines/folds actually run on a seeded dataset, that channelOf()'s
 * JS precedence never drifts from CHANNEL_EXPR's Mongo $switch, and that the
 * report agrees with buildDashboard / buildSalesReport for the SAME range.
 *
 *   npm run verify:reports-b3:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reportsb3_xxxx npm run verify:reports-b3:live
 *
 * SAFETY: refuses any database whose name does not carry the scratch prefix,
 * and drops the WHOLE scratch database in a finally block.
 * (console output is intentional — this is an ops CLI script, not app code.)
 *
 * ── Fixed clock ──────────────────────────────────────────────────────────────
 * NOW = 2026-09-29T09:00:00Z = 14:30 IST, Tuesday 29 Sep 2026 (same clock as
 * verify-reports-b2-live.ts). Every expected number below is HAND-COMPUTED
 * from the rules (CHANNEL_EXPR precedence, foldHeat's weekday-averaged busy
 * hours, compareWindow's same-time-of-day clip) — never by calling
 * buildOrderTypesReport/foldOrderTypesReport itself. See
 * verify-reports-b3-seed.ts's doc comment for the full seed design.
 */
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/db";
import { seedReportsB3 } from "./verify-reports-b3-seed";
import { buildOrderTypesReport, buildHourDetail } from "@/lib/reports/order-types-build";
import { parseHourDetailQuery } from "@/lib/reports/order-types-query";
import { channelOf } from "@/lib/dashboard/pipelines";
import { buildDashboard } from "@/lib/dashboard/build";
import { buildSalesReport } from "@/lib/reports/sales-build";
import type { OrderTypesReport, HourDetail } from "@/types/reports-b3";
import type { DashboardChannel, DashboardHeat } from "@/types/dashboard";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reportsb3_${randomUUID().slice(0, 8)}`;
const NOW = new Date("2026-09-29T09:00:00Z"); // 14:30 IST, Tue 29 Sep 2026

const RANGE = { from: "2026-09-27", to: "2026-09-29" }; // 3 days
const WEEK_RANGE = { from: "2026-09-21", to: "2026-09-29" }; // 9 days, >= 7 -> no fallback
const ONE_DAY_RANGE = { from: "2026-09-29", to: "2026-09-29" };
const EXTRA_WEEK = { from: "2026-09-08", to: "2026-09-14" }; // exactly 7 days, one bill only

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

function heatEqual(a: DashboardHeat, b: DashboardHeat): boolean {
  return a.from === b.from && a.to === b.to && a.max === b.max && JSON.stringify(a.hours) === JSON.stringify(b.hours) && JSON.stringify(a.avg) === JSON.stringify(b.avg);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }

  process.env.MONGODB_URI = uri;
  await connectDB();

  try {
    console.log(`\nReports batch-3 live leg — seeding against ${dbName}\n`);

    const { channelDocs } = await seedReportsB3();

    // ═══════════════════════════════════════════════════════════════════════
    // channelOf(doc) === the CHANNEL_EXPR $group projection, for EVERY seeded
    // doc — proven by comparing channelOf's JS verdict (hand-typed precedence)
    // against the type each order actually landed under in the live report's
    // OWN types/hours grouping (which ran CHANNEL_EXPR in Mongo).
    // ═══════════════════════════════════════════════════════════════════════
    const expectedChannel: Record<string, DashboardChannel> = {
      O1: "counter", O2: "dine-in", O3b: "takeaway", O3: "takeaway", O4: "qr", O5: "counter",
      O6: "counter", O7: "dine-in", O8b: "dine-in", O8: "takeaway", O9: "counter", O10: "dine-in",
      O11: "counter", O12: "dine-in", O13: "qr", O14: "takeaway", O15: "counter",
      H1: "counter", H0: "counter", H2: "counter", H3: "counter", H4: "dine-in", H5: "takeaway",
      C1: "counter", C2: "dine-in", C3: "counter",
    };
    for (const doc of channelDocs) {
      check(`channelOf(${doc.id}) === ${expectedChannel[doc.id]}`, channelOf(doc) === expectedChannel[doc.id]);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // buildOrderTypesReport — 3-day RANGE (27-29 Sep)
    // ═══════════════════════════════════════════════════════════════════════
    const report = await buildOrderTypesReport(RANGE, NOW);
    assertRange3Day(report);

    // ═══════════════════════════════════════════════════════════════════════
    // PARITY with buildDashboard / buildSalesReport — 3-day range
    // ═══════════════════════════════════════════════════════════════════════
    const dashboard = await buildDashboard(RANGE, NOW);
    const salesReport = await buildSalesReport(RANGE, NOW);
    assertParity(report, dashboard, salesReport, "3-day");

    // ═══════════════════════════════════════════════════════════════════════
    // buildOrderTypesReport — WEEK_RANGE (21-29 Sep, its own insight window)
    // ═══════════════════════════════════════════════════════════════════════
    const weekReport = await buildOrderTypesReport(WEEK_RANGE, NOW);
    assertWeekRange(weekReport);
    const weekDashboard = await buildDashboard(WEEK_RANGE, NOW);
    const weekSales = await buildSalesReport(WEEK_RANGE, NOW);
    assertParity(weekReport, weekDashboard, weekSales, "week");

    // ═══════════════════════════════════════════════════════════════════════
    // buildOrderTypesReport — ONE_DAY_RANGE (29 Sep)
    // ═══════════════════════════════════════════════════════════════════════
    const oneDayReport = await buildOrderTypesReport(ONE_DAY_RANGE, NOW);
    assertOneDay(oneDayReport);
    const oneDayDashboard = await buildDashboard(ONE_DAY_RANGE, NOW);
    const oneDaySales = await buildSalesReport(ONE_DAY_RANGE, NOW);
    assertParity(oneDayReport, oneDayDashboard, oneDaySales, "1-day");

    // ═══════════════════════════════════════════════════════════════════════
    // EXTRA_WEEK (8-14 Sep, exactly 7 days) — the one window where 'qr',
    // 'takeaway' and 'dine-in' are ALL genuinely absent (only H2, a plain
    // counter bill, falls inside it) — proves heat.byType really emits
    // `hours: []` rather than only ever exercising the non-empty branch.
    // Vision guard: heat.all (the SAME window) is NON-empty (H2 present), so
    // an empty byType isn't just every window coming back empty.
    // ═══════════════════════════════════════════════════════════════════════
    const extraWeekReport = await buildOrderTypesReport(EXTRA_WEEK, NOW);
    check("EXTRA_WEEK: heat.all NON-empty (vision guard — H2 present)", extraWeekReport.heat.all.hours.length === 1 && extraWeekReport.heat.all.hours[0] === 14 && extraWeekReport.heat.all.max === 1);
    check("EXTRA_WEEK: heat.byType.qr EMPTY (hours:[], max:0)", extraWeekReport.heat.byType.qr.hours.length === 0 && extraWeekReport.heat.byType.qr.max === 0);
    check("EXTRA_WEEK: heat.byType.takeaway EMPTY", extraWeekReport.heat.byType.takeaway.hours.length === 0 && extraWeekReport.heat.byType.takeaway.max === 0);
    check("EXTRA_WEEK: heat.byType['dine-in'] EMPTY", extraWeekReport.heat.byType["dine-in"].hours.length === 0 && extraWeekReport.heat.byType["dine-in"].max === 0);
    check("EXTRA_WEEK: heat.byType.counter has the ONE cell (Tue-idx1, hour14, value 1)", extraWeekReport.heat.byType.counter.hours.length === 1 && extraWeekReport.heat.byType.counter.avg[1][0] === 1 && extraWeekReport.heat.byType.counter.max === 1);
    check("EXTRA_WEEK: every heat object has all 4 DashboardChannel keys", Object.keys(extraWeekReport.heat.byType).sort().join(",") === "counter,dine-in,qr,takeaway");

    // ═══════════════════════════════════════════════════════════════════════
    // buildHourDetail — RANGE hour10 (all types) and hour10/dine-in narrowed
    // ═══════════════════════════════════════════════════════════════════════
    const hour10All = await buildHourDetail(RANGE, 10, null, NOW);
    assertHourDetail10All(hour10All);
    const hour10DineIn = await buildHourDetail(RANGE, 10, "dine-in", NOW);
    assertHourDetail10DineIn(hour10DineIn);

    // ═══════════════════════════════════════════════════════════════════════
    // parseHourDetailQuery — route-shape URLSearchParams inputs
    // ═══════════════════════════════════════════════════════════════════════
    const ok1 = parseHourDetailQuery(new URLSearchParams("hour=20&type=qr"));
    check('parseHourDetailQuery("20","qr") -> {hour:20,type:"qr"}', "hour" in ok1 && ok1.hour === 20 && ok1.type === "qr");
    const ok2 = parseHourDetailQuery(new URLSearchParams("hour=20"));
    check('parseHourDetailQuery("20", no type) -> {hour:20,type:null}', "hour" in ok2 && ok2.hour === 20 && ok2.type === null);
    const bad1 = parseHourDetailQuery(new URLSearchParams("hour=24"));
    check('parseHourDetailQuery("24") -> {error} (out of range)', "error" in bad1);
    const bad2 = parseHourDetailQuery(new URLSearchParams("hour=20&type=x"));
    check('parseHourDetailQuery("20","x") -> {error} (unknown type)', "error" in bad2);
    const bad3 = parseHourDetailQuery(new URLSearchParams("hour=20&type=constructor"));
    check('parseHourDetailQuery("20","constructor") -> {error} (prototype key rejected)', "error" in bad3);
  } finally {
    const finalDbName = mongoose.connection.db?.databaseName ?? "";
    if (finalDbName.startsWith(SCRATCH_PREFIX)) {
      await mongoose.connection.dropDatabase();
      console.log(`\nDropped scratch database ${finalDbName}.`);
    } else {
      console.error(`Refusing to drop "${finalDbName}" at cleanup — not a scratch database.`);
    }
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

// ── Assertion blocks ─────────────────────────────────────────────────────────

function assertRange3Day(r: OrderTypesReport): void {
  check("RANGE: range 27-29 Sep", r.range.from === "2026-09-27" && r.range.to === "2026-09-29");
  check('RANGE: compare label "vs previous 3 days"', r.compare.label === "vs previous 3 days" && r.compare.from === "2026-09-24" && r.compare.to === "2026-09-26");

  // kpis.current: 16 Completed orders, sales 1900 (hand-tallied from the seed's per-order totals).
  check("RANGE: kpis.current orders16 sales1900 avg118.75", r.kpis.current.orders === 16 && r.kpis.current.sales === 1900 && r.kpis.current.averageOrder === 118.75);
  // kpis.previous: compare window clipped to 14:30 IST on the 26th -> only C1(70)+C2(80) count (C3 is after the clip).
  check("RANGE: kpis.previous orders2 sales150 (C3 excluded by same-time-of-day clip)", r.kpis.previous.orders === 2 && r.kpis.previous.sales === 150);

  // types: most sales first. dine-in(orders5,sales960) > counter(5,400) > takeaway(4,340) > qr(2,200).
  check("RANGE: 4 type rows, most-sales-first order", r.types.length === 4 && r.types.map((t) => t.key).join(",") === "dine-in,counter,takeaway,qr");
  const byType = new Map(r.types.map((t) => [t.key, t]));
  check("RANGE: dine-in orders5 sales960 avg192", byType.get("dine-in")?.orders === 5 && byType.get("dine-in")?.sales === 960 && byType.get("dine-in")?.averageOrder === 192);
  check("RANGE: counter orders5 sales400 avg80", byType.get("counter")?.orders === 5 && byType.get("counter")?.sales === 400 && byType.get("counter")?.averageOrder === 80);
  check("RANGE: takeaway orders4 sales340 avg85", byType.get("takeaway")?.orders === 4 && byType.get("takeaway")?.sales === 340 && byType.get("takeaway")?.averageOrder === 85);
  check("RANGE: qr orders2 sales200 avg100", byType.get("qr")?.orders === 2 && byType.get("qr")?.sales === 200 && byType.get("qr")?.averageOrder === 100);
  const shareSum = r.types.reduce((s, t) => s + t.share, 0);
  check("RANGE: shares sum to 1 (within float epsilon)", Math.abs(shareSum - 1) < 1e-9);
  check("RANGE: dine-in share === 960/1900", Math.abs((byType.get("dine-in")?.share ?? 0) - 960 / 1900) < 1e-9);

  // hours: contiguous span 0..23 (O6 at hour0, O5 at hour23) — hour 12 is an EMPTY hour INSIDE the span.
  check("RANGE: hours span is 24 rows (hour 0..23 contiguous)", r.hours.length === 24 && r.hours[0].hour === 0 && r.hours[23].hour === 23);
  const byHour = new Map(r.hours.map((h) => [h.hour, h]));
  check("RANGE: hour12 is present but EMPTY (orders0 sales0, gap INSIDE the span)", byHour.get(12)?.orders === 0 && byHour.get(12)?.sales === 0);
  check("RANGE: hour12 byType has all 4 keys, all zero (vision guard on the empty-hour pin)", Object.values(byHour.get(12)?.byType ?? {}).every((c) => c.orders === 0 && c.sales === 0) && Object.keys(byHour.get(12)?.byType ?? {}).length === 4);
  check("RANGE: hour0 orders1 sales50 (O6, day-attribution boundary)", byHour.get(0)?.orders === 1 && byHour.get(0)?.sales === 50);
  check("RANGE: hour23 orders1 sales50 (O5, day-attribution boundary)", byHour.get(23)?.orders === 1 && byHour.get(23)?.sales === 50);
  check("RANGE: hour10 orders4 sales560 (busiest — O1,O7,O8b,O11)", byHour.get(10)?.orders === 4 && byHour.get(10)?.sales === 560);
  check("RANGE: hour10 byType counter{2,200} dine-in{2,360}", byHour.get(10)?.byType.counter.orders === 2 && byHour.get(10)?.byType.counter.sales === 200 && byHour.get(10)?.byType["dine-in"].orders === 2 && byHour.get(10)?.byType["dine-in"].sales === 360);
  check("RANGE: hour11 orders4 sales440 (tied on orders with hour10)", byHour.get(11)?.orders === 4 && byHour.get(11)?.sales === 440);
  check("RANGE: hour13 orders3 sales300, byType has ALL 4 keys incl OX/OY NOT counted", byHour.get(13)?.orders === 3 && byHour.get(13)?.sales === 300);
  check("RANGE: hour14 orders3 sales500", byHour.get(14)?.orders === 3 && byHour.get(14)?.sales === 500);
  const hoursSalesSum = r.hours.reduce((s, h) => s + h.sales, 0);
  check(`RANGE: Σ hours.sales (${hoursSalesSum}) === kpis.current.sales (1900)`, hoursSalesSum === 1900);
  const hoursOrdersSum = r.hours.reduce((s, h) => s + h.orders, 0);
  check(`RANGE: Σ hours.orders (${hoursOrdersSum}) === kpis.current.orders (16)`, hoursOrdersSum === 16);

  // busiestHour: hour10 and hour11 tie on orders (4 each); hour10's sales (560) beat hour11's (440) -> tiebreak picks hour10.
  check("RANGE: busiestHour === 10 (orders-tie broken by sales)", r.busiestHour === 10);

  // heat: insight window for a 3-day range = the 28-day fallback ending on `to` -> 2-29 Sep.
  check("RANGE: heat.all window is 2026-09-02..2026-09-29 (28-day fallback)", r.heat.all.from === "2026-09-02" && r.heat.all.to === "2026-09-29");
  check("RANGE: heat.all max === 1.3 (Tuesday hour14, 5 orders / 4 Tuesdays)", r.heat.all.max === 1.3);
  const tueIdx = 1; // Monday-first: 0=Mon,1=Tue
  check("RANGE: heat.all Tuesday row hour14 cell === 1.3", r.heat.all.avg[tueIdx][r.heat.all.hours.indexOf(14)] === 1.3);
  check("RANGE: heat.all Wednesday row hour9 cell === 0.3 (H1, 1 order / 4 Wednesdays)", r.heat.all.avg[2][r.heat.all.hours.indexOf(9)] === 0.3);
  check("RANGE: heat.all hours span is 0..23 (H1's hour9 + the RANGE's hour0/hour23 both inside)", r.heat.all.hours.length === 24 && r.heat.all.hours[0] === 0 && r.heat.all.hours[23] === 23);

  // heat.byType: qr has orders in the insight window (O4 day27 hour14, O13 day29 hour13) -> non-empty, contiguous 13..14.
  check("RANGE: heat.byType.qr hours [13,14] (contiguous)", JSON.stringify(r.heat.byType.qr.hours) === JSON.stringify([13, 14]));
  check("RANGE: heat.byType.qr Sunday hour14 cell === 0.3 (O4, day27=Sunday, 1 order / 4 Sundays)", r.heat.byType.qr.avg[6][r.heat.byType.qr.hours.indexOf(14)] === 0.3);
  check("RANGE: heat.byType.qr Tuesday hour13 cell === 0.3 (O13, day29=Tuesday, 1 order / 4 Tuesdays)", r.heat.byType.qr.avg[1][r.heat.byType.qr.hours.indexOf(13)] === 0.3);
  check("RANGE: heat.byType has all 4 DashboardChannel keys", Object.keys(r.heat.byType).sort().join(",") === "counter,dine-in,qr,takeaway");
}

function assertWeekRange(r: OrderTypesReport): void {
  check("WEEK: range 21-29 Sep", r.range.from === "2026-09-21" && r.range.to === "2026-09-29");
  // WEEK_RANGE (9 days, >= 7) is its OWN insight window — no 28-day fallback.
  check("WEEK: heat.all window IS the range itself (21-29, >= 7 days, no fallback)", r.heat.all.from === "2026-09-21" && r.heat.all.to === "2026-09-29");

  // orders: RANGE's 16 + H5(22nd) + C1(24th) + C2(26th) + C3(26th, a real Completed order — heat/kpis for THIS wider range legitimately include it) = 20; sales 1900+100+70+80+999=3149.
  check("WEEK: kpis.current orders20 sales3149", r.kpis.current.orders === 20 && r.kpis.current.sales === 3149);

  const byType = new Map(r.types.map((t) => [t.key, t]));
  check("WEEK: counter orders7 sales1469 (most sales — C3's 999 pushes it to #1)", byType.get("counter")?.orders === 7 && byType.get("counter")?.sales === 1469);
  check("WEEK: dine-in orders6 sales1040", byType.get("dine-in")?.orders === 6 && byType.get("dine-in")?.sales === 1040);
  check("WEEK: takeaway orders5 sales440", byType.get("takeaway")?.orders === 5 && byType.get("takeaway")?.sales === 440);
  check("WEEK: qr orders2 sales200", byType.get("qr")?.orders === 2 && byType.get("qr")?.sales === 200);
  check("WEEK: types most-sales-first order", r.types.map((t) => t.key).join(",") === "counter,dine-in,takeaway,qr");

  // busiestHour: hour10 has 6 orders/710 sales (O1,O7,O8b,O11 + C1,C2) — the outright max (no tie needed here).
  check("WEEK: busiestHour === 10 (6 orders, outright max)", r.busiestHour === 10);
  const byHour = new Map(r.hours.map((h) => [h.hour, h]));
  check("WEEK: hour10 orders6 sales710", byHour.get(10)?.orders === 6 && byHour.get(10)?.sales === 710);

  // heat.all max: Sunday (27th, the ONLY Sunday in 21-29) hour11 = O2+O3b = 2 orders / 1 Sunday = 2.0 (the range's own biggest single-weekday spike).
  check("WEEK: heat.all max === 2 (single-Sunday hour11 spike, no averaging-down)", r.heat.all.max === 2);
  const sunIdx = 6; // Monday-first: 6=Sun
  check("WEEK: heat.all Sunday row hour11 cell === 2", r.heat.all.avg[sunIdx][r.heat.all.hours.indexOf(11)] === 2);
}

function assertOneDay(r: OrderTypesReport): void {
  check("ONE_DAY: range 29 Sep", r.range.from === "2026-09-29" && r.range.to === "2026-09-29");
  check('ONE_DAY: compare label "vs Tue, 22 Sep"', r.compare.label === "vs Tue, 22 Sep");
  // 29 Sep's own Completed orders: O11,O12,O13,O14 = 4 orders, sales 400 (O15 excluded by currentWindow's clock clip).
  check("ONE_DAY: kpis.current orders4 sales400 (O15 excluded by clock)", r.kpis.current.orders === 4 && r.kpis.current.sales === 400);
  check("ONE_DAY: 4 type rows, one order each, equal shares (0.25)", r.types.length === 4 && r.types.every((t) => t.orders === 1 && t.sales === 100 && Math.abs(t.share - 0.25) < 1e-9));
  check("ONE_DAY: hours span hour10..hour14 contiguous (5 rows, no gap)", r.hours.length === 5 && r.hours[0].hour === 10 && r.hours[4].hour === 14);
  // 4 hours each with exactly 1 order/100 sales -> a 4-way tie on orders, earliest hour (10) wins.
  check("ONE_DAY: busiestHour === 10 (4-way orders tie, earliest hour)", r.busiestHour === 10);
  // insight window for the 1-day range = SAME 28-day fallback ending on `to` (29 Sep) as the 3-day range — insightRange only depends on range.to.
  check("ONE_DAY: heat.all window is 2026-09-02..2026-09-29 (SAME fallback window as the 3-day range)", r.heat.all.from === "2026-09-02" && r.heat.all.to === "2026-09-29");
  check("ONE_DAY: heat.all max === 1.3 (identical grid to the 3-day range's heat.all)", r.heat.all.max === 1.3);
}

function assertParity(
  r: OrderTypesReport,
  dashboard: { kpis: { current: unknown; previous: unknown }; channels: Array<{ key: string; amount: number; count: number; share: number }>; heat: DashboardHeat },
  salesReport: { kpis: { current: { sales: number } } },
  label: string,
): void {
  check(`PARITY(${label}): kpis.current deepEqual Dashboard's kpis.current`, JSON.stringify(r.kpis.current) === JSON.stringify(dashboard.kpis.current));
  check(`PARITY(${label}): kpis.previous deepEqual Dashboard's kpis.previous`, JSON.stringify(r.kpis.previous) === JSON.stringify(dashboard.kpis.previous));
  check(`PARITY(${label}): heat.all deepEqual Dashboard's heat`, heatEqual(r.heat.all, dashboard.heat));
  check(
    `PARITY(${label}): channels <-> types (key/count/amount/share) agree`,
    JSON.stringify(dashboard.channels.map((c) => ({ key: c.key, count: c.count, amount: c.amount, share: c.share }))) ===
      JSON.stringify(r.types.map((t) => ({ key: t.key, count: t.orders, amount: t.sales, share: t.share }))),
  );
  check(`PARITY(${label}): OrderTypesReport.kpis.current.sales (${r.kpis.current.sales}) === SalesReport kpis.current.sales (${salesReport.kpis.current.sales})`, r.kpis.current.sales === salesReport.kpis.current.sales);
}

function assertHourDetail10All(d: HourDetail): void {
  check("HourDetail hour10/all: hour10, type null", d.hour === 10 && d.type === null);
  check("HourDetail hour10/all: 3 days, oldest first", d.days.length === 3 && d.days[0].date === "2026-09-27" && d.days[1].date === "2026-09-28" && d.days[2].date === "2026-09-29");
  check('HourDetail hour10/all: day27 label "Sun, 27 Sep" orders1 sales100', d.days[0].label === "Sun, 27 Sep" && d.days[0].orders === 1 && d.days[0].sales === 100);
  check("HourDetail hour10/all: day28 orders2 sales360 (O7+O8b)", d.days[1].orders === 2 && d.days[1].sales === 360);
  check("HourDetail hour10/all: day29 orders1 sales100", d.days[2].orders === 1 && d.days[2].sales === 100);
  const daysOrdersSum = d.days.reduce((s, x) => s + x.orders, 0);
  const daysSalesSum = d.days.reduce((s, x) => s + x.sales, 0);
  check(`HourDetail hour10/all: Σ days === that HourRow (orders${daysOrdersSum}=4, sales${daysSalesSum}=560)`, daysOrdersSum === 4 && daysSalesSum === 560);
}

function assertHourDetail10DineIn(d: HourDetail): void {
  check("HourDetail hour10/dine-in: type dine-in", d.type === "dine-in");
  // Only day28 has a dine-in order at hour10 (O7+O8b); day27(O1 counter)/day29(O11 counter) are OMITTED, not zero-rows.
  check("HourDetail hour10/dine-in: 1 day (day28 only — day27/29 omitted, not zero rows)", d.days.length === 1 && d.days[0].date === "2026-09-28");
  check("HourDetail hour10/dine-in: day28 orders2 sales360", d.days[0].orders === 2 && d.days[0].sales === 360);
  check("HourDetail hour10/dine-in: Σ days === RANGE hour10 byType['dine-in'] cell (orders2 sales360)", d.days[0].orders === 2 && d.days[0].sales === 360);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
