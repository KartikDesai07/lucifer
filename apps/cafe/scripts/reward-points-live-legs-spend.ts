/**
 * CB-7 S6 live legs p0-p5 (the spend): the probe of the two guarded writes through Mongoose, FIFO + partial lot through
 * the REAL settle route, the use-by instant, the barrier race of two settles, a short balance (409) and a bill smaller than
 * the ask (400). Part of verify-reward-points-live.ts. (ops CLI support module, not app code.)
 */
import assert from "node:assert/strict";

import { Customer } from "@/models/Customer";
import { Order } from "@/models/Order";
import { MONEY_BREAKDOWN_GROUP } from "@/lib/money-breakdown";
import { POINTS_SPEND_DEPS, spendPoints } from "@/lib/reward-points-spend";
import { pointsReturnFilter, pointsReturnUpdate, pointsSpendFilter, pointsSpendUpdate } from "@/lib/reward-points-cas";
import { pointsBalance } from "@pos/shared/reward-levels-engine";
import { planPointsSpend } from "@pos/shared/reward-points-plan";
import { POINTS_CHANGED, POINTS_NOT_ENOUGH, POINTS_OVER_BILL, POINTS_SPENDS_KEEP } from "@pos/shared/reward-points";
import {
  assertCardUntouched, barrier, diner, hoursFromNow, line, openTab, rawOrder, revealed, seedSettings, type Ctx, type Rec,
} from "./reward-card-use-live-kit";
import {
  assertLotUntouched, beforePointsSpend, lot, lotOf, lotsOf, oid, pointsSpentTotal, rawCustomer, settlePoints, spendsOf,
} from "./reward-points-live-kit";

const N = 40;
const SIZE_A = 30;
const SIZE_B = 50;

export async function runSpendLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const cake = (qty = 1) => line(menu.cake, "Cake", 100, qty);
  const brownie = () => line(menu.brownie, "Brownie", 150);
  const bill350 = () => [cake(2), brownie()];

  await scenario("p0", "PROBE through Mongoose: the spend (per-lot $all + $elemMatch, arrayFilters $inc / $set, $push $slice) and the return (positional $ + arrayFilters) each land in ONE updateOne; $not $elemMatch on a missing array matches", async () => {
    await seedSettings();
    const a = lot(SIZE_A, hoursFromNow(24));
    const b = lot(SIZE_B, hoursFromNow(48));
    const d = await diner([a, b]);
    const now = new Date();
    const plan = planPointsSpend(await lotsOf(d), N, now);
    assert.ok(plan && plan.length === 2, "landmark: the plan takes from both lots");
    const { update, arrayFilters } = pointsSpendUpdate("LIVE-P0-1", plan, now);
    const spent = await POINTS_SPEND_DEPS.updatePoints(pointsSpendFilter(d.id, "LIVE-P0-1", plan, now), update, arrayFilters);
    assert.equal(spent.matchedCount, 1, "the spend is one guarded update that matched");
    const afterA = await lotOf(d, a.id);
    assert.equal(afterA.pointsSpent, SIZE_A, "$inc through arrayFilters");
    assert.equal(afterA.status, "used", "$set through arrayFilters: the emptied lot is closed");
    assert.deepEqual(afterA.usedAt, now);
    assert.deepEqual(afterA.keepUntil, now, "the closed lot's keepUntil follows usedAt");
    const afterB = await lotOf(d, b.id);
    assert.equal(afterB.pointsSpent, N - SIZE_A, "the partial lot is only incremented");
    assert.equal(afterB.status, "revealed");
    assert.deepEqual(await spendsOf(d), [{ orderId: "LIVE-P0-1", at: now, lots: [{ id: a.id, take: SIZE_A }, { id: b.id, take: N - SIZE_A }] }]);
    const again = await POINTS_SPEND_DEPS.updatePoints(pointsSpendFilter(d.id, "LIVE-P0-1", plan, now), update, arrayFilters);
    assert.equal(again.matchedCount, 0, "the SAME order cannot spend twice (the unreturned record fences it)");

    const record = (await spendsOf(d))[0];
    const back = pointsReturnUpdate(record.lots, await lotsOf(d), new Date());
    const returned = await POINTS_SPEND_DEPS.updatePoints(pointsReturnFilter(d.id, "LIVE-P0-1"), back.update, back.arrayFilters);
    assert.equal(returned.matchedCount, 1, "the return is one guarded update that matched");
    await assertLotUntouched(d, a, "lot A after the return");
    await assertLotUntouched(d, b, "lot B after the return");
    const closed = (await spendsOf(d))[0];
    assert.ok(closed.returnedAt instanceof Date, "the positional $ marked THIS record returned");
    const second = await POINTS_SPEND_DEPS.updatePoints(pointsReturnFilter(d.id, "LIVE-P0-1"), back.update, back.arrayFilters);
    assert.equal(second.matchedCount, 0, "a second return matches nothing");
    const retry = await POINTS_SPEND_DEPS.updatePoints(pointsSpendFilter(d.id, "LIVE-P0-1", plan, now), update, arrayFilters);
    assert.equal(retry.matchedCount, 1, "a RETURNED record no longer fences: the same order can spend again");

    const fresh = await diner([lot(SIZE_B, hoursFromNow(24))]);
    assert.equal("pointsSpends" in (await rawCustomer(fresh)), false, "landmark: the row has no pointsSpends array at all");
    const missing = await Customer.collection.countDocuments({ _id: oid(fresh.id), pointsSpends: { $not: { $elemMatch: { orderId: "X", returnedAt: { $exists: false } } } } });
    assert.equal(missing, 1, "$not $elemMatch matches a row whose array is missing");

    const full = await diner([lot(SIZE_B, hoursFromNow(24))]);
    const old = Array.from({ length: POINTS_SPENDS_KEEP }, (_, i) => ({ orderId: `OLD-${i}`, at: new Date(), lots: [], returnedAt: new Date() }));
    await Customer.collection.updateOne({ _id: oid(full.id) }, { $set: { pointsSpends: old } });
    assert.equal((await spendsOf(full)).length, POINTS_SPENDS_KEEP, "landmark: the array starts at its cap");
    assert.equal(await spendPoints(full.id, "LIVE-P0-NEW", 5, new Date()), true);
    const kept = await spendsOf(full);
    assert.equal(kept.length, POINTS_SPENDS_KEEP, "$slice keeps the array at its cap");
    assert.equal(kept[0].orderId, "OLD-1", "the oldest record was evicted");
    assert.equal(kept[kept.length - 1].orderId, "LIVE-P0-NEW", "the new record is the last");
  });

  await scenario("p1", "two lots through the settle route: FIFO by use-by (array order ignored), a partial lot, discount == N, the record is pushed, a money card in the wallet is untouched, the reward bucket holds N", async () => {
    await seedSettings();
    const early = lot(SIZE_A, hoursFromNow(24));
    const late = lot(SIZE_B, hoursFromNow(48));
    const money = revealed({ kind: "bill-flat", value: 100 });
    const d = await diner([late, money, early]);
    const id = await openTab(api, d, bill350());
    const res = await settlePoints(api, id, N);
    assert.equal(res.status, 200, `the points settle must land - got ${res.status}: ${res.body.error ?? ""}`);
    const data = res.body.data!;
    assert.equal(data.discount, N, "the discount is exactly N");
    assert.equal(data.discountKind, "reward");
    assert.equal(data.total, 310, "350 - 40");
    const doc = await rawOrder(id);
    assert.equal(doc.rewardPoints, N, "landmark: the order stores its point cost");
    for (const key of ["rewardAt", "rewardStamps", "rewardCardId"]) assert.equal(key in doc, false, `a points order stores no ${key}`);
    assert.equal((await lotOf(d, early.id)).status, "used", "FIFO: the earlier use-by is emptied first");
    assert.equal((await lotOf(d, early.id)).pointsSpent, SIZE_A);
    const rest = await lotOf(d, late.id);
    assert.equal(rest.pointsSpent, N - SIZE_A, "the later lot gives only the remainder");
    assert.equal(rest.status, "revealed");
    assert.deepEqual(rest.keepUntil, late.validUntil, "a partly spent lot keeps its keepUntil");
    await assertCardUntouched(d, money, "the money card in the same wallet");
    const [record] = await spendsOf(d);
    assert.equal(record.orderId, doc.orderId, "the record is keyed on the bill's orderId");
    assert.deepEqual(record.lots, [{ id: early.id, take: SIZE_A }, { id: late.id, take: N - SIZE_A }]);
    assert.equal("returnedAt" in record, false, "an open record has no returnedAt");
    assert.equal(pointsBalance(await lotsOf(d), new Date()), SIZE_A + SIZE_B - N, "balance after = before - N");
    const [agg] = await Order.aggregate<{ reward: number; discount: number }>([{ $match: { _id: oid(id) } }, { $group: { _id: null, ...MONEY_BREAKDOWN_GROUP } }]);
    assert.equal(agg.reward, N, "the money breakdown books the points as REWARD");
    assert.equal(agg.discount, 0, "and none of it as a manual discount");
  });

  await scenario("p2", "the use-by instant: a spend at now == validUntil lands, at +1 ms is refused untouched; a settle on a lot already past its date is a 409", async () => {
    await seedSettings();
    const onTime = lot(10, hoursFromNow(1));
    const late = lot(10, hoursFromNow(2)); // a different hour from onTime: FIFO must pick onTime, never tie-break onto late
    const d = await diner([onTime, late]);
    assert.equal(await spendPoints(d.id, "LIVE-P2-1", 10, onTime.validUntil!), true, "the deadline instant is still spendable ($gte)");
    assert.equal((await lotOf(d, onTime.id)).status, "used");
    assert.equal(await spendPoints(d.id, "LIVE-P2-2", 10, new Date(late.validUntil!.getTime() + 1)), false, "one millisecond past is expired");
    await assertLotUntouched(d, late, "the +1 ms spend");
    const gone = lot(100, new Date(Date.now() - 1000));
    const e = await diner([gone]);
    const id = await openTab(api, e, bill350());
    const res = await settlePoints(api, id, 10);
    assert.equal(res.status, 409, "a lot past its date holds no points");
    assert.equal(res.body.error, POINTS_NOT_ENOUGH);
    await assertLotUntouched(e, gone, "the expired lot");
  });

  await scenario("p3", "barrier race of two settles held at the CAS: (a) short lots - one lands, the loser re-plans and gets a 409, spent == the one discount; (b) lots for both - the loser re-plans onto the remainder and lands, spent == both discounts", async () => {
    await seedSettings();
    const a1 = lot(SIZE_A, hoursFromNow(24));
    const a2 = lot(SIZE_A, hoursFromNow(48));
    const d = await diner([a1, a2]);
    const t1 = await openTab(api, d, bill350());
    const t2 = await openTab(api, d, bill350());
    let restore = beforePointsSpend(barrier(2));
    let results;
    try {
      results = await Promise.all([t1, t2].map((t) => settlePoints(api, t, N)));
    } finally {
      restore();
    }
    const won = results.filter((r) => r.status === 200);
    const lost = results.filter((r) => r.status === 409);
    assert.equal(won.length, 1, `exactly one settle wins - got ${results.map((r) => r.status).join(",")}`);
    assert.equal(lost.length, 1);
    assert.equal(lost[0].body.error, POINTS_CHANGED, "the loser re-planned against the lots the winner moved");
    assert.equal(await pointsSpentTotal(d), N, "total spent == the one landed discount");
    const done = (await Order.collection.find({ customerId: oid(d.id), status: "Completed" }).toArray()) as Rec[];
    assert.equal(done.length, 1, "landmark: one bill completed");
    assert.equal(done.reduce((s, o) => s + (o.discount as number), 0), N);
    const pending = (await Order.collection.find({ customerId: oid(d.id), status: "Pending" }).toArray()) as Rec[];
    assert.equal(pending.length, 1, "the losing tab is still open");
    assert.equal("rewardPoints" in pending[0], false, "and carries no reward");
    assert.equal((await spendsOf(d)).length, 1, "the loser left no record");

    const b1 = lot(SIZE_B, hoursFromNow(24));
    const b2 = lot(SIZE_B, hoursFromNow(48));
    const e = await diner([b1, b2]);
    const u1 = await openTab(api, e, bill350());
    const u2 = await openTab(api, e, bill350());
    restore = beforePointsSpend(barrier(2));
    try {
      results = await Promise.all([u1, u2].map((t) => settlePoints(api, t, N)));
    } finally {
      restore();
    }
    assert.deepEqual(results.map((r) => r.status), [200, 200], `both land - got ${results.map((r) => `${r.status} ${r.body.error ?? ""}`).join(" | ")}`);
    assert.equal(await pointsSpentTotal(e), 2 * N, "total spent == both discounts");
    assert.equal((await lotOf(e, b1.id)).status, "used", "the first lot was emptied by the two plans together");
    assert.equal((await lotOf(e, b1.id)).pointsSpent, SIZE_B);
    assert.equal((await lotOf(e, b2.id)).pointsSpent, 2 * N - SIZE_B);
    assert.equal((await spendsOf(e)).length, 2, "one record per bill");
  });

  await scenario("p4", "N above the balance: 409 POINTS_NOT_ENOUGH, the customer row and the order are byte-identical", async () => {
    await seedSettings();
    const l = lot(SIZE_B, hoursFromNow(24));
    const d = await diner([l]);
    const id = await openTab(api, d, bill350());
    const customerBefore = await rawCustomer(d);
    const orderBefore = await rawOrder(id);
    assert.equal(await pointsSpentTotal(d), 0, "landmark: nothing spent yet");
    const res = await settlePoints(api, id, SIZE_B + 1);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, POINTS_NOT_ENOUGH);
    assert.deepEqual(await rawCustomer(d), customerBefore, "the customer row is byte-identical");
    assert.deepEqual(await rawOrder(id), orderBefore, "the order is byte-identical");
    const exact = await settlePoints(api, id, SIZE_B);
    assert.equal(exact.status, 200, `witness: spending exactly the balance lands - got ${exact.status}: ${exact.body.error ?? ""}`);
  });

  await scenario("p5", "N above the FOOD total: 400 POINTS_OVER_BILL even when GST makes the bill total larger; nothing written; N == the food total lands", async () => {
    await seedSettings({ gst: true });
    const d = await diner([lot(1000, hoursFromNow(24))]);
    const id = await openTab(api, d, bill350());
    const tab = await rawOrder(id);
    assert.ok((tab.total as number) > 350, `landmark: GST puts the bill total above its food total (${String(tab.total)})`);
    const customerBefore = await rawCustomer(d);
    const res = await settlePoints(api, id, 355);
    assert.equal(res.status, 400, `got ${res.status}: ${res.body.error ?? ""}`);
    assert.equal(res.body.error, POINTS_OVER_BILL);
    assert.deepEqual(await rawCustomer(d), customerBefore, "nothing spent");
    assert.deepEqual(await rawOrder(id), tab, "the order is untouched");
    const exact = await settlePoints(api, id, 350);
    assert.equal(exact.status, 200, `witness: points up to the food total land - got ${exact.status}: ${exact.body.error ?? ""}`);
    assert.equal(exact.body.data!.discount, 350);
    assert.equal(await pointsSpentTotal(d), 350);
  });
}
