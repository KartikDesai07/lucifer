/**
 * Reports Batch-2 live leg — proves buildItemsReport / buildItemDetail /
 * buildCancelsReport / buildGstReport against a REAL MongoDB, which the
 * DB-free unit tests (lib/reports/{items,cancels,gst}-*.test.ts) cannot: that
 * the real pipelines/JS folds actually run on a seeded dataset, agree with
 * buildDashboard/buildSalesReport for the SAME range (one rule, several
 * screens), and that gstOfBill() never drifts from the printed bill's own
 * receiptGst() rule.
 *
 *   npm run verify:reports-b2:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reportsb2_xxxx npm run verify:reports-b2:live
 *
 * SAFETY: refuses any database whose name does not carry the scratch prefix,
 * and drops the WHOLE scratch database in a finally block.
 * (console output is intentional — this is an ops CLI script, not app code.)
 *
 * ── Fixed clock ──────────────────────────────────────────────────────────────
 * NOW = 2026-09-29T09:00:00Z = 14:30 IST, Tuesday 29 Sep 2026 (same clock as
 * verify-reports-live.ts / verify-dashboard-live.ts).
 *
 * ── Seed shape ─────────────────────────────────────────────────────────────
 * Built by scripts/verify-reports-b2-seed.ts (split out to keep this file
 * under the size budget) — see that file's own doc comment + the per-order
 * hand-computed comments for the full dataset. Every expected number in the
 * assertion blocks below is HAND-COMPUTED from the money rules
 * (computeOrderTotals / orderMoneyContribution / receiptGst) — never by
 * calling the folds under test. gstOfBill()/receiptGst() parity is the one
 * allowed "rule" call (per the batch-2 spec: it's the identity being proved).
 */
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/db";
import { Settings } from "@/models/Settings";
import { seedReportsB2 } from "./verify-reports-b2-seed";
import { buildItemsReport, buildItemDetail } from "@/lib/reports/items-build";
import { buildCancelsReport } from "@/lib/reports/cancels-build";
import { buildGstReport } from "@/lib/reports/gst-build";
import { gstOfBill } from "@/lib/reports/gst-fold";
import { receiptGst, gstConfigOfSettings } from "@/lib/receipt";
import { buildDashboard } from "@/lib/dashboard/build";
import { buildSalesReport } from "@/lib/reports/sales-build";
import { UNCATEGORISED_LABEL, REMOVED_ITEMS_LABEL, CATEGORY_LIMIT } from "@/lib/dashboard/fold";
import type { ItemsReport, CancelsReport, GstReport } from "@/types/reports-b2";
import { assertGstInvoices, assertCancelledInvoiceOnly } from "./verify-reports-b2-invoices";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reportsb2_${randomUUID().slice(0, 8)}`;
const NOW = new Date("2026-09-29T09:00:00Z"); // 14:30 IST, Tue 29 Sep 2026
const RANGE = { from: "2026-09-27", to: "2026-09-29" };
const ONE_DAY_RANGE = { from: "2026-09-29", to: "2026-09-29" };

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
    console.log(`\nReports batch-2 live leg — seeding against ${dbName}\n`);

    const { tea, completedBills } = await seedReportsB2();

    // ═══════════════════════════════════════════════════════════════════════
    // gstOfBill() === receiptGst()-derived numbers, per seeded Completed bill —
    // the one allowed "rule" call (proving the report never drifts from the
    // printed bill). Also the identity taxable+gst+noGst+charges === total.
    // ═══════════════════════════════════════════════════════════════════════
    const liveSettings = await Settings.findOne().lean();
    if (!liveSettings) throw new Error("Settings seed missing");
    const liveCfg = gstConfigOfSettings(liveSettings);
    for (const o of completedBills) {
      const viaFold = gstOfBill({ ...o, status: o.status }, liveCfg);
      const viaReceipt = receiptGst(o, liveCfg);
      const expectedNoGst = viaReceipt.show ? 0 : o.total - (o.chargeAmount ?? 0);
      check(
        `gstOfBill(${o.orderId}) matches receiptGst: taxable/gst/rate`,
        viaFold.taxable === viaReceipt.taxable && viaFold.gst === viaReceipt.gstAmount && viaFold.rate === viaReceipt.rate && viaFold.noGst === expectedNoGst,
      );
      check(
        `gstOfBill(${o.orderId}) identity taxable+gst+noGst+charges === total`,
        viaFold.taxable + viaFold.gst + viaFold.noGst + viaFold.charges === o.total,
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // buildItemsReport — range 27-29 Sep
    // ═══════════════════════════════════════════════════════════════════════
    const itemsReport = await buildItemsReport(RANGE, NOW);
    assertItems(itemsReport);

    // Item detail — Tea, day mode (3-day range): O1(27,qty10,sales300) + O16(29,qty2,sales60)
    // + O5(28,qty5,sales150) + O10(28,qty10,sales300) + O14(28,qty8,sales240) ->
    // day 28 merges O5+O10+O14 = qty23,sales690.
    const teaDetail = await buildItemDetail(RANGE, { productId: String(tea), label: "Tea" }, NOW);
    check("ItemDetail Tea: 3 day-buckets (27,28,29)", teaDetail.points.length === 3);
    const byDay = new Map(teaDetail.points.map((p) => [p.key, p]));
    check("ItemDetail Tea: 27 Sep qty10 sales300", byDay.get("2026-09-27")?.qty === 10 && byDay.get("2026-09-27")?.sales === 300);
    check("ItemDetail Tea: 28 Sep qty23 sales690 (O5+O10+O14 merged)", byDay.get("2026-09-28")?.qty === 23 && byDay.get("2026-09-28")?.sales === 690);
    check("ItemDetail Tea: 29 Sep qty2 sales60", byDay.get("2026-09-29")?.qty === 2 && byDay.get("2026-09-29")?.sales === 60);
    check("ItemDetail Tea: removed 0 (no void of Tea by label, in-range — O14's void IS Tea)", teaDetail.removed.qty === 2 && teaDetail.removed.value === 60);

    // Item detail — one-day range (29 Sep), hour mode: O16 (00:10 -> hour 0), O17 (08:00 -> hour 8).
    const teaHourDetail = await buildItemDetail(ONE_DAY_RANGE, { productId: String(tea), label: "Tea" }, NOW);
    check("ItemDetail Tea (1-day): mode hour", teaHourDetail.mode === "hour");
    check("ItemDetail Tea (1-day): 1 bucket (hour 0, qty2 sales60)", teaHourDetail.points.length === 1 && teaHourDetail.points[0].qty === 2 && teaHourDetail.points[0].sales === 60);

    // ═══════════════════════════════════════════════════════════════════════
    // PARITY with buildDashboard — topItems / categories, same range.
    // ═══════════════════════════════════════════════════════════════════════
    const dashboard = await buildDashboard(RANGE, NOW);
    const dashboardTop5Labels = dashboard.topItems.map((t) => t.label);
    const reportTop5Labels = itemsReport.items.slice(0, 5).map((i) => i.label);
    check("PARITY: Dashboard topItems labels === report's top-5 items", JSON.stringify(dashboardTop5Labels) === JSON.stringify(reportTop5Labels));
    check(
      "PARITY: Dashboard topItems revenue === report's top-5 sales",
      JSON.stringify(dashboard.topItems.map((t) => t.revenue)) === JSON.stringify(itemsReport.items.slice(0, 5).map((i) => i.sales)),
    );
    check("PARITY: categories <= CATEGORY_LIMIT (no folding on either side)", itemsReport.categories.length <= CATEGORY_LIMIT && dashboard.categories.length <= CATEGORY_LIMIT);
    check(
      "PARITY: Dashboard categories === report's categories (key/label/amount/count/share)",
      JSON.stringify(dashboard.categories.map((c) => ({ key: c.key, label: c.label, amount: c.amount, count: c.count, share: c.share }))) ===
        JSON.stringify(itemsReport.categories.map((c) => ({ key: c.key, label: c.label, amount: c.sales, count: c.qty, share: c.share }))),
    );

    // ═══════════════════════════════════════════════════════════════════════
    // PARITY: netSales === buildSalesReport kpis.current.sales; money === same.
    // ═══════════════════════════════════════════════════════════════════════
    const salesReport = await buildSalesReport(RANGE, NOW);
    check(`PARITY: ItemsReport.netSales (${itemsReport.netSales}) === SalesReport kpis.current.sales (${salesReport.kpis.current.sales})`, itemsReport.netSales === salesReport.kpis.current.sales);
    check("PARITY: ItemsReport.money === SalesReport.money", JSON.stringify(itemsReport.money) === JSON.stringify(salesReport.money));

    // ═══════════════════════════════════════════════════════════════════════
    // buildCancelsReport — range 27-29 Sep
    // ═══════════════════════════════════════════════════════════════════════
    const cancelsReport = await buildCancelsReport(RANGE, NOW);
    assertCancels(cancelsReport, dashboard);

    // ═══════════════════════════════════════════════════════════════════════
    // buildGstReport — range 27-29 Sep (+ with bills)
    // ═══════════════════════════════════════════════════════════════════════
    const gstReport = await buildGstReport(RANGE, NOW);
    assertGst(gstReport, salesReport);
    const gstReportWithBills = await buildGstReport(RANGE, NOW, { bills: true });
    check("GST: billRows present with {bills:true}", Array.isArray(gstReportWithBills.billRows) && gstReportWithBills.billRows.length === 15);
    check("GST: billRows ABSENT without {bills:true}", gstReport.billRows === undefined);
    if (gstReportWithBills.billRows) {
      const ats = gstReportWithBills.billRows.map((r) => r.at);
      const sorted = [...ats].sort();
      check("GST: billRows oldest first", JSON.stringify(ats) === JSON.stringify(sorted));
    }
    // S10-D: GST invoice serials (the seed numbers 11 bills of FY 2026-27; runs LAST — it adds one more order).
    assertGstInvoices(check, gstReport, gstReportWithBills);
    await assertCancelledInvoiceOnly(check, RANGE, NOW);
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

function assertItems(r: ItemsReport): void {
  check("Items: range 27-29 Sep", r.range.from === "2026-09-27" && r.range.to === "2026-09-29");

  const byLabel = new Map(r.items.map((i) => [i.label, i]));
  // Tea: O1(10,300)+O5(5,150)+O16(2,60)+O10(10,300)+O14(8,240) = qty35 sales1050. freeQty0.
  check("Items: Tea qty35 sales1050 freeQty0", byLabel.get("Tea")?.qty === 35 && byLabel.get("Tea")?.sales === 1050 && byLabel.get("Tea")?.freeQty === 0);
  // Samosa: O2(20,400)+O6(10,200)+O9(10,200)+O18(3,60) = qty43 sales860 (O15 excluded, Cancelled).
  check("Items: Samosa qty43 sales860", byLabel.get("Samosa")?.qty === 43 && byLabel.get("Samosa")?.sales === 860);
  // Coffee (Large): O4(4,240)+O12(2,120)+O17(2,120) = qty8 sales480.
  check("Items: Coffee (Large) qty8 sales480", byLabel.get("Coffee (Large)")?.qty === 8 && byLabel.get("Coffee (Large)")?.sales === 480);
  // Coffee (no variation, fractional): O8 qty3 sales=49.5*3=148.5 (ITEM_REVENUE_EXPR, unrounded).
  check("Items: Coffee qty3 sales148.5 (fractional, unrounded per-line)", byLabel.get("Coffee")?.qty === 3 && byLabel.get("Coffee")?.sales === 148.5);
  // Burger: O7(1,150)+O11(2,300) = qty3 sales450. Category = Removed items (product deleted).
  check("Items: Burger qty3 sales450, category Removed items", byLabel.get("Burger")?.qty === 3 && byLabel.get("Burger")?.sales === 450 && byLabel.get("Burger")?.categoryName === REMOVED_ITEMS_LABEL);
  // FreeCookie: O9 reward line qty1 sales0 freeQty1. Category = Uncategorised (category deleted).
  check("Items: FreeCookie qty1 sales0 freeQty1, category Uncategorised", byLabel.get("FreeCookie")?.qty === 1 && byLabel.get("FreeCookie")?.sales === 0 && byLabel.get("FreeCookie")?.freeQty === 1 && byLabel.get("FreeCookie")?.categoryName === UNCATEGORISED_LABEL);

  check("Items: 6 distinct item rows", r.items.length === 6);
  const totalSales = 1050 + 860 + 480 + 148.5 + 450 + 0;
  check(`Items: kpis.current.sales === ${totalSales}`, r.kpis.current.sales === totalSales);
  check("Items: kpis.current.qty === 93 (35+43+8+3+3+1)", r.kpis.current.qty === 93);
  // Compare window (24 Sep): O19 Tea qty4 sales120 (ITEM_REVENUE_EXPR, non-reward).
  check("Items: kpis.previous qty4 sales120", r.kpis.previous.qty === 4 && r.kpis.previous.sales === 120);

  // Categories: Drinks (Tea+CoffeeLarge+Coffee) qty46 sales1678.5; Snacks (Samosa only,
  // Burger fell out to Removed items) qty43 sales860; Removed items (Burger) qty3 sales450;
  // Uncategorised (FreeCookie) qty1 sales0.
  const byCat = new Map(r.categories.map((c) => [c.label, c]));
  check("Items: category Drinks items3 qty46 sales1678.5", byCat.get("Drinks")?.items === 3 && byCat.get("Drinks")?.qty === 46 && byCat.get("Drinks")?.sales === 1678.5);
  check("Items: category Snacks items1 qty43 sales860 (Burger excluded)", byCat.get("Snacks")?.items === 1 && byCat.get("Snacks")?.qty === 43 && byCat.get("Snacks")?.sales === 860);
  check("Items: category Removed items items1 qty3 sales450", byCat.get(REMOVED_ITEMS_LABEL)?.items === 1 && byCat.get(REMOVED_ITEMS_LABEL)?.qty === 3 && byCat.get(REMOVED_ITEMS_LABEL)?.sales === 450);
  check("Items: category Uncategorised items1 qty1 sales0", byCat.get(UNCATEGORISED_LABEL)?.items === 1 && byCat.get(UNCATEGORISED_LABEL)?.qty === 1 && byCat.get(UNCATEGORISED_LABEL)?.sales === 0);
  check("Items: 4 category rows", r.categories.length === 4);
  const catSalesSum = r.categories.reduce((s, c) => s + c.sales, 0);
  check(`Items: Σ category sales (${catSalesSum}) === Σ item sales (${totalSales})`, catSalesSum === totalSales);

  // money identity: gross - discount - reward + gst + charges === netSales.
  // gross=3049, discount=46 (O11 40 + O12 6), reward=90 (O9 60 + O10 30), gst=12 (O4 only), charges=35 (O7).
  check("Items: money.gross === 3049", r.money.gross === 3049);
  check("Items: money.discount === 46 (manual 40 + gst-preset 6)", r.money.discount === 46);
  check("Items: money.reward === 90 (reward-line 60 + reward-kind discount 30)", r.money.reward === 90);
  check("Items: money.gst === 12 (O4 exclusive)", r.money.gst === 12);
  check("Items: money.charges === 35 (O7 table+extra)", r.money.charges === 35);
  const netSales = 300 + 400 + 252 + 150 + 200 + 185 + 149 + 200 + 270 + 260 + 114 + 240 + 60 + 120 + 60;
  check(`Items: money identity gross-discount-reward+gst+charges === netSales (${netSales})`, r.money.gross - r.money.discount - r.money.reward + r.money.gst + r.money.charges === netSales);
  check(`Items: netSales === ${netSales}`, r.netSales === netSales);
  check("Items: rewardLines === 60 (only the dish reward LINE, not the reward-kind discount)", r.rewardLines === 60);
}

function assertCancels(
  r: CancelsReport,
  dashboard: { leaks: { cancelled: { count: number; value: number }; voids: { lines: number; qty: number; value: number }; discounts: { orders: number; amount: number }; rewards: { orders: number; amount: number } } },
): void {
  check("Cancels: range 27-29 Sep", r.range.from === "2026-09-27" && r.range.to === "2026-09-29");
  // Compared key-by-key (not JSON.stringify) — CancelsReport and DashboardLeaks
  // declare their keys in a DIFFERENT order (discounts/rewards/cancelled/voids
  // vs cancelled/voids/discounts/rewards), so a string compare would fail on
  // key ORDER alone despite every value agreeing.
  check(
    "Cancels: kpis.current === Dashboard leaks (deep-equal, key order ignored)",
    JSON.stringify(r.kpis.current.discounts) === JSON.stringify(dashboard.leaks.discounts) &&
      JSON.stringify(r.kpis.current.rewards) === JSON.stringify(dashboard.leaks.rewards) &&
      JSON.stringify(r.kpis.current.cancelled) === JSON.stringify(dashboard.leaks.cancelled) &&
      JSON.stringify(r.kpis.current.voids) === JSON.stringify(dashboard.leaks.voids),
  );

  // Hand numbers: discounts (manual O11 40 + gst O12 6) orders2 amount46; rewards
  // (O9 free line 60 + O10 reward-kind 30) orders2 amount90; cancelled (O3 60 + O13 150
  // + O15 100) count3 value310; voids (O14's Tea 2@30=60 + O15's FreeCookie void 0) lines2 qty3 value60.
  check("Cancels: discounts orders2 amount46", r.kpis.current.discounts.orders === 2 && r.kpis.current.discounts.amount === 46);
  check("Cancels: rewards orders2 amount90", r.kpis.current.rewards.orders === 2 && r.kpis.current.rewards.amount === 90);
  check("Cancels: cancelled count3 value310", r.kpis.current.cancelled.count === 3 && r.kpis.current.cancelled.value === 310);
  check("Cancels: voids lines2 qty3 value60", r.kpis.current.voids.lines === 2 && r.kpis.current.voids.qty === 3 && r.kpis.current.voids.value === 60);

  // Previous (compare window, 24 Sep): O20 cancelled count1 value30; nothing else.
  check("Cancels: kpis.previous cancelled count1 value30, rest zero", r.kpis.previous.cancelled.count === 1 && r.kpis.previous.cancelled.value === 30 && r.kpis.previous.discounts.orders === 0 && r.kpis.previous.rewards.orders === 0 && r.kpis.previous.voids.lines === 0);

  // cancelled.rows newest first by `at` (cancelledAt): O15(28T14:20) > O13(28T13:10) > O3(27T12:05).
  check("Cancels: cancelled.rows newest first (O15,O13,O3)", r.cancelled.rows.length === 3 && r.cancelled.rows[0].orderId.includes("void-cancelled") && r.cancelled.rows[1].orderId.includes("afterbilling") && r.cancelled.rows[2].orderId.includes("neverbilled"));
  check("Cancels: O13 row keeps billNumber10, paid150, by empty string, reason untrimmed", r.cancelled.rows[1].billNumber === 10 && r.cancelled.rows[1].paid === 150 && r.cancelled.rows[1].by === "" && r.cancelled.rows[1].reason === " customer left ");
  check("Cancels: O15/O3 rows have NO billNumber (never billed)", r.cancelled.rows[0].billNumber === undefined && r.cancelled.rows[2].billNumber === undefined);
  check("Cancels: cancelled.truncated === false", r.cancelled.truncated === false);

  // removed.rows newest first by void `at`: O15's void (28T14:10) > O14's void (28T13:25).
  check("Cancels: removed.rows newest first (O15-void, O14-void)", r.removed.rows.length === 2 && r.removed.rows[0].item === "FreeCookie" && r.removed.rows[0].value === 0 && r.removed.rows[0].by === "Asha" && r.removed.rows[1].item === "Tea" && r.removed.rows[1].qty === 2 && r.removed.rows[1].value === 60 && r.removed.rows[1].by === "Bina");
  check("Cancels: removed.truncated === false", r.removed.truncated === false);

  // discounts.rows = discountRows ∪ rewardRows, newest first: O12(gst,12:30)>O11(manual,12:15)>O10(reward,12:00)>O9(reward,11:30).
  check("Cancels: discounts.rows count4, newest first (O12,O11,O10,O9)", r.discounts.rows.length === 4 && r.discounts.rows[0].kind === "gst" && r.discounts.rows[0].amount === 6 && r.discounts.rows[1].kind === "manual" && r.discounts.rows[1].amount === 40 && r.discounts.rows[2].kind === "reward" && r.discounts.rows[2].amount === 30 && r.discounts.rows[3].kind === "reward" && r.discounts.rows[3].amount === 60);
  check("Cancels: discounts.rows 'by' === receiver (order taker)", r.discounts.rows[0].by === "Asha" && r.discounts.rows[1].by === "Bina" && r.discounts.rows[2].by === "Chetan" && r.discounts.rows[3].by === "Asha");
  const discSum = r.discounts.rows.filter((d) => d.kind !== "reward").reduce((s, d) => s + d.amount, 0);
  const rewardSum = r.discounts.rows.filter((d) => d.kind === "reward").reduce((s, d) => s + d.amount, 0);
  check(`Cancels: Σ manual+gst amounts (${discSum}) === LeakTotals.discounts.amount (46)`, discSum === 46);
  check(`Cancels: Σ reward-kind amounts (${rewardSum}) === LeakTotals.rewards.amount (90)`, rewardSum === 90);
  check("Cancels: discounts.truncated === false", r.discounts.truncated === false);

  // byStaff (merged across ALL events): Asha cancelled{2,160}(O3+O15) removed{1,0}(O15's void) discounts{1,6}(O12,gst);
  // Bina cancelled{0,0} removed{1,60}(O14's void) discounts{1,40}(O11,manual);
  // "" cancelled{1,150}(O13) removed{0,0} discounts{0,0}.
  const byStaff = new Map(r.byStaff.map((s) => [s.name, s]));
  check("Cancels: byStaff Asha cancelled2/160 removed1/0 discounts1/6", byStaff.get("Asha")?.cancelled.count === 2 && byStaff.get("Asha")?.cancelled.value === 160 && byStaff.get("Asha")?.removed.lines === 1 && byStaff.get("Asha")?.removed.value === 0 && byStaff.get("Asha")?.discounts.orders === 1 && byStaff.get("Asha")?.discounts.amount === 6);
  check("Cancels: byStaff Bina removed1/60 discounts1/40", byStaff.get("Bina")?.removed.lines === 1 && byStaff.get("Bina")?.removed.value === 60 && byStaff.get("Bina")?.discounts.orders === 1 && byStaff.get("Bina")?.discounts.amount === 40);
  check("Cancels: byStaff '' (empty, O13) cancelled1/150 kept as its own row", byStaff.get("")?.cancelled.count === 1 && byStaff.get("")?.cancelled.value === 150);

  // reasons: cancel-kind "customer left" (case/space-insensitive) groups O3+O13+O15 -> count3
  // value=60+150+100=310. remove-kind "wrong order" groups O14's + O15's void -> count2 value=60+0=60.
  const cancelReasonRow = r.reasons.find((x) => x.kind === "cancel");
  const removeReasonRow = r.reasons.find((x) => x.kind === "remove");
  check("Cancels: reasons cancel-kind grouped count3 value310 (case/space-insensitive)", cancelReasonRow?.count === 3 && cancelReasonRow?.value === 310);
  check("Cancels: reasons remove-kind grouped count2 value60 (reward void counts 0)", removeReasonRow?.count === 2 && removeReasonRow?.value === 60);
  check("Cancels: exactly 2 reason rows (one cancel-kind group, one remove-kind group)", r.reasons.length === 2);
}

function assertGst(r: GstReport, salesReport: { kpis: { current: { sales: number } } }): void {
  check("GST: range 27-29 Sep", r.range.from === "2026-09-27" && r.range.to === "2026-09-29");
  // 15 Completed bills; 13 carry rate 5%, 2 (O5,O6) carry no GST.
  check("GST: bills === 15", r.bills === 15);
  check("GST: taxable === 2453", r.taxable === 2453);
  check("GST: gst === 122", r.gst === 122);
  check("GST: noGst === 350 (O5 150 + O6 200)", r.noGst === 350);
  check("GST: noGstBills === 2", r.noGstBills === 2);
  check("GST: charges === 35 (O7)", r.charges === 35);
  const netSales = 2960;
  check(`GST: netSales === ${netSales}`, r.netSales === netSales);
  check(`GST: netSales === SalesReport kpis.current.sales (PARITY, ${salesReport.kpis.current.sales})`, r.netSales === salesReport.kpis.current.sales);
  check("GST: identity taxable+gst+noGst+charges === netSales", r.taxable + r.gst + r.noGst + r.charges === r.netSales);

  // rates: one row (5%), highest first (only rate present).
  check("GST: rates has 1 row at 5%", r.rates.length === 1 && r.rates[0].rate === 5);
  check("GST: rates[0] bills13 taxable2453 gst122 value2575", r.rates[0].bills === 13 && r.rates[0].taxable === 2453 && r.rates[0].gst === 122 && r.rates[0].value === 2575);

  // days: every day present (27,28,29), oldest first.
  check("GST: 3 day rows, oldest first", r.days.length === 3 && r.days[0].date === "2026-09-27" && r.days[1].date === "2026-09-28" && r.days[2].date === "2026-09-29");
  const d27 = r.days[0];
  const d28 = r.days[1];
  const d29 = r.days[2];
  // Day 27: O1(300,taxable286,gst14)+O2(400,taxable381,gst19). bills2, taxable667, gst33, noGst0, charges0, value700.
  check("GST: day27 bills2 taxable667 gst33 value700", d27.bills === 2 && d27.taxable === 667 && d27.gst === 33 && d27.noGst === 0 && d27.value === 700);
  check("GST: day27 docs first1 last2 numbered2 cancelled0 unnumbered0", d27.docs.first === 1 && d27.docs.last === 2 && d27.docs.numbered === 2 && d27.docs.cancelled === 0 && d27.docs.unnumbered === 0);

  // Day 28: O4,O5,O6,O7,O8,O9,O10,O11,O12,O14 Completed (10 bills); O13 Cancelled-after-billing excluded from money.
  // bills=10, taxable=240+0+0+143+142+190+257+248+109+229=1558, gst=12+0+0+7+7+10+13+12+5+11=77,
  // noGst=150+200=350, charges=35, value=252+150+200+185+149+200+270+260+114+240=2020.
  const d28Taxable = 240 + 143 + 142 + 190 + 257 + 248 + 109 + 229;
  const d28Gst = 12 + 7 + 7 + 10 + 13 + 12 + 5 + 11;
  const d28Value = 252 + 150 + 200 + 185 + 149 + 200 + 270 + 260 + 114 + 240;
  check(`GST: day28 bills10 taxable${d28Taxable} gst${d28Gst} noGst350 charges35 value${d28Value}`, d28.bills === 10 && d28.taxable === d28Taxable && d28.gst === d28Gst && d28.noGst === 350 && d28.charges === 35 && d28.value === d28Value);
  check("GST: day28 docs first1 last11 numbered11 cancelled1(O13) unnumbered0", d28.docs.first === 1 && d28.docs.last === 11 && d28.docs.numbered === 11 && d28.docs.cancelled === 1 && d28.docs.unnumbered === 0);

  // Day 29: O16(60,taxable57,gst3)+O17(120,taxable114,gst6)+O18(60,taxable57,gst3, NO billNumber).
  check("GST: day29 bills3 taxable228 gst12 value240", d29.bills === 3 && d29.taxable === 57 + 114 + 57 && d29.gst === 3 + 6 + 3 && d29.value === 60 + 120 + 60);
  check("GST: day29 docs first1 last2 numbered2 cancelled0 unnumbered1 (O18)", d29.docs.first === 1 && d29.docs.last === 2 && d29.docs.numbered === 2 && d29.docs.cancelled === 0 && d29.docs.unnumbered === 1);

  // Range docs totals: numbered=2+11+2=15, cancelled=0+1+0=1, unnumbered=0+0+1=1.
  check("GST: range docs numbered15 cancelled1 unnumbered1", r.docs.numbered === 15 && r.docs.cancelled === 1 && r.docs.unnumbered === 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
