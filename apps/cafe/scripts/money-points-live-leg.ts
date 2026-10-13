/**
 * CB-7 S6 money leg (e) of verify-money-breakdown-live.ts, in its own file so that script stays under the size cap: ONE
 * points order (lib/money-breakdown-points-fixtures.ts) inserted through the REAL Order model and run through the REAL
 * MONEY_BREAKDOWN_GROUP pipeline. The reward bucket must hold exactly the points spent, the tax must be the one an equal
 * manual discount gets, and the stored order must carry rewardPoints and no other reward field.
 * (ops CLI support module, not app code.)
 */
import { Order } from "@/models/Order";
import { foldMoneyBreakdown, MONEY_BREAKDOWN_GROUP, type MoneyOrderView } from "@/lib/money-breakdown";
import {
  MONEY_POINTS_FIXTURE_ORDER, MONEY_POINTS_GST, MONEY_POINTS_MANUAL_TWIN, MONEY_POINTS_SPENT, MONEY_POINTS_TOTAL,
} from "@/lib/money-breakdown-points-fixtures";
import type { MoneyBreakdown } from "@/types";

type TotalsAgg = { _id: null; totalSales: number } & MoneyBreakdown;
const NO_REWARD_FIELDS = ["rewardAt", "rewardStamps", "rewardCardId"];

export async function checkPointsOrder(
  check: (label: string, ok: boolean) => void,
  orderId: string,
  doc: Record<string, unknown>,
  view: MoneyOrderView,
): Promise<void> {
  const fixture = MONEY_POINTS_FIXTURE_ORDER;
  await Order.insertMany([{ ...doc, ...fixture.rewardFields }]);
  check(
    "points fixture: the modelled bill is the hand-computed one (subtotal 500, discount 40, gst 23, total 483)",
    fixture.subtotal === 500 && fixture.discount === MONEY_POINTS_SPENT && fixture.gstAmount === MONEY_POINTS_GST && fixture.total === MONEY_POINTS_TOTAL,
  );
  const [agg] = await Order.aggregate<TotalsAgg>([
    { $match: { orderId } },
    { $group: { _id: null, totalSales: { $sum: "$total" }, ...MONEY_BREAKDOWN_GROUP } },
  ]);
  check("points order: the aggregation ran and returned a row", agg !== undefined);
  if (agg) {
    for (const key of Object.keys(fixture.expected) as Array<keyof MoneyBreakdown>) {
      check(`points order: MONEY_BREAKDOWN_GROUP.${key} (${agg[key]}) === the hand-computed ${fixture.expected[key]}`, agg[key] === fixture.expected[key]);
    }
    check("points order: the reward bucket holds exactly the points spent, the discount bucket none of it", agg.reward === MONEY_POINTS_SPENT && agg.discount === 0);
    check("points order: identity gross - discount - reward + gst + charges === total", agg.gross - agg.discount - agg.reward + agg.gst + agg.charges === agg.totalSales);
    const folded = foldMoneyBreakdown([view]);
    check("points order: the JS fold agrees with the pipeline on every bucket", (Object.keys(folded) as Array<keyof MoneyBreakdown>).every((k) => folded[k] === agg[k]));
  }
  check(
    "points order: GST and total equal an equal MANUAL discount's (tax base = subtotal - discount)",
    fixture.gstAmount === MONEY_POINTS_MANUAL_TWIN.gstAmount && fixture.total === MONEY_POINTS_MANUAL_TWIN.total,
  );
  const stored = await Order.collection.findOne({ orderId });
  check(
    "points order: rewardPoints survived the strict schema on the raw doc, with no rewardAt / rewardStamps / rewardCardId",
    stored !== null && stored.rewardPoints === MONEY_POINTS_SPENT && NO_REWARD_FIELDS.every((k) => !(k in stored)),
  );
}
