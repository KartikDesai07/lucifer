/**
 * Reports Batch-1 live leg — proves buildSalesReport()/buildDuesReport()
 * against a REAL MongoDB, which the DB-free unit tests (lib/reports/*.test.ts)
 * cannot: that the real pipelines (salesFacet, duesByDayPipeline, the dues/
 * credit aggregates) actually run and return the shapes sales-fold.ts/
 * dues-build.ts expect, on one seeded dataset, and that Reports agrees with
 * the Dashboard on the same range (money/kpis/series/dues are ONE rule, two
 * routes).
 *
 *   npm run verify:reports:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reports_xxxx npm run verify:reports:live
 *
 * SAFETY: refuses any database whose name does not carry the scratch prefix,
 * and drops the WHOLE scratch database in a finally block (buildDuesReport's
 * outstanding total reads ALL customers with no scoping filter, so a shared/
 * reused DB would leak other legs' fixtures into it).
 * (console output is intentional — this is an ops CLI script, not app code.)
 *
 * ── Fixed clock ──────────────────────────────────────────────────────────────
 * NOW = 2026-09-29T09:00:00Z = 14:30 IST, Tuesday 29 Sep 2026 (same clock as
 * verify-dashboard-live.ts, so the PARITY block below compares like for like).
 *
 * ── Arithmetic ground truth ──────────────────────────────────────────────────
 * Every expected number is hand-computed from the Batch-1 plan's money rules
 * (lib/reports/received.ts's own doc comment), never by calling
 * sales-fold.ts/sales-pipelines.ts/received.ts itself.
 */
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { DuePayment } from "@/models/DuePayment";
import { buildSalesReport } from "@/lib/reports/sales-build";
import { buildDuesReport } from "@/lib/reports/dues-build";
import { buildDashboard } from "@/lib/dashboard/build";
import { receivedOf } from "@/lib/reports/received";
import type { SalesReport } from "@/types/reports";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reports_${randomUUID().slice(0, 8)}`;
const NOW = new Date("2026-09-29T09:00:00Z"); // 14:30 IST, Tue 29 Sep 2026
const IST_OFFSET_MS = 330 * 60 * 1000;

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

// An IST wall-clock string ("YYYY-MM-DDTHH:MM:SS", no zone) -> the UTC Date it
// represents, matching cafeDateString's own fixed-offset math.
function ist(localNoZ: string): Date {
  return new Date(new Date(`${localNoZ}Z`).getTime() - IST_OFFSET_MS);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  process.env.MONGODB_URI = uri;
  await connectDB();

  try {
    console.log(`\nReports live leg — seeding against ${dbName}\n`);

    const orderId = (label: string) => `SCRATCH-RPT-${randomUUID().slice(0, 8)}-${label}`;
    const item = (name: string, price: number, qty: number, reward = false) => ({
      productId: new mongoose.Types.ObjectId(),
      name,
      price,
      qty,
      modifiers: [],
      instructions: "",
      kotRound: 1,
      ...(reward ? { reward: true } : {}),
    });
    type OrderDoc = Record<string, unknown>;
    const baseOrder = (over: OrderDoc): OrderDoc => ({
      orderId: orderId(String(over.orderId ?? "x")),
      customerName: "Walk-In",
      subtotal: 0,
      discount: 0,
      gstAmount: 0,
      paidAmount: 0,
      payment: "Cash",
      status: "Completed",
      receiver: "Verifier",
      kotRounds: 1,
      ...over,
    });

    // ---- Today (29 Sep IST), every SETTLEMENT_PAY_MODES branch + the leak
    // surfaces the plan asks for, across the 23:50/00:10 IST midnight boundary ----
    const T_CASH_FULL = baseOrder({ orderId: "cash-full", createdAt: ist("2026-09-29T10:00:00"), items: [item("Tea", 30, 10)], subtotal: 300, total: 300, paidAmount: 300, payment: "Cash" });
    const T_CASH_PART = baseOrder({ orderId: "cash-part", createdAt: ist("2026-09-29T10:15:00"), items: [item("Coffee", 50, 10)], subtotal: 500, total: 500, paidAmount: 200, payment: "Cash" });
    const T_ONLINE = baseOrder({ orderId: "online", createdAt: ist("2026-09-29T10:30:00"), items: [item("Samosa", 20, 20)], subtotal: 400, total: 400, paidAmount: 400, payment: "Online" });
    const T_SPLIT_PARTS = baseOrder({ orderId: "split-parts", createdAt: ist("2026-09-29T11:00:00"), items: [item("Sandwich", 30, 10)], subtotal: 300, total: 300, paidAmount: 300, payment: "Split", splitCash: 200, splitOnline: 100 });
    const T_SPLIT_NOPARTS = baseOrder({ orderId: "split-noparts", createdAt: ist("2026-09-29T11:15:00"), items: [item("Pizza", 250, 1)], subtotal: 250, total: 250, paidAmount: 250, payment: "Split" });
    const T_DUE = baseOrder({ orderId: "due", createdAt: ist("2026-09-29T11:30:00"), items: [item("Burger", 700, 1)], subtotal: 700, total: 700, paidAmount: 0, payment: "Due" });
    const T_CREDIT = baseOrder({ orderId: "credit", createdAt: ist("2026-09-29T12:00:00"), items: [item("Thali", 600, 1)], subtotal: 600, total: 600, paidAmount: 600, payment: "Credit" });
    const T_CANCELLED = baseOrder({ orderId: "cancelled", createdAt: ist("2026-09-29T12:10:00"), items: [item("Juice", 300, 1)], subtotal: 300, total: 300, paidAmount: 0, payment: "Unpaid", status: "Cancelled", cancelReason: "test", cancelledBy: "Verifier", cancelledAt: ist("2026-09-29T12:12:00") });
    const T_REWARD_LINE = baseOrder({ orderId: "reward-line", createdAt: ist("2026-09-29T12:15:00"), items: [item("Samosa", 20, 10), item("FreeDish", 60, 1, true)], subtotal: 200, total: 200, paidAmount: 200, payment: "Cash" });
    const T_REWARD_KIND = baseOrder({ orderId: "reward-kind", createdAt: ist("2026-09-29T12:30:00"), items: [item("Sandwich", 70, 10)], subtotal: 700, discount: 70, discountKind: "reward", total: 630, paidAmount: 630, payment: "Cash" });
    const T_MANUAL_DISCOUNT = baseOrder({ orderId: "manual-discount", createdAt: ist("2026-09-29T12:45:00"), items: [item("Burger", 150, 4)], subtotal: 600, discount: 50, total: 550, paidAmount: 550, payment: "Online" });
    const T_GST_EXCLUSIVE = baseOrder({ orderId: "gst-exclusive", createdAt: ist("2026-09-29T13:00:00"), items: [item("Burger", 150, 4)], subtotal: 600, gstAmount: 30, gstMode: "exclusive", total: 630, paidAmount: 630, payment: "Cash" });
    const T_TABLE_CHARGE = baseOrder({ orderId: "table-charge", createdAt: ist("2026-09-29T13:15:00"), items: [item("Pizza", 300, 1)], subtotal: 300, chargeAmount: 20, chargeLabel: "Rooftop charge", total: 320, paidAmount: 320, payment: "Cash", tableNo: "T-1" });
    // Just after IST midnight -- IST day is 29 Sep, even though the UTC date is 28 Sep.
    const T_MIDNIGHT = baseOrder({ orderId: "midnight", createdAt: ist("2026-09-29T00:10:00"), items: [item("Tea", 30, 2)], subtotal: 60, total: 60, paidAmount: 60, payment: "Cash" });

    // ---- Yesterday (28 Sep IST), just before the boundary ----
    const Y_LATE = baseOrder({ orderId: "y-late", createdAt: ist("2026-09-28T23:50:00"), items: [item("Tea", 100, 1)], subtotal: 100, total: 100, paidAmount: 100, payment: "Cash" });

    const todayOrders = [
      T_CASH_FULL, T_CASH_PART, T_ONLINE, T_SPLIT_PARTS, T_SPLIT_NOPARTS, T_DUE, T_CREDIT,
      T_REWARD_LINE, T_REWARD_KIND, T_MANUAL_DISCOUNT, T_GST_EXCLUSIVE, T_TABLE_CHARGE, T_MIDNIGHT,
    ];
    const allOrders = [...todayOrders, T_CANCELLED, Y_LATE];
    await Order.insertMany(allOrders);

    // ── DuePayment (across the boundary, every mode + a soft-deleted one) ────
    const duesCustomer = await Customer.create({ name: "Dues Customer", mobile: "9990000010", totalDue: 500 });
    const secondDuesCustomer = await Customer.create({ name: "Second Due Customer", mobile: "9990000011", totalDue: 300 });
    await Customer.create({ name: "Settled Customer", mobile: "9990000012", totalDue: 0 });
    const dpCash = await DuePayment.create({ customerId: duesCustomer._id, amount: 150, mode: "Cash", receivedBy: "Verifier", clientRef: randomUUID(), createdAt: ist("2026-09-29T10:05:00") });
    const dpOnline = await DuePayment.create({ customerId: duesCustomer._id, amount: 80, mode: "Online", receivedBy: "Verifier", clientRef: randomUUID(), createdAt: ist("2026-09-29T10:20:00") });
    // Legacy mode receipt (stored before SETTLEMENT_PAY_MODES narrowed the
    // receipt surface, G7's own reasoning) -- must fall into "other".
    const dpLegacy = await DuePayment.create({ customerId: secondDuesCustomer._id, amount: 40, mode: "Split", receivedBy: "Verifier", clientRef: randomUUID(), createdAt: ist("2026-09-29T10:25:00") });
    // Soft-deleted -- ACTIVE_DUE_PAYMENT must exclude it from every collected number.
    await DuePayment.create({ customerId: duesCustomer._id, amount: 999, mode: "Cash", receivedBy: "Verifier", clientRef: randomUUID(), createdAt: ist("2026-09-29T10:30:00"), deletedAt: ist("2026-09-29T10:31:00"), deletedBy: "Verifier", deleteNote: "test soft delete" });
    // Yesterday's own receipt -- inside Yesterday's window, outside Today's.
    const dpYesterday = await DuePayment.create({ customerId: duesCustomer._id, amount: 60, mode: "Cash", receivedBy: "Verifier", clientRef: randomUUID(), createdAt: ist("2026-09-28T23:55:00") });

    console.log(`Seeded ${allOrders.length} orders, 5 due payments, 3 customers.\n`);

    // ═══════════════════════════════════════════════════════════════════════
    // receivedOf() JS fold vs the pipeline's CASH/ONLINE/OTHER/CREDIT twins —
    // every seeded Completed order agrees, per bill.
    // ═══════════════════════════════════════════════════════════════════════
    const todayReport = await buildSalesReport({ from: "2026-09-29", to: "2026-09-29" }, NOW);
    const pipelineTotals = { cash: 0, online: 0, other: 0, credit: 0 };
    for (const day of todayReport.days) {
      pipelineTotals.cash += day.cash;
      pipelineTotals.online += day.online;
      pipelineTotals.other += day.other;
      pipelineTotals.credit += day.credit;
    }
    const jsTotals = { cash: 0, online: 0, other: 0, credit: 0 };
    for (const o of todayOrders) {
      const split = receivedOf(o as { payment?: string; total?: number; paidAmount?: number; splitCash?: number; splitOnline?: number });
      jsTotals.cash += split.cash;
      jsTotals.online += split.online;
      jsTotals.other += split.other;
      jsTotals.credit += split.credit;
    }
    check(`receivedOf JS fold cash (${jsTotals.cash}) === pipeline (${pipelineTotals.cash})`, jsTotals.cash === pipelineTotals.cash);
    check(`receivedOf JS fold online (${jsTotals.online}) === pipeline (${pipelineTotals.online})`, jsTotals.online === pipelineTotals.online);
    check(`receivedOf JS fold other (${jsTotals.other}) === pipeline (${pipelineTotals.other})`, jsTotals.other === pipelineTotals.other);
    check(`receivedOf JS fold credit (${jsTotals.credit}) === pipeline (${pipelineTotals.credit})`, jsTotals.credit === pipelineTotals.credit);

    // ═══════════════════════════════════════════════════════════════════════
    // buildSalesReport — Today (29 -> 29)
    // ═══════════════════════════════════════════════════════════════════════
    assertToday(todayReport);

    // ═══════════════════════════════════════════════════════════════════════
    // buildSalesReport — Yesterday (28 -> 28)
    // ═══════════════════════════════════════════════════════════════════════
    const yesterdayReport = await buildSalesReport({ from: "2026-09-28", to: "2026-09-28" }, NOW);
    assertYesterday(yesterdayReport);

    // ═══════════════════════════════════════════════════════════════════════
    // buildSalesReport — 2-day range (28 -> 29)
    // ═══════════════════════════════════════════════════════════════════════
    const twoDayReport = await buildSalesReport({ from: "2026-09-28", to: "2026-09-29" }, NOW);
    assertTwoDay(twoDayReport);

    // ═══════════════════════════════════════════════════════════════════════
    // PARITY with buildDashboard — same range, same kpis/money/series, and
    // Σ dues (Today's dues.cash+online+other) === dashboard.duesCollected.
    // ═══════════════════════════════════════════════════════════════════════
    for (const [label, range] of [
      ["Today", { from: "2026-09-29", to: "2026-09-29" }],
      ["Yesterday", { from: "2026-09-28", to: "2026-09-28" }],
      ["2-day", { from: "2026-09-28", to: "2026-09-29" }],
    ] as const) {
      const report = label === "Today" ? todayReport : label === "Yesterday" ? yesterdayReport : twoDayReport;
      const dashboard = await buildDashboard(range, NOW);
      check(`${label} PARITY: kpis.current === dashboard's`, JSON.stringify(report.kpis.current) === JSON.stringify(dashboard.kpis.current));
      check(`${label} PARITY: kpis.previous === dashboard's`, JSON.stringify(report.kpis.previous) === JSON.stringify(dashboard.kpis.previous));
      check(`${label} PARITY: money === dashboard's`, JSON.stringify(report.money) === JSON.stringify(dashboard.money));
      check(`${label} PARITY: series === dashboard's`, JSON.stringify(report.series) === JSON.stringify(dashboard.series));
      const duesSum = report.dues.cash + report.dues.online + report.dues.other;
      check(`${label} PARITY: Σ dues (${duesSum}) === dashboard.duesCollected (${dashboard.duesCollected})`, duesSum === dashboard.duesCollected);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // buildDuesReport
    // ═══════════════════════════════════════════════════════════════════════
    const duesReport = await buildDuesReport({ from: "2026-09-29", to: "2026-09-29" }, NOW);
    assertDues(duesReport);
    void dpCash; void dpOnline; void dpLegacy; void dpYesterday;
  } finally {
    const finalDbName = mongoose.connection.db?.databaseName ?? "";
    if (finalDbName.startsWith(SCRATCH_PREFIX)) {
      await mongoose.connection.dropDatabase();
    } else {
      console.error(`Refusing to drop "${finalDbName}" at cleanup — not a scratch database.`);
    }
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

// ── Assertion blocks ─────────────────────────────────────────────────────────

function assertToday(r: SalesReport): void {
  check("Today: range", r.range.from === "2026-09-29" && r.range.to === "2026-09-29");
  check("Today: mode === hour", r.mode === "hour");

  // 13 Completed orders today (cancelled excluded): full 300 + part 500 +
  // online 400 + split-parts 300 + split-noparts 250 + due 700 + credit 600 +
  // reward-line 200 + reward-kind 630 + manual-discount 550 + gst-exclusive
  // 630 + table-charge 320 + midnight 60.
  const expectedOrders = 13;
  const expectedSales = 300 + 500 + 400 + 300 + 250 + 700 + 600 + 200 + 630 + 550 + 630 + 320 + 60;
  const expectedCollected = 300 + 200 + 400 + 300 + 250 + 0 + 600 + 200 + 630 + 550 + 630 + 320 + 60;
  check(`Today: kpis.current.orders === ${expectedOrders}`, r.kpis.current.orders === expectedOrders);
  check(`Today: kpis.current.sales === ${expectedSales}`, r.kpis.current.sales === expectedSales);
  check(`Today: kpis.current.collected === ${expectedCollected}`, r.kpis.current.collected === expectedCollected);

  check("Today: exactly one day row", r.days.length === 1);
  const day = r.days[0];
  check("Today: day.date === 2026-09-29", day.date === "2026-09-29");
  check(`Today: day.orders === ${expectedOrders}`, day.orders === expectedOrders);
  check(`Today: day.net === ${expectedSales}`, day.net === expectedSales);

  // received split, per bill, hand-folded:
  //   cash-full: cash 300         cash-part: cash 200 (paid 200, credit 300)
  //   online: online 400          split-parts: cash 200 online 100
  //   split-noparts: other 250    due: credit 700 (total 700, paid 0)
  //   credit: other 600           reward-line: cash 200
  //   reward-kind: cash 630       manual-discount: online 550
  //   gst-exclusive: cash 630     table-charge: cash 320
  //   midnight: cash 60
  const expectedCash = 300 + 200 + 200 + 200 + 630 + 630 + 320 + 60; // = 2540
  const expectedOnline = 400 + 100 + 550; // = 1050
  const expectedOther = 250 + 600; // = 850
  // credit is Σ(total - paid) over EVERY bill, not only the Due one:
  // cash-part 500-200=300, due 700-0=700 -> 1000.
  const expectedCredit = 300 + 700;
  check(`Today: received.cash === ${expectedCash}`, day.cash === expectedCash && r.received.cash === expectedCash);
  check(`Today: received.online === ${expectedOnline}`, day.online === expectedOnline && r.received.online === expectedOnline);
  check(`Today: received.other === ${expectedOther}`, day.other === expectedOther && r.received.other === expectedOther);
  check(`Today: received.credit === ${expectedCredit}`, day.credit === expectedCredit && r.received.credit === expectedCredit);
  check(
    "Today: identity cash+online+other+credit === net",
    day.cash + day.online + day.other + day.credit === day.net,
  );

  // money identity: gross - discount - reward + gst + charges === net.
  check(
    "Today: money identity gross-discount-reward+gst+charges === net",
    r.money.gross - r.money.discount - r.money.reward + r.money.gst + r.money.charges === expectedSales,
  );
  // reward-kind order: gross += 700 (subtotal, no reward LINE), reward += 70 (the discount).
  // reward-line order: gross += 200+60=260 (subtotal + the free line's value), reward += 60.
  // manual-discount: gross += 600, discount += 50.
  // gst-exclusive: gst += 30. table-charge: charges += 20.
  check(`Today: money.discount === 50`, r.money.discount === 50);
  check(`Today: money.reward === 130 (60 + 70)`, r.money.reward === 130);
  check(`Today: money.gst === 30`, r.money.gst === 30);
  check(`Today: money.charges === 20`, r.money.charges === 20);

  // dues.cash === 150 (dpCash), dues.online === 80 (dpOnline), dues.other === 40 (dpLegacy).
  check("Today: dues.cash === 150", day.dues.cash === 150 && r.dues.cash === 150);
  check("Today: dues.online === 80", day.dues.online === 80 && r.dues.online === 80);
  check("Today: dues.other === 40 (legacy 'Split'-mode receipt)", day.dues.other === 40 && r.dues.other === 40);

  // payments — grouped by the `payment` FIELD (billed = Σ total of bills rung
  // up under that mode), distinct from the received SPLIT above (which is
  // grouped by where the money actually went). Cash-mode bills: cash-full
  // 300 + cash-part 500 + reward-line 200 + reward-kind 630 + gst-exclusive
  // 630 + table-charge 320 + midnight 60 = 2640, 7 orders. Online-mode
  // bills: online 400 + manual-discount 550 = 950, 2 orders.
  const pay = new Map(r.payments.map((p) => [p.mode, p]));
  check("Today: payments Cash billed 2640 orders 7", pay.get("Cash")?.billed === 2640 && pay.get("Cash")?.orders === 7);
  check("Today: payments Online billed 950 orders 2", pay.get("Online")?.billed === 950 && pay.get("Online")?.orders === 2);
  check("Today: payments Split billed 550 orders 2", pay.get("Split")?.billed === 550 && pay.get("Split")?.orders === 2);
  check("Today: payments Due billed 700 orders 1", pay.get("Due")?.billed === 700 && pay.get("Due")?.orders === 1);
  check("Today: payments Credit billed 600 orders 1", pay.get("Credit")?.billed === 600 && pay.get("Credit")?.orders === 1);
  // sorted by billed desc: Cash 2640 > Online 950 > Due 700 > Credit 600 > Split 550.
  check(
    "Today: payments sorted billed desc",
    r.payments.map((p) => p.mode).join(",") === ["Cash", "Online", "Due", "Credit", "Split"].join(","),
  );

  // split row: 2 Split bills, splitCash 200 (only split-parts has one; split-noparts contributes 0), splitOnline 100.
  check("Today: split.orders === 2", r.split.orders === 2);
  check("Today: split.cash === 200", r.split.cash === 200);
  check("Today: split.online === 100", r.split.online === 100);
}

function assertYesterday(r: SalesReport): void {
  check("Yesterday: range", r.range.from === "2026-09-28" && r.range.to === "2026-09-28");
  check("Yesterday: exactly one day row", r.days.length === 1);
  const day = r.days[0];
  check("Yesterday: day.date === 2026-09-28", day.date === "2026-09-28");
  check("Yesterday: orders === 1 (y-late, 23:50 IST)", day.orders === 1);
  check("Yesterday: net === 100", day.net === 100);
  check("Yesterday: received.cash === 100", day.cash === 100);
  check("Yesterday: dues.cash === 60 (dpYesterday)", day.dues.cash === 60 && r.dues.cash === 60);
}

function assertTwoDay(r: SalesReport): void {
  check("2-day: range", r.range.from === "2026-09-28" && r.range.to === "2026-09-29");
  check("2-day: mode === day", r.mode === "day");
  check("2-day: exactly two day rows, oldest first", r.days.length === 2 && r.days[0].date === "2026-09-28" && r.days[1].date === "2026-09-29");
  check("2-day: kpis.current.orders === 14 (1 yesterday + 13 today)", r.kpis.current.orders === 14);

  // range totals must equal Σ of the day rows (never independently derived).
  const sumOrders = r.days.reduce((s, d) => s + d.orders, 0);
  const sumNet = r.days.reduce((s, d) => s + d.net, 0);
  const sumCash = r.days.reduce((s, d) => s + d.cash, 0);
  const sumDuesCash = r.days.reduce((s, d) => s + d.dues.cash, 0);
  check("2-day: kpis.current.orders === Σ day orders", r.kpis.current.orders === sumOrders);
  check("2-day: kpis.current.sales === Σ day net", r.kpis.current.sales === sumNet);
  check("2-day: received.cash === Σ day cash", r.received.cash === sumCash);
  check("2-day: dues.cash === Σ day dues.cash === 210 (60 + 150)", r.dues.cash === sumDuesCash && r.dues.cash === 210);
}

function assertDues(d: {
  outstanding: { total: number; customers: number; rows: Array<{ name: string; totalDue: number }>; truncated: boolean };
  collected: { cash: number; online: number; other: number; total: number; count: number; rows: Array<{ customerName: string; mode: string }>; truncated: boolean };
  creditGiven: { total: number; orders: number };
}): void {
  // outstanding: two customers with totalDue > 0 (500 + 300), the zero-due one excluded.
  check("Dues: outstanding.total === 800", d.outstanding.total === 800);
  check("Dues: outstanding.customers === 2", d.outstanding.customers === 2);
  check("Dues: outstanding.rows sorted totalDue desc", d.outstanding.rows[0]?.totalDue === 500 && d.outstanding.rows[1]?.totalDue === 300);
  check("Dues: outstanding.truncated === false", d.outstanding.truncated === false);

  // collected: Today's window only (dpYesterday excluded, the soft-deleted 999 excluded).
  // dpCash 150 + dpOnline 80 + dpLegacy 40 (Split-mode, bucketed as other) = 270.
  check("Dues: collected.cash === 150", d.collected.cash === 150);
  check("Dues: collected.online === 80", d.collected.online === 80);
  check("Dues: collected.other === 40 (legacy 'Split' mode receipt)", d.collected.other === 40);
  check("Dues: collected.total === 270", d.collected.total === 270);
  check("Dues: collected.count === 3 (soft-deleted + yesterday's excluded)", d.collected.count === 3);
  check("Dues: collected.truncated === false", d.collected.truncated === false);
  check(
    "Dues: collected.rows carry real customer names (soft-delete/legacy still resolve)",
    d.collected.rows.every((row) => row.customerName.length > 0),
  );

  // creditGiven: Today's Completed bills where total > paidAmount — only the
  // Due order (700 - 0 = 700) and the Cash part-paid order (500 - 200 = 300).
  check("Dues: creditGiven.total === 1000 (700 + 300)", d.creditGiven.total === 1000);
  check("Dues: creditGiven.orders === 2", d.creditGiven.orders === 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
