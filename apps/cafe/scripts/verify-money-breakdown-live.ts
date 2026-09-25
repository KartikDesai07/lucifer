/**
 * D10 S3 live leg — proves the Mongo twin of lib/money-breakdown.ts's JS fold
 * (MONEY_BREAKDOWN_GROUP / ITEM_REVENUE_EXPR) actually agrees with the pure
 * fold (foldMoneyBreakdown / lineRevenue), by inserting MONEY_FIXTURE_ORDERS
 * through the REAL Order model and running the REAL aggregation pipelines
 * the two live routes (orders/summary, reports) execute — which the DB-free
 * unit tests cannot: only a real mongod proves the pipeline SYNTAX actually
 * runs and returns the field shapes the JS side expects.
 *
 *   npm run verify:money:live            (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_money npm run verify:money:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops only the documents it inserted (by orderId $in)
 * in a finally block — modelled on verify-dues-live.ts.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import {
  foldMoneyBreakdown,
  lineRevenue,
  MONEY_BREAKDOWN_GROUP,
  ITEM_REVENUE_EXPR,
  type MoneyOrderView,
} from "@/lib/money-breakdown";
import { MONEY_FIXTURE_ORDERS, type MoneyFixtureOrder } from "@/lib/money-breakdown-fixtures";
import type { MoneyBreakdown } from "@/types";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}money`;

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

function toOrderView(f: MoneyFixtureOrder): MoneyOrderView {
  return {
    subtotal: f.subtotal,
    discount: f.discount,
    discountKind: f.discountKind,
    gstAmount: f.gstAmount,
    chargeAmount: f.chargeAmount,
    items: f.items,
  };
}

// Mirrors app/api/reports/route.ts's Totals $group EXACTLY (totalSales +
// ...MONEY_BREAKDOWN_GROUP over the same $match).
type TotalsAgg = { _id: null; totalSales: number } & MoneyBreakdown;

// Mirrors app/api/reports/route.ts's topProducts pipeline EXACTLY ($unwind +
// ITEM_REVENUE_EXPR), minus the name-with-variation concat (no fixture uses
// variations) — grouped by the bare item name.
type ProductAgg = { _id: string; qty: number; revenue: number };

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

  const runSuffix = randomUUID();
  const insertedIds: string[] = [];

  try {
    const docs = MONEY_FIXTURE_ORDERS.map((f, i) => {
      const orderId = `SCRATCH-MONEY-${runSuffix}-${String(i).padStart(2, "0")}`;
      insertedIds.push(orderId);
      return {
        orderId,
        customerName: f.customerName,
        items: f.items,
        subtotal: f.subtotal,
        discount: f.discount,
        discountKind: f.discountKind,
        gstAmount: f.gstAmount,
        gstRate: f.gstRate,
        gstMode: f.gstMode,
        chargeAmount: f.chargeAmount,
        total: f.total,
        paidAmount: f.paidAmount,
        payment: f.payment,
        status: f.status,
        receiver: f.receiver,
        kotRounds: 1,
        createdAt: new Date(),
      };
    });
    await Order.insertMany(docs);
    console.log(`\nD10 money-breakdown live — inserted ${docs.length} fixture orders against ${dbName}\n`);

    const expectedFold = foldMoneyBreakdown(MONEY_FIXTURE_ORDERS.map(toOrderView));

    // (a) MONEY_BREAKDOWN_GROUP twin — every key strictly equals the JS fold,
    // and the identity holds against the same $group's totalSales.
    const [totalsAgg] = await Order.aggregate<TotalsAgg>([
      { $match: { orderId: { $in: insertedIds } } },
      {
        $group: {
          _id: null,
          totalSales: { $sum: "$total" },
          ...MONEY_BREAKDOWN_GROUP,
        },
      },
    ]);
    check("MONEY_BREAKDOWN_GROUP twin ran and returned a row", totalsAgg !== undefined);
    if (totalsAgg) {
      for (const key of Object.keys(expectedFold) as Array<keyof MoneyBreakdown>) {
        check(
          `MONEY_BREAKDOWN_GROUP.${key} strictly equals foldMoneyBreakdown(fixtures).${key} (${expectedFold[key]})`,
          totalsAgg[key] === expectedFold[key],
        );
      }
      const identity =
        totalsAgg.gross - totalsAgg.discount - totalsAgg.reward + totalsAgg.gst + totalsAgg.charges;
      check(
        `identity gross - discount - reward + gst + charges === totalSales (${totalsAgg.totalSales})`,
        identity === totalsAgg.totalSales,
      );
    }

    // (b) ITEM_REVENUE_EXPR twin — a reward line's qty >= 1, revenue === the
    // JS-fold sum of lineRevenue for that same name; a paid dish's revenue
    // === price x qty.
    const productRows = await Order.aggregate<ProductAgg>([
      { $match: { orderId: { $in: insertedIds } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          qty: { $sum: "$items.qty" },
          revenue: { $sum: ITEM_REVENUE_EXPR },
        },
      },
    ]);
    const byName = new Map(productRows.map((r) => [r._id, r]));

    const expectedRevenueByName = new Map<string, number>();
    const qtyByName = new Map<string, number>();
    for (const f of MONEY_FIXTURE_ORDERS) {
      for (const it of f.items) {
        expectedRevenueByName.set(it.name, (expectedRevenueByName.get(it.name) ?? 0) + lineRevenue(it));
        qtyByName.set(it.name, (qtyByName.get(it.name) ?? 0) + it.qty);
      }
    }

    const rewardDishRow = byName.get("Reward Dish");
    check(
      "the reward dish's aggregated row exists with qty >= 1 and revenue === Σ lineRevenue (0, given only free)",
      rewardDishRow !== undefined &&
        rewardDishRow.qty >= 1 &&
        rewardDishRow.revenue === (expectedRevenueByName.get("Reward Dish") ?? -1),
    );

    const paidDishRow = byName.get("Paid Dish");
    check(
      "a paid dish's aggregated revenue === price x qty",
      paidDishRow !== undefined && paidDishRow.revenue === (expectedRevenueByName.get("Paid Dish") ?? -1),
    );

    for (const [name, expectedRevenue] of expectedRevenueByName) {
      const row = byName.get(name);
      check(
        `"${name}": ITEM_REVENUE_EXPR twin revenue (${row?.revenue}) === Σ lineRevenue (${expectedRevenue}) over the fixtures`,
        row !== undefined && row.revenue === expectedRevenue,
      );
      check(
        `"${name}": aggregated qty (${row?.qty}) === Σ qty (${qtyByName.get(name)}) over the fixtures`,
        row !== undefined && row.qty === qtyByName.get(name),
      );
    }

    // (c) read back one inserted order .lean() — the reward flag and total
    // survive the model's strict schema exactly as inserted.
    const itemRewardFixtureIndex = MONEY_FIXTURE_ORDERS.findIndex((f) =>
      f.items.some((it) => it.reward === true),
    );
    check("setup: at least one fixture carries a reward line", itemRewardFixtureIndex !== -1);
    if (itemRewardFixtureIndex !== -1) {
      const fixture = MONEY_FIXTURE_ORDERS[itemRewardFixtureIndex];
      const readBack = await Order.findOne({ orderId: insertedIds[itemRewardFixtureIndex] }).lean();
      check("the reward-line fixture order was read back", readBack !== null);
      if (readBack) {
        const rewardLineIndex = fixture.items.findIndex((it) => it.reward === true);
        check(
          "items[i].reward === true survived the model's strict schema on read-back",
          readBack.items[rewardLineIndex]?.reward === true,
        );
        check(
          "the read-back order's total equals the fixture's total",
          readBack.total === fixture.total,
        );
      }
    }
  } finally {
    await Order.deleteMany({ orderId: { $in: insertedIds } });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
