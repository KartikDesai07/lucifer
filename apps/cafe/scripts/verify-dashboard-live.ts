/**
 * Dashboard redesign live leg — proves buildDashboard()/buildDashboardLive()
 * against a REAL MongoDB, which the DB-free unit tests (lib/dashboard/*.test.ts)
 * cannot: that the five real pipelines (performanceFacet, compareFacet,
 * heatPipeline, productQtyPipeline, the dues $group) actually run and return
 * the shapes fold.ts expects, and that Product/Category/Customer/DuePayment/
 * Order/OrderRequest/Reservation reads really agree with each other on one
 * seeded dataset.
 *
 *   npm run verify:dashboard:live            (defaults to a fresh scratch DB)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_dashboard_xxxx npm run verify:dashboard:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops the WHOLE scratch database in a finally block
 * (buildDashboard reads ALL Products/Categories with no scoping filter, so a
 * shared/reused DB would leak other legs' fixtures into every widget here —
 * this leg therefore always runs against its OWN fresh database).
 * (console output is intentional — this is an ops CLI script, not app code.)
 *
 * ── Fixed clock ──────────────────────────────────────────────────────────────
 * NOW = 2026-09-29T09:00:00Z = 14:30 IST, Tuesday 29 Sep 2026.
 *
 * ── Arithmetic ground truth ──────────────────────────────────────────────────
 * Every expected number below is hand-computed from the ENGLISH rule each
 * pipeline/fold documents (never by calling pipelines.ts/fold.ts/build.ts
 * itself): sales/orders/collected are folded over each range's own Completed
 * orders; gross/discount/reward/gst/charges follow lib/money-breakdown.ts's
 * orderMoneyContribution rule and are cross-checked against
 * foldMoneyBreakdown() directly at the bottom of this file, over the exact
 * same seeded Completed-order views — so this leg proves the Mongo pipeline
 * twin agrees with the JS fold twin, on real documents, the same way
 * verify-money-breakdown-live.ts does for the reports route.
 */
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { Category } from "@/models/Category";
import { Customer } from "@/models/Customer";
import { DuePayment } from "@/models/DuePayment";
import { OrderRequest } from "@/models/OrderRequest";
import { Reservation } from "@/models/Reservation";
import { buildDashboard } from "@/lib/dashboard/build";
import { buildDashboardLive } from "@/lib/dashboard/live";
import { channelOf, CHANNEL_EXPR } from "@/lib/dashboard/pipelines";
import { foldMoneyBreakdown, type MoneyOrderView } from "@/lib/money-breakdown";
import { REMOVED_ITEMS_LABEL, UNCATEGORISED_LABEL } from "@/lib/dashboard/fold";
import type { DashboardData, DashboardChannel } from "@/types/dashboard";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}dashboard_${randomUUID().slice(0, 8)}`;
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

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

// An IST wall-clock string ("YYYY-MM-DDTHH:MM:SS", no zone) -> the UTC Date it
// represents (subtract the fixed +05:30 offset), matching cafeDateString's own
// fixed-offset math (packages/shared/src/utils.ts) — never Intl/timezone APIs.
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
    console.log(`\nDashboard live leg — seeding against ${dbName}\n`);

    // ── Categories ─────────────────────────────────────────────────────────
    const catBeverages = await Category.create({ name: "Beverages", order: 1 });
    const catSnacks = await Category.create({ name: "Snacks", order: 2 });
    const catMains = await Category.create({ name: "Mains", order: 3 });
    const catToDelete = await Category.create({ name: "Doomed Category", order: 4 });

    // ── Products ───────────────────────────────────────────────────────────
    // Every candidate/non-candidate product is created BEFORE the insight
    // window start (2026-09-01T18:30:00Z) except NewProduct, which is
    // created AFTER it on purpose.
    const OLD_CREATED_AT = ist("2026-08-01T00:00:00");
    const mkProduct = (over: Record<string, unknown>) =>
      Product.create({ discount: 0, isActive: true, available: true, modifiers: [], createdAt: OLD_CREATED_AT, ...over });

    const pTea = await mkProduct({ name: "Tea", categoryId: catBeverages._id, price: 30 });
    const pCoffee = await mkProduct({ name: "Coffee", categoryId: catBeverages._id, price: 40 });
    const pSamosa = await mkProduct({ name: "Samosa", categoryId: catSnacks._id, price: 20 });
    const pSandwich = await mkProduct({ name: "Sandwich", categoryId: catSnacks._id, price: 70 });
    const pPizza = await mkProduct({ name: "Pizza", categoryId: catMains._id, price: 300 });
    const pBurger = await mkProduct({ name: "Burger", categoryId: catMains._id, price: 150 });
    const pRewardDish = await mkProduct({ name: "RewardDish", categoryId: catMains._id, price: 60 });
    const pGhostDish = await mkProduct({ name: "GhostDish", categoryId: catMains._id, price: 100 });
    const pOldCatDish = await mkProduct({ name: "OldCatDish", categoryId: catToDelete._id, price: 100 });
    const pNeverSold = await mkProduct({ name: "NeverSold", categoryId: catMains._id, price: 90 });
    const pNewProduct = await mkProduct({
      name: "NewProduct",
      categoryId: catMains._id,
      price: 90,
      createdAt: NOW, // created exactly at `now` -- inside the insight window, not before it
    });
    const pUnavailable = await mkProduct({ name: "UnavailDish", categoryId: catMains._id, price: 90, available: false });
    const pInactive = await mkProduct({ name: "InactiveDish", categoryId: catMains._id, price: 90, isActive: false });

    // Delete GhostDish's PRODUCT (sold once, then removed -> "Removed items")
    // and catToDelete's CATEGORY (OldCatDish's product survives -> "Uncategorised").
    // Deleted AFTER the orders below reference their ids, exactly like a real
    // "sold once, then deleted" timeline.

    // ── Orders ─────────────────────────────────────────────────────────────
    // Every Completed order's items[] sums to its own subtotal exactly, so
    // gross/discount/reward/gst/charges are all independently checkable via
    // orderMoneyContribution's documented identity.
    const orderId = (label: string) => `SCRATCH-DASH-${randomUUID().slice(0, 8)}-${label}`;
    const item = (p: { _id: unknown; name: string; price: number }, qty: number, reward = false) => ({
      productId: p._id,
      name: p.name,
      price: p.price,
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

    // ---- Today (29 Sep IST) ----
    const T01 = baseOrder({ createdAt: ist("2026-09-29T10:00:00"), items: [item(pTea, 10)], subtotal: 300, total: 300, paidAmount: 300, payment: "Cash" });
    const T02 = baseOrder({ createdAt: ist("2026-09-29T10:30:00"), items: [item(pCoffee, 10)], subtotal: 400, total: 400, paidAmount: 400, payment: "Online" });
    const T03 = baseOrder({ createdAt: ist("2026-09-29T11:00:00"), items: [item(pSamosa, 15)], subtotal: 300, total: 300, paidAmount: 300, payment: "Split" });
    const T04 = baseOrder({ createdAt: ist("2026-09-29T11:30:00"), items: [item(pSandwich, 10)], subtotal: 700, total: 700, paidAmount: 0, payment: "Due" });
    const T05 = baseOrder({ createdAt: ist("2026-09-29T12:00:00"), items: [item(pPizza, 2)], subtotal: 600, total: 600, paidAmount: 600, payment: "Credit" });
    const T06 = baseOrder({ createdAt: ist("2026-09-29T12:15:00"), items: [item(pBurger, 4)], subtotal: 600, gstAmount: 30, gstMode: "exclusive", total: 630, paidAmount: 630, payment: "Cash" });
    const T07 = baseOrder({ createdAt: ist("2026-09-29T12:30:00"), items: [item(pPizza, 1)], subtotal: 300, chargeAmount: 20, chargeLabel: "Rooftop charge", total: 320, paidAmount: 320, payment: "Cash", tableNo: "T-1" });
    const T08 = baseOrder({ createdAt: ist("2026-09-29T12:45:00"), items: [item(pBurger, 4)], subtotal: 600, discount: 50, total: 550, paidAmount: 550, payment: "Online" });
    const T09 = baseOrder({ createdAt: ist("2026-09-29T13:00:00"), items: [item(pSandwich, 10)], subtotal: 700, discount: 70, discountKind: "reward", total: 630, paidAmount: 630, payment: "Cash" });
    const T10 = baseOrder({
      createdAt: ist("2026-09-29T13:15:00"),
      items: [item(pSamosa, 10), item(pRewardDish, 1, true)],
      subtotal: 200,
      total: 200,
      paidAmount: 200,
      payment: "Cash",
    });
    const T11 = baseOrder({ createdAt: ist("2026-09-29T09:15:00"), items: [item(pTea, 5)], subtotal: 150, total: 150, paidAmount: 150, payment: "Online", source: "qr" });
    const T12 = baseOrder({ createdAt: ist("2026-09-29T09:30:00"), items: [item(pCoffee, 5)], subtotal: 200, total: 200, paidAmount: 200, payment: "Cash", parcel: true });
    const T13 = baseOrder({ createdAt: ist("2026-09-29T00:10:00"), items: [item(pTea, 2)], subtotal: 60, total: 60, paidAmount: 60, payment: "Cash" });
    // T14: LATER today than `now` (20:00 IST) -- must be excluded from the
    // Today range's current window (clipped at `now`), proving the clip.
    const T14 = baseOrder({ createdAt: ist("2026-09-29T20:00:00"), items: [item(pPizza, 100)], subtotal: 30000, total: 30000, paidAmount: 30000, payment: "Cash" });
    const T15 = baseOrder({ createdAt: ist("2026-09-29T10:15:00"), items: [item(pPizza, 1)], subtotal: 300, total: 300, paidAmount: 0, payment: "Unpaid", status: "Cancelled", cancelReason: "test", cancelledBy: "Verifier", cancelledAt: ist("2026-09-29T10:20:00") });
    const T16 = baseOrder({
      createdAt: ist("2026-09-29T10:45:00"),
      items: [item(pGhostDish, 10)],
      subtotal: 1000,
      total: 1000,
      paidAmount: 1000,
      payment: "Cash",
      voids: [
        { productId: pBurger._id, name: pBurger.name, price: 50, qty: 2, kotRound: 1, reason: "test", voidedBy: "Verifier", at: ist("2026-09-29T10:50:00") },
        { productId: pRewardDish._id, name: pRewardDish.name, price: 80, qty: 1, kotRound: 1, reward: true, reason: "test", voidedBy: "Verifier", at: ist("2026-09-29T10:51:00") },
      ],
    });
    const T17 = baseOrder({ createdAt: ist("2026-09-29T11:45:00"), items: [item(pTea, 5)], subtotal: 150, total: 150, paidAmount: 0, payment: "Unpaid", status: "Pending" });
    const T18 = baseOrder({ createdAt: ist("2026-09-29T13:50:00"), items: [item(pOldCatDish, 3)], subtotal: 300, total: 300, paidAmount: 300, payment: "Cash" });

    // ---- Yesterday (28 Sep IST) ----
    const Y01 = baseOrder({ createdAt: ist("2026-09-28T10:00:00"), items: [item(pTea, 10)], subtotal: 300, total: 300, paidAmount: 300, payment: "Cash" });
    const Y02 = baseOrder({ createdAt: ist("2026-09-28T15:00:00"), items: [item(pCoffee, 5)], subtotal: 200, total: 200, paidAmount: 200, payment: "Online" });
    const Y03 = baseOrder({ createdAt: ist("2026-09-28T23:50:00"), items: [item(pSamosa, 5)], subtotal: 100, total: 100, paidAmount: 100, payment: "Cash" });

    // ---- 21 Sep (yesterday's own comparison day, shift 7) ----
    const P01 = baseOrder({ createdAt: ist("2026-09-21T10:00:00"), items: [item(pTea, 4)], subtotal: 120, total: 120, paidAmount: 120, payment: "Cash" });

    // ---- 22 Sep -- same weekday last week as Today, before AND after 14:30 IST ----
    const W01 = baseOrder({ createdAt: ist("2026-09-22T10:00:00"), items: [item(pTea, 10)], subtotal: 300, total: 300, paidAmount: 300, payment: "Cash" });
    const W02 = baseOrder({ createdAt: ist("2026-09-22T20:00:00"), items: [item(pPizza, 1)], subtotal: 300, total: 300, paidAmount: 300, payment: "Online" });

    // ---- 26/27 Sep -- the 2-day range's (28->29, shift 2) comparison period ----
    const C01 = baseOrder({ createdAt: ist("2026-09-26T10:00:00"), items: [item(pCoffee, 5)], subtotal: 200, total: 200, paidAmount: 200, payment: "Cash" });
    const C02 = baseOrder({ createdAt: ist("2026-09-27T10:00:00"), items: [item(pTea, 3)], subtotal: 90, total: 90, paidAmount: 90, payment: "Online" });
    const C03 = baseOrder({ createdAt: ist("2026-09-27T15:00:00"), items: [item(pPizza, 1)], subtotal: 300, total: 300, paidAmount: 300, payment: "Credit" });

    // ---- dedicated OLDER days inside the 28-day insight window (busy hours / slow movers) ----
    const OLD07 = baseOrder({ createdAt: ist("2026-09-07T09:00:00"), items: [item(pTea, 4)], subtotal: 120, total: 120, paidAmount: 120, payment: "Cash" });
    const OLD14 = baseOrder({ createdAt: ist("2026-09-14T09:00:00"), items: [item(pCoffee, 6)], subtotal: 240, total: 240, paidAmount: 240, payment: "Cash" });

    const allOrders = [
      T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17, T18,
      Y01, Y02, Y03, P01, W01, W02, C01, C02, C03, OLD07, OLD14,
    ];
    await Order.insertMany(allOrders);

    // Products referenced above are now deleted / category-removed, AFTER the
    // orders exist -- the sold-once-then-removed timeline the fold rule targets.
    await Product.deleteOne({ _id: pGhostDish._id });
    await Category.deleteOne({ _id: catToDelete._id });

    // ── DuePayment ─────────────────────────────────────────────────────────
    const duesCustomer = await Customer.create({ name: "Dues Customer", mobile: "9990000001", totalDue: 500 });
    await DuePayment.create({ customerId: duesCustomer._id, amount: 150, mode: "Cash", receivedBy: "Verifier", clientRef: randomUUID(), createdAt: ist("2026-09-29T10:00:00") });
    await DuePayment.create({ customerId: duesCustomer._id, amount: 999, mode: "Cash", receivedBy: "Verifier", clientRef: randomUUID(), createdAt: ist("2026-09-29T10:05:00"), deletedAt: ist("2026-09-29T10:06:00"), deletedBy: "Verifier", deleteNote: "test soft delete" });
    await DuePayment.create({ customerId: duesCustomer._id, amount: 80, mode: "Online", receivedBy: "Verifier", clientRef: randomUUID(), createdAt: ist("2026-09-28T12:00:00") });

    // ── OrderRequest ───────────────────────────────────────────────────────
    const reqItem = { productId: pTea._id, name: pTea.name, price: pTea.price, qty: 1, modifiers: [], instructions: "" };
    await OrderRequest.create({ shortCode: randomUUID().slice(0, 8), status: "pending", targetKind: "parcel", items: [reqItem], quotedSubtotal: 30, quotedCharge: 0, quotedTotal: 30, mobile: "9990000002", name: "Pending Diner" });
    await OrderRequest.create({ shortCode: randomUUID().slice(0, 8), status: "accepted", targetKind: "parcel", items: [reqItem], quotedSubtotal: 30, quotedCharge: 0, quotedTotal: 30, mobile: "9990000003", name: "Accepted Diner", acceptedOrderId: "SCRATCH-IGNORED", acceptedAt: NOW, actor: "Verifier" });

    // ── Customers (dues strip) ────────────────────────────────────────────
    await Customer.create({ name: "Second Due Customer", mobile: "9990000004", totalDue: 300 });
    await Customer.create({ name: "Settled Customer", mobile: "9990000005", totalDue: 0 });

    // ── open tabs (buildDashboardLive) ───────────────────────────────────
    // T17 above is one open tab (today, 150). A second, 3 days ago -- open
    // tabs are point-in-time, never range-bound.
    const openTabOld = baseOrder({ createdAt: ist("2026-09-26T12:00:00"), items: [item(pTea, 3)], subtotal: 90, total: 90, paidAmount: 0, payment: "Unpaid", status: "Pending" });
    await Order.create(openTabOld);

    // ── Reservations ───────────────────────────────────────────────────────
    await Reservation.create({ name: "Booked Today", mobile: "9990000006", date: "2026-09-29", time: "19:00", guests: 2, status: "Booked" });
    await Reservation.create({ name: "Seated Today", mobile: "9990000007", date: "2026-09-29", time: "13:00", guests: 4, status: "Seated" });
    await Reservation.create({ name: "Booked Tomorrow", mobile: "9990000008", date: "2026-09-30", time: "19:00", guests: 2, status: "Booked" });

    console.log(`Seeded ${allOrders.length + 1} orders, ${13} products, 4 categories, dues/requests/customers/reservations.\n`);

    // ═══════════════════════════════════════════════════════════════════════
    // channelOf() JS twin vs CHANNEL_EXPR $switch — every seeded order agrees
    // ═══════════════════════════════════════════════════════════════════════
    const channelRows = await Order.aggregate<{ orderId: string; c: DashboardChannel }>([
      { $match: { orderId: { $in: allOrders.map((o) => o.orderId as string) } } },
      { $project: { orderId: 1, c: CHANNEL_EXPR } },
    ]);
    check("CHANNEL_EXPR twin returned one row per seeded order", channelRows.length === allOrders.length);
    const channelById = new Map(channelRows.map((r) => [r.orderId, r.c]));
    for (const o of allOrders) {
      const jsChannel = channelOf(o as { source?: string; parcel?: boolean; tableNo?: string });
      check(`channelOf(${o.orderId}) === CHANNEL_EXPR (${jsChannel})`, channelById.get(o.orderId as string) === jsChannel);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // buildDashboard — Today (29 -> 29)
    // ═══════════════════════════════════════════════════════════════════════
    const today = await buildDashboard({ from: "2026-09-29", to: "2026-09-29" }, NOW);
    assertToday(today);

    // ═══════════════════════════════════════════════════════════════════════
    // buildDashboard — Yesterday (28 -> 28)
    // ═══════════════════════════════════════════════════════════════════════
    const yesterday = await buildDashboard({ from: "2026-09-28", to: "2026-09-28" }, NOW);
    assertYesterday(yesterday);

    // ═══════════════════════════════════════════════════════════════════════
    // buildDashboard — 2-day range (28 -> 29)
    // ═══════════════════════════════════════════════════════════════════════
    const twoDay = await buildDashboard({ from: "2026-09-28", to: "2026-09-29" }, NOW);
    assertTwoDay(twoDay);

    // ═══════════════════════════════════════════════════════════════════════
    // money cross-check: pipeline twin (buildDashboard.money) === JS fold
    // twin (foldMoneyBreakdown), over the SAME seeded Completed orders.
    // ═══════════════════════════════════════════════════════════════════════
    const toMoneyView = (o: OrderDoc): MoneyOrderView => ({
      subtotal: o.subtotal as number,
      discount: o.discount as number | undefined,
      discountKind: o.discountKind as "gst" | "reward" | undefined,
      gstAmount: o.gstAmount as number | undefined,
      chargeAmount: o.chargeAmount as number | undefined,
      items: (o.items as Array<{ price: number; qty: number; reward?: boolean }>) ?? [],
    });
    const todayCompleted = [T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T16, T18].map(toMoneyView);
    const expectedTodayMoney = foldMoneyBreakdown(todayCompleted);
    for (const key of ["gross", "discount", "reward", "gst", "charges"] as const) {
      check(
        `Today: buildDashboard.money.${key} (${today.money[key]}) === foldMoneyBreakdown twin (${expectedTodayMoney[key]})`,
        today.money[key] === expectedTodayMoney[key],
      );
    }
    const yesterdayCompleted = [Y01, Y02, Y03].map(toMoneyView);
    const expectedYesterdayMoney = foldMoneyBreakdown(yesterdayCompleted);
    for (const key of ["gross", "discount", "reward", "gst", "charges"] as const) {
      check(
        `Yesterday: buildDashboard.money.${key} (${yesterday.money[key]}) === foldMoneyBreakdown twin (${expectedYesterdayMoney[key]})`,
        yesterday.money[key] === expectedYesterdayMoney[key],
      );
    }
    const twoDayCompleted = [...todayCompleted, ...yesterdayCompleted];
    const expectedTwoDayMoney = foldMoneyBreakdown(twoDayCompleted);
    for (const key of ["gross", "discount", "reward", "gst", "charges"] as const) {
      check(
        `2-day: buildDashboard.money.${key} (${twoDay.money[key]}) === foldMoneyBreakdown twin (${expectedTwoDayMoney[key]})`,
        twoDay.money[key] === expectedTwoDayMoney[key],
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // buildDashboardLive
    // ═══════════════════════════════════════════════════════════════════════
    const live = await buildDashboardLive(NOW);
    check("live.openTabs.count === 2 (T17 today + the 3-day-old tab)", live.openTabs.count === 2);
    check("live.openTabs.value === 150 + 90 === 240", live.openTabs.value === 240);
    check("live.pendingRequests === 1 (only the 'pending' request counts)", live.pendingRequests === 1);
    check("live.dues.total === 500 + 300 === 800", live.dues.total === 800);
    check("live.dues.customers === 2 (the zero-due customer excluded)", live.dues.customers === 2);
    check("live.unavailable.count === 1 (isActive:true, available:false only)", live.unavailable.count === 1);
    check(
      "live.unavailable.names includes UnavailDish, not InactiveDish",
      live.unavailable.names.includes("UnavailDish") && !live.unavailable.names.includes("InactiveDish"),
    );
    check("live.bookingsToday === 1 (Booked today only; Seated/tomorrow excluded)", live.bookingsToday === 1);
    void pUnavailable;
    void pInactive;
    void pNewProduct;
    void pNeverSold;
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

// ── Assertion blocks (kept out of main() only for readability) ─────────────

function assertToday(d: DashboardData): void {
  check("Today: range", d.range.from === "2026-09-29" && d.range.to === "2026-09-29");
  check("Today: mode === hour", d.mode === "hour");
  check("Today: compare range === 22 Sep -> 22 Sep", d.compare.from === "2026-09-22" && d.compare.to === "2026-09-22");
  check('Today: compare.label === "vs Tue, 22 Sep"', d.compare.label === "vs Tue, 22 Sep");

  // KPIs current: 15 Completed orders (T01..T13,T16,T18; T14 clipped, T15
  // cancelled, T17 pending) -- sales 6340, collected 5640, avg 6340/15.
  check("Today: kpis.current.orders === 15", d.kpis.current.orders === 15);
  check("Today: kpis.current.sales === 6340", d.kpis.current.sales === 6340);
  check("Today: kpis.current.collected === 5640", d.kpis.current.collected === 5640);
  check(
    "Today: kpis.current.averageOrder === 6340/15",
    closeEnough(d.kpis.current.averageOrder, 6340 / 15),
  );

  // KPIs previous (compare window = 22 Sep 04:30Z..09:00Z -> only W01 (before
  // the cutoff) counts; W02 at 14:30Z is after it).
  check("Today: kpis.previous.orders === 1 (only W01, before the elapsed-time cutoff)", d.kpis.previous.orders === 1);
  check("Today: kpis.previous.sales === 300", d.kpis.previous.sales === 300);
  check("Today: kpis.previous.collected === 300", d.kpis.previous.collected === 300);
  check("Today: kpis.previous.averageOrder === 300", d.kpis.previous.averageOrder === 300);

  // Series (hour mode): spot-check a few hours; W02 (20:00 IST=hour 20) must
  // appear in the COMPARE series even though it's excluded from kpis.previous.
  const byKey = new Map(d.series.map((p) => [p.key, p]));
  check("Today series: hour 9 sales === 150 (T11 qr) + 200 (T12 parcel) = 350", byKey.get("9")?.sales === 350);
  check("Today series: hour 20 exists as a zero-filled current point (T14 clipped out)", byKey.get("20")?.sales === 0);
  check("Today series: hour 20's compareSales === 300 (W02, full-day compare series, not clipped)", byKey.get("20")?.compareSales === 300);
  check("Today series: hour 0 sales === 60 (T13, 00:10 IST)", byKey.get("0")?.sales === 60);

  // Payments.
  const pay = new Map(d.payments.map((p) => [p.key, p]));
  check("Today payments: Cash amount === 3640, count 9", pay.get("Cash")?.amount === 3640 && pay.get("Cash")?.count === 9);
  check("Today payments: Online amount === 1100, count 3", pay.get("Online")?.amount === 1100 && pay.get("Online")?.count === 3);
  check("Today payments: Split amount === 300, count 1", pay.get("Split")?.amount === 300 && pay.get("Split")?.count === 1);
  check("Today payments: Due amount === 0, count 1 (kept: count > 0)", pay.get("Due")?.amount === 0 && pay.get("Due")?.count === 1);
  check("Today payments: Credit amount === 600, count 1", pay.get("Credit")?.amount === 600 && pay.get("Credit")?.count === 1);
  const paySum = d.payments.reduce((s, p) => s + p.share, 0);
  check("Today payments: shares sum to 1", closeEnough(paySum, 1));

  // topItems (top 5 by revenue desc): Sandwich1400, Burger1200, GhostDish1000, Pizza900, Coffee600.
  check(
    "Today topItems order",
    JSON.stringify(d.topItems.map((i) => i.label)) === JSON.stringify(["Sandwich", "Burger", "GhostDish", "Pizza", "Coffee"]),
  );
  check("Today topItems[0] Sandwich revenue 1400 qty 20", d.topItems[0].revenue === 1400 && d.topItems[0].qty === 20);

  // slowItems: NeverSold(0), RewardDish(1), OldCatDish(3), Pizza(5), Burger(8).
  check(
    "Today slowItems order",
    JSON.stringify(d.slowItems.map((i) => i.name)) === JSON.stringify(["NeverSold", "RewardDish", "OldCatDish", "Pizza", "Burger"]),
  );
  check("Today slowItems qtys", JSON.stringify(d.slowItems.map((i) => i.qty)) === JSON.stringify([0, 1, 3, 5, 8]));

  // categories: c1(Bev)=1110, c2(Snacks)=1900, c3(Mains)=2100, Removed=1000, Uncategorised=300.
  const cat = new Map(d.categories.map((c) => [c.label, c]));
  check("Today categories: Beverages amount 1110", cat.get("Beverages")?.amount === 1110);
  check("Today categories: Snacks amount 1900", cat.get("Snacks")?.amount === 1900);
  check("Today categories: Mains amount 2100", cat.get("Mains")?.amount === 2100);
  check(`Today categories: "${REMOVED_ITEMS_LABEL}" amount 1000 (GhostDish, product deleted)`, cat.get(REMOVED_ITEMS_LABEL)?.amount === 1000);
  check(`Today categories: "${UNCATEGORISED_LABEL}" amount 300 (OldCatDish, category deleted)`, cat.get(UNCATEGORISED_LABEL)?.amount === 300);
  check("Today categories: only 5 buckets (<= CATEGORY_LIMIT, no Other fold needed)", d.categories.length === 5);

  // channels.
  const chan = new Map(d.channels.map((c) => [c.key, c]));
  check("Today channels: dine-in amount 320 count 1", chan.get("dine-in")?.amount === 320 && chan.get("dine-in")?.count === 1);
  check("Today channels: takeaway amount 200 count 1", chan.get("takeaway")?.amount === 200 && chan.get("takeaway")?.count === 1);
  check("Today channels: qr amount 150 count 1", chan.get("qr")?.amount === 150 && chan.get("qr")?.count === 1);
  check("Today channels: counter amount 5670 count 12", chan.get("counter")?.amount === 5670 && chan.get("counter")?.count === 12);

  // heat: insight = 2 Sep -> 29 Sep (clipped at now), from/to labels + a few hand-verified cells + max.
  check("Today heat.from === 2026-09-02", d.heat.from === "2026-09-02");
  check("Today heat.to === 2026-09-29", d.heat.to === "2026-09-29");
  check("Today heat.hours spans 0..23 (a scattered edge-case order sits at both ends)", d.heat.hours[0] === 0 && d.heat.hours[d.heat.hours.length - 1] === 23);
  check("Today heat.max === 1", d.heat.max === 1);
  // Monday (index 0) hour 10 (2 Mondays' worth of orders: T-orders don't
  // land on a Monday in the current design except via OLD07/OLD14/P01 -- spot
  // one deliberately engineered cell instead: Tuesday (index 1) hour 12 has 4
  // orders (T05,T06,T07,T08 all fall in hour 12 IST) over 4 Tuesdays = 1.0.
  const tueIdx = 1;
  const hourIdx12 = d.heat.hours.indexOf(12);
  check("Today heat.avg[Tue][12] === 1 (4 orders / 4 Tuesdays in the insight window)", d.heat.avg[tueIdx][hourIdx12] === 1);

  // leaks.
  check("Today leaks.cancelled === {count:1, value:300}", d.leaks.cancelled.count === 1 && d.leaks.cancelled.value === 300);
  check("Today leaks.voids === {lines:2, qty:3, value:100}", d.leaks.voids.lines === 2 && d.leaks.voids.qty === 3 && d.leaks.voids.value === 100);
  check("Today leaks.discounts === {orders:1, amount:50}", d.leaks.discounts.orders === 1 && d.leaks.discounts.amount === 50);
  check("Today leaks.rewards === {orders:2, amount:130}", d.leaks.rewards.orders === 2 && d.leaks.rewards.amount === 130);

  // money (pipeline side, cross-checked against foldMoneyBreakdown separately in main()).
  check("Today money.gross === 6470", d.money.gross === 6470);
  check("Today money.discount === 50", d.money.discount === 50);
  check("Today money.reward === 130", d.money.reward === 130);
  check("Today money.gst === 30", d.money.gst === 30);
  check("Today money.charges === 20", d.money.charges === 20);
  check(
    "Today money identity: gross - discount - reward + gst + charges === kpis.current.sales",
    d.money.gross - d.money.discount - d.money.reward + d.money.gst + d.money.charges === d.kpis.current.sales,
  );

  check("Today duesCollected === 150", d.duesCollected === 150);
}

function assertYesterday(d: DashboardData): void {
  check("Yesterday: range", d.range.from === "2026-09-28" && d.range.to === "2026-09-28");
  check("Yesterday: mode === hour", d.mode === "hour");
  check("Yesterday: compare range === 21 Sep -> 21 Sep", d.compare.from === "2026-09-21" && d.compare.to === "2026-09-21");

  check("Yesterday: kpis.current.orders === 3", d.kpis.current.orders === 3);
  check("Yesterday: kpis.current.sales === 600", d.kpis.current.sales === 600);
  check("Yesterday: kpis.current.collected === 600", d.kpis.current.collected === 600);
  check("Yesterday: kpis.current.averageOrder === 200", d.kpis.current.averageOrder === 200);

  // Not clipped (a past day) -- compare window is the FULL 21 Sep day, P01 fully in it.
  check("Yesterday: kpis.previous.orders === 1 (P01)", d.kpis.previous.orders === 1);
  check("Yesterday: kpis.previous.sales === 120", d.kpis.previous.sales === 120);

  const byKey = new Map(d.series.map((p) => [p.key, p]));
  check("Yesterday series: hour 23 sales === 100 (Y03, 23:50 IST)", byKey.get("23")?.sales === 100);
  check("Yesterday series: hour 10 sales === 300 (Y01)", byKey.get("10")?.sales === 300);

  const pay = new Map(d.payments.map((p) => [p.key, p]));
  check("Yesterday payments: Cash amount 400 count 2", pay.get("Cash")?.amount === 400 && pay.get("Cash")?.count === 2);
  check("Yesterday payments: Online amount 200 count 1", pay.get("Online")?.amount === 200 && pay.get("Online")?.count === 1);

  check(
    "Yesterday topItems order",
    JSON.stringify(d.topItems.map((i) => i.label)) === JSON.stringify(["Tea", "Coffee", "Samosa"]),
  );

  // slowItems: Burger/NeverSold/OldCatDish/RewardDish/Sandwich all 0, name order.
  check(
    "Yesterday slowItems (all zero, alphabetical)",
    JSON.stringify(d.slowItems.map((i) => i.name)) === JSON.stringify(["Burger", "NeverSold", "OldCatDish", "RewardDish", "Sandwich"]),
  );
  check("Yesterday slowItems all qty 0", d.slowItems.every((i) => i.qty === 0));

  const cat = new Map(d.categories.map((c) => [c.label, c]));
  check("Yesterday categories: Beverages amount 500 (Tea 300 + Coffee 200)", cat.get("Beverages")?.amount === 500);
  check("Yesterday categories: Snacks amount 100 (Samosa)", cat.get("Snacks")?.amount === 100);
  check("Yesterday categories: only 2 buckets", d.categories.length === 2);

  const chan = new Map(d.channels.map((c) => [c.key, c]));
  check("Yesterday channels: counter only, amount 600 count 3", chan.get("counter")?.amount === 600 && chan.get("counter")?.count === 3 && d.channels.length === 1);

  check("Yesterday heat.from === 2026-09-01", d.heat.from === "2026-09-01");
  check("Yesterday heat.to === 2026-09-28", d.heat.to === "2026-09-28");
  check("Yesterday heat.max === 0.5", d.heat.max === 0.5);
  const monIdx = 0;
  const hourIdx9 = d.heat.hours.indexOf(9);
  // OLD07 (7 Sep) and OLD14 (14 Sep) are both Mondays at 09:00 IST; the
  // window's 4 Mondays are 7/14/21/28 Sep -> 2 orders / 4 Mondays = 0.5.
  check("Yesterday heat.avg[Mon][9] === 0.5 (OLD07 + OLD14, 2 orders / 4 Mondays)", d.heat.avg[monIdx][hourIdx9] === 0.5);

  check("Yesterday leaks.cancelled === {count:0, value:0}", d.leaks.cancelled.count === 0 && d.leaks.cancelled.value === 0);
  check("Yesterday leaks.voids === {lines:0, qty:0, value:0}", d.leaks.voids.lines === 0 && d.leaks.voids.qty === 0 && d.leaks.voids.value === 0);
  check("Yesterday leaks.discounts === {orders:0, amount:0}", d.leaks.discounts.orders === 0 && d.leaks.discounts.amount === 0);
  check("Yesterday leaks.rewards === {orders:0, amount:0}", d.leaks.rewards.orders === 0 && d.leaks.rewards.amount === 0);

  check("Yesterday money === EMPTY except gross === sales (no discount/reward/gst/charge seeded)", d.money.gross === 600 && d.money.discount === 0 && d.money.reward === 0 && d.money.gst === 0 && d.money.charges === 0);

  check("Yesterday duesCollected === 80", d.duesCollected === 80);
}

function assertTwoDay(d: DashboardData): void {
  check("2-day: range", d.range.from === "2026-09-28" && d.range.to === "2026-09-29");
  check("2-day: mode === day", d.mode === "day");
  check("2-day: compare range === 26 Sep -> 27 Sep", d.compare.from === "2026-09-26" && d.compare.to === "2026-09-27");
  check('2-day: compare.label === "vs previous 2 days"', d.compare.label === "vs previous 2 days");

  check("2-day: kpis.current.orders === 18 (3 yesterday + 15 today)", d.kpis.current.orders === 18);
  check("2-day: kpis.current.sales === 6940 (600 + 6340)", d.kpis.current.sales === 6940);
  check("2-day: kpis.current.collected === 6240 (600 + 5640)", d.kpis.current.collected === 6240);

  // compare window end = now - 2 days = 2026-09-27T09:00:00Z -> C01(26 Sep) + C02(27 Sep 04:30Z) count; C03(27 Sep 09:30Z) excluded.
  check("2-day: kpis.previous.orders === 2 (C01 + C02; C03 after the cutoff)", d.kpis.previous.orders === 2);
  check("2-day: kpis.previous.sales === 290 (200 + 90)", d.kpis.previous.sales === 290);

  const byKey = new Map(d.series.map((p) => [p.key, p]));
  check("2-day series: 2026-09-28 sales === 600", byKey.get("2026-09-28")?.sales === 600);
  check("2-day series: 2026-09-29 sales === 6340", byKey.get("2026-09-29")?.sales === 6340);
  check("2-day series: 2026-09-28 compares against 2026-09-26 (shift 2), compareSales === 200", byKey.get("2026-09-28")?.compareSales === 200 && byKey.get("2026-09-28")?.compareLabel === "26 Sep");
  check(
    "2-day series: 2026-09-29 compares against 2026-09-27 (shift 2), compareSales === 90 + 300 === 390 (full-day compare series, both C02 and C03)",
    byKey.get("2026-09-29")?.compareSales === 390 && byKey.get("2026-09-29")?.compareLabel === "27 Sep",
  );

  const pay = new Map(d.payments.map((p) => [p.key, p]));
  check("2-day payments: Cash amount 4040 count 11 (400 + 3640, 2 + 9)", pay.get("Cash")?.amount === 4040 && pay.get("Cash")?.count === 11);
  check("2-day payments: Online amount 1300 count 4 (200 + 1100, 1 + 3)", pay.get("Online")?.amount === 1300 && pay.get("Online")?.count === 4);

  check(
    "2-day topItems order",
    JSON.stringify(d.topItems.map((i) => i.label)) === JSON.stringify(["Sandwich", "Burger", "GhostDish", "Pizza", "Tea"]),
  );
  check("2-day topItems[4] Tea revenue 810 (510 today + 300 yesterday)", d.topItems[4].label === "Tea" && d.topItems[4].revenue === 810);

  const cat = new Map(d.categories.map((c) => [c.label, c]));
  check("2-day categories: Beverages amount 1610 (1110 + 500)", cat.get("Beverages")?.amount === 1610);
  check("2-day categories: Snacks amount 2000 (1900 + 100)", cat.get("Snacks")?.amount === 2000);
  check("2-day categories: Mains amount 2100 (unchanged, no Mains items yesterday)", cat.get("Mains")?.amount === 2100);
  check(`2-day categories: "${REMOVED_ITEMS_LABEL}" amount 1000`, cat.get(REMOVED_ITEMS_LABEL)?.amount === 1000);
  check(`2-day categories: "${UNCATEGORISED_LABEL}" amount 300`, cat.get(UNCATEGORISED_LABEL)?.amount === 300);

  const chan = new Map(d.channels.map((c) => [c.key, c]));
  check("2-day channels: counter amount 6270 count 15 (5670 + 600, 12 + 3)", chan.get("counter")?.amount === 6270 && chan.get("counter")?.count === 15);
  check("2-day channels: dine-in/takeaway/qr unchanged from Today (Yesterday had none)", chan.get("dine-in")?.amount === 320 && chan.get("takeaway")?.amount === 200 && chan.get("qr")?.amount === 150);

  // 2-day insight range = insightRange({from:28,to:29}) -- rangeDays(2) < 7 -> same 28-day window as Today's (ends 29 Sep).
  check("2-day heat.from === 2026-09-02 (same insight window as Today)", d.heat.from === "2026-09-02");
  check("2-day heat.to === 2026-09-29", d.heat.to === "2026-09-29");
  check(
    "2-day slowItems order matches Today's (same insight window: NeverSold, RewardDish, OldCatDish, Pizza, Burger)",
    JSON.stringify(d.slowItems.map((i) => i.name)) === JSON.stringify(["NeverSold", "RewardDish", "OldCatDish", "Pizza", "Burger"]),
  );

  check("2-day leaks.cancelled === {count:1, value:300} (only Today's cancelled order is in range)", d.leaks.cancelled.count === 1 && d.leaks.cancelled.value === 300);
  check("2-day leaks.voids === {lines:2, qty:3, value:100} (unchanged, Yesterday had no voids)", d.leaks.voids.lines === 2 && d.leaks.voids.qty === 3 && d.leaks.voids.value === 100);

  check("2-day money.gross === 7070 (6470 today + 600 yesterday)", d.money.gross === 7070);
  check("2-day money.discount === 50", d.money.discount === 50);
  check("2-day money.reward === 130", d.money.reward === 130);
  check("2-day money.gst === 30", d.money.gst === 30);
  check("2-day money.charges === 20", d.money.charges === 20);
  check(
    "2-day money identity: gross - discount - reward + gst + charges === kpis.current.sales",
    d.money.gross - d.money.discount - d.money.reward + d.money.gst + d.money.charges === d.kpis.current.sales,
  );

  check("2-day duesCollected === 230 (150 today + 80 yesterday)", d.duesCollected === 230);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
