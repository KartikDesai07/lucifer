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
import {
  MONEY_CARD_DISCOUNT, MONEY_CARD_FIXTURE_ORDER, MONEY_CARD_GST, MONEY_CARD_MANUAL_TWIN, MONEY_CARD_TOTAL,
} from "@/lib/money-breakdown-card-fixtures";
import { MONEY_POINTS_FIXTURE_ORDER } from "@/lib/money-breakdown-points-fixtures";
import { checkPointsOrder } from "./money-points-live-leg";
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

// The Order document a fixture inserts (every field the model requires; orderId is per-run).
function toInsertDoc(f: MoneyFixtureOrder, orderId: string) {
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
}

// The date-range Totals $group (totalSales + ...MONEY_BREAKDOWN_GROUP over a
// Completed + range $match) that the retired app/api/reports route ran — the
// same accumulators lib/reports/sales-pipelines.ts's days facet now runs.
type TotalsAgg = { _id: null; totalSales: number } & MoneyBreakdown;

// The retired app/api/reports route's topProducts pipeline ($unwind +
// ITEM_REVENUE_EXPR — the rule the Dashboard's items facet still runs), minus the name-with-variation concat (no fixture uses
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
      return toInsertDoc(f, orderId);
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

    // (d) CB-7 S5 — ONE scoped scratch-card order (lib/money-breakdown-card-fixtures.ts), inserted on its own so the
    // totals above stay about the nine D10 fixtures. The reward bucket must hold exactly the card's discount, and the
    // tax must be consistent: GST on subtotal - discount, identical to an equal manual discount (one tax pipeline).
    const cardFixture = MONEY_CARD_FIXTURE_ORDER;
    const cardOrderId = `SCRATCH-MONEY-${runSuffix}-card`;
    insertedIds.push(cardOrderId);
    await Order.insertMany([{ ...toInsertDoc(cardFixture, cardOrderId), ...cardFixture.rewardCardFields }]);
    check(
      "card fixture: the modelled bill is the hand-computed one (subtotal 500, discount 36, gst 23, total 487)",
      cardFixture.subtotal === 500 &&
        cardFixture.discount === MONEY_CARD_DISCOUNT &&
        cardFixture.gstAmount === MONEY_CARD_GST &&
        cardFixture.total === MONEY_CARD_TOTAL,
    );
    const [cardAgg] = await Order.aggregate<TotalsAgg>([
      { $match: { orderId: cardOrderId } },
      { $group: { _id: null, totalSales: { $sum: "$total" }, ...MONEY_BREAKDOWN_GROUP } },
    ]);
    check("card order: the aggregation ran and returned a row", cardAgg !== undefined);
    if (cardAgg) {
      for (const key of Object.keys(cardFixture.expected) as Array<keyof MoneyBreakdown>) {
        check(
          `card order: MONEY_BREAKDOWN_GROUP.${key} (${cardAgg[key]}) === the hand-computed ${cardFixture.expected[key]}`,
          cardAgg[key] === cardFixture.expected[key],
        );
      }
      check(
        "card order: the reward bucket holds exactly the card's discount, the discount bucket none of it",
        cardAgg.reward === MONEY_CARD_DISCOUNT && cardAgg.discount === 0,
      );
      check(
        "card order: identity gross - discount - reward + gst + charges === total",
        cardAgg.gross - cardAgg.discount - cardAgg.reward + cardAgg.gst + cardAgg.charges === cardAgg.totalSales,
      );
      const folded = foldMoneyBreakdown([toOrderView(cardFixture)]);
      check(
        "card order: the JS fold agrees with the pipeline on every bucket",
        (Object.keys(folded) as Array<keyof MoneyBreakdown>).every((k) => folded[k] === cardAgg[k]),
      );
    }
    check(
      "card order: GST and total equal an equal MANUAL discount's (tax base = subtotal - discount)",
      cardFixture.gstAmount === MONEY_CARD_MANUAL_TWIN.gstAmount && cardFixture.total === MONEY_CARD_MANUAL_TWIN.total,
    );
    const storedCard = await Order.collection.findOne({ orderId: cardOrderId });
    check(
      "card order: every card field survived the strict schema on the raw doc, with no rewardAt / rewardStamps",
      storedCard !== null &&
        (Object.entries(cardFixture.rewardCardFields) as Array<[string, unknown]>).every(
          ([k, v]) => JSON.stringify(storedCard[k]) === JSON.stringify(v),
        ) &&
        !("rewardAt" in storedCard) &&
        !("rewardStamps" in storedCard),
    );

    // (e) CB-7 S6 - ONE points order (lib/money-breakdown-points-fixtures.ts), the same checks as (d): scripts/money-points-live-leg.ts.
    const pointsOrderId = `SCRATCH-MONEY-${runSuffix}-points`;
    insertedIds.push(pointsOrderId);
    await checkPointsOrder(check, pointsOrderId, toInsertDoc(MONEY_POINTS_FIXTURE_ORDER, pointsOrderId), toOrderView(MONEY_POINTS_FIXTURE_ORDER));
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
