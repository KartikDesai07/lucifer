/**
 * CB-7 S6 live legs p6-p9 (the return): a settle whose order CAS misses after the spend, a cancel (status / keepUntil /
 * usedAt restored, an expired lot back expired), an evicted lot, and the Pay-Now create (Pending refused, the send-key
 * twin, the renumber retry). Part of verify-reward-points-live.ts. (ops CLI support module, not app code.)
 * Every call goes through the REAL route handlers; the faults are injected at the order CAS / Order.create only.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Customer } from "@/models/Customer";
import { Order } from "@/models/Order";
import { returnPoints } from "@/lib/reward-points-spend";
import { cardStateAt, pointsBalance } from "@pos/shared/reward-levels-engine";
import { POINTS_AT_PAYMENT } from "@pos/shared/reward-points";
import {
  diner, hoursFromNow, line, openTab, ordersOf, rawOrder, seedSettings, type Ctx, type Res,
} from "./reward-card-use-live-kit";
import {
  assertLotUntouched, atFirstInsert, beforeOrderCas, gate, lot, lotOf, lotsOf, oid, payNowBody, pointsSpentTotal, rawCustomer,
  settlePoints, spendsOf,
} from "./reward-points-live-kit";

const N = 40;
const SIZE_A = 30;
const SIZE_B = 50;
const REPLAY_STATUSES = [200, 201];

export async function runReturnLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const cake = (qty = 1) => line(menu.cake, "Cake", 100, qty);
  const brownie = () => line(menu.brownie, "Brownie", 150);
  const bill350 = () => [cake(2), brownie()];

  await scenario("p6", "a settle whose order CAS misses AFTER the spend: 409, the points are returned (lot restored, record closed), the order is untouched; a retry with the same orderId then lands", async () => {
    await seedSettings();
    const l = lot(SIZE_B, hoursFromNow(24));
    const d = await diner([l]);
    const id = await openTab(api, d, bill350());
    const before = await rawOrder(id);
    const restore = beforeOrderCas(async () => {
      await Order.collection.updateOne({ _id: oid(id) }, { $inc: { kotRounds: 1 } });
    });
    let res: Res;
    try {
      res = await settlePoints(api, id, N);
    } finally {
      restore();
    }
    assert.equal(res.status, 409, `the settle must miss - got ${res.status}: ${res.body.error ?? ""}`);
    const mid = await rawOrder(id);
    assert.equal(mid.kotRounds, (before.kotRounds as number) + 1, "landmark: the injected round is the only change");
    assert.equal(mid.status, "Pending");
    assert.equal("rewardPoints" in mid, false, "the missed settle wrote no reward");
    await assertLotUntouched(d, l, "after the missed settle");
    const [first] = await spendsOf(d);
    assert.equal(first.orderId, before.orderId, "landmark: the spend really happened, keyed on the bill");
    assert.ok(first.returnedAt instanceof Date, "and was returned");
    const retry = await settlePoints(api, id, N);
    assert.equal(retry.status, 200, `a retry on the same orderId lands - got ${retry.status}: ${retry.body.error ?? ""}`);
    const records = await spendsOf(d);
    assert.equal(records.length, 2, "the retry pushed a fresh record");
    assert.equal(records[1].orderId, before.orderId);
    assert.equal("returnedAt" in records[1], false, "the new record is open");
    assert.equal((await lotOf(d, l.id)).pointsSpent, N, "spent exactly once overall");
  });

  await scenario("p7", "cancel restores status, keepUntil and usedAt; the second return matches 0 (and a second cancel is a 409); a lot that expired meanwhile comes back EXPIRED", async () => {
    await seedSettings();
    const a = lot(SIZE_A, hoursFromNow(24));
    const b = lot(SIZE_B, hoursFromNow(48));
    const d = await diner([a, b]);
    const id = await openTab(api, d, bill350());
    assert.equal((await settlePoints(api, id, N)).status, 200);
    assert.equal((await lotOf(d, a.id)).status, "used", "landmark: lot A is spent before the cancel");
    const orderId = String((await rawOrder(id)).orderId);
    const cancelled = await api.cancel(id, "customer left");
    assert.equal(cancelled.status, 200, `cancel must land - got ${cancelled.status}: ${cancelled.body.error ?? ""}`);
    await assertLotUntouched(d, a, "lot A after the cancel");
    await assertLotUntouched(d, b, "lot B after the cancel");
    assert.ok((await spendsOf(d))[0].returnedAt instanceof Date, "the record is closed");
    const row = await rawCustomer(d);
    assert.equal(await returnPoints(d.id, orderId), false, "the second return matches nothing");
    assert.deepEqual(await rawCustomer(d), row, "and writes nothing");
    assert.equal((await api.cancel(id, "again")).status, 409, "a second cancel is refused");

    const c = lot(SIZE_A, hoursFromNow(1));
    const e = await diner([c]);
    const id2 = await openTab(api, e, bill350());
    assert.equal((await settlePoints(api, id2, SIZE_A)).status, 200);
    assert.equal((await lotOf(e, c.id)).status, "used", "landmark: the short-lived lot is spent");
    const past = hoursFromNow(-1);
    await Customer.collection.updateOne({ _id: oid(e.id), "rewardCards.id": c.id }, { $set: { "rewardCards.$.validUntil": past, "rewardCards.$.keepUntil": past } });
    assert.equal((await api.cancel(id2, "late")).status, 200);
    const back = await lotOf(e, c.id);
    assert.equal(back.status, "revealed", "status is restored");
    assert.equal(back.pointsSpent, 0);
    assert.equal("usedAt" in back, false);
    assert.deepEqual(back.keepUntil, past, "keepUntil is the lot's (past) validUntil - no extension");
    assert.equal(cardStateAt(back, new Date()), "expired", "the lot is expired again");
    assert.equal(pointsBalance(await lotsOf(e), new Date()), 0, "and holds no spendable points");
  });

  await scenario("p8", "an evicted lot is a no-op on the return: the other lots are restored, the evicted one is NOT resurrected; with every lot evicted the record still closes", async () => {
    await seedSettings();
    const a = lot(SIZE_A, hoursFromNow(24));
    const b = lot(SIZE_B, hoursFromNow(48));
    const keep = lot(20, hoursFromNow(72));
    const d = await diner([a, b, keep]);
    const id = await openTab(api, d, bill350());
    assert.equal((await settlePoints(api, id, N)).status, 200);
    await Customer.collection.updateOne({ _id: oid(d.id) }, { $pull: { rewardCards: { id: a.id } } } as never);
    assert.equal((await lotsOf(d)).some((c) => c.id === a.id), false, "landmark: lot A is evicted");
    assert.equal((await api.cancel(id, "evicted")).status, 200);
    assert.equal((await lotsOf(d)).some((c) => c.id === a.id), false, "the evicted lot is not brought back");
    await assertLotUntouched(d, b, "the surviving lot B");
    await assertLotUntouched(d, keep, "the lot the bill never touched");
    assert.ok((await spendsOf(d))[0].returnedAt instanceof Date, "the record is closed");

    const x = lot(SIZE_A, hoursFromNow(24));
    const y = lot(SIZE_A, hoursFromNow(48));
    const e = await diner([x, y]);
    const id2 = await openTab(api, e, bill350());
    assert.equal((await settlePoints(api, id2, N)).status, 200);
    await Customer.collection.updateOne({ _id: oid(e.id) }, { $set: { rewardCards: [] } });
    assert.equal((await api.cancel(id2, "all evicted")).status, 200);
    assert.deepEqual(await lotsOf(e), [], "no lot reappears");
    assert.ok((await spendsOf(e))[0].returnedAt instanceof Date, "the record is still closed");
  });

  await scenario("p9", "Pay-Now: a Pending create is a 400; a send-key twin parked at its insert returns its points and adopts the winner's order; the renumber retry re-spends against the new orderId", async () => {
    await seedSettings();
    const l = lot(200, hoursFromNow(24)); // room for the sale, the parked twin and the winner
    const d = await diner([l]);
    const pending = await api.create({ ...payNowBody(d, bill350(), N), status: "Pending", payment: "Unpaid", paidAmount: 0 });
    assert.equal(pending.status, 400, `got ${pending.status}: ${pending.body.error ?? ""}`);
    assert.equal(pending.body.error, POINTS_AT_PAYMENT);
    assert.equal(await ordersOf(d.id), 0, "no order written");
    await assertLotUntouched(d, l, "the Pending create");

    const sale = await api.create(payNowBody(d, bill350(), N));
    assert.equal(sale.status, 201, `witness: the Pay-Now sale lands - got ${sale.status}: ${sale.body.error ?? ""}`);
    assert.equal(sale.body.data!.discount, N);
    assert.equal(sale.body.data!.total, 310);
    assert.equal(sale.body.data!.status, "Completed");
    assert.equal((await rawOrder(String(sale.body.data!._id))).rewardPoints, N);
    assert.equal(await pointsSpentTotal(d), N);

    const key = randomUUID();
    const body = payNowBody(d, bill350(), N, { idemKey: key });
    const parked = gate();
    const restore = atFirstInsert(parked.hold);
    let a: Res;
    let b: Res;
    try {
      const pendingA = api.create(body);
      await parked.entered;
      b = await api.create(body);
      parked.release();
      a = await pendingA;
    } finally {
      restore();
    }
    assert.equal(b.status, 201, `fixture: the twin that inserted first lands - got ${b.status}: ${b.body.error ?? ""}`);
    assert.ok(REPLAY_STATUSES.includes(a.status), `the parked twin must answer the landed order - got ${a.status}: ${a.body.error ?? ""}`);
    assert.equal(String(a.body.data!._id), String(b.body.data!._id), "and it is the SAME order");
    assert.equal(await Order.collection.countDocuments({ idemKey: key }), 1, "exactly one order carries the key");
    assert.equal(await pointsSpentTotal(d), 2 * N, "the twin's points went back: two bills (the sale + the winner), not three");
    const winner = await rawOrder(String(b.body.data!._id));
    const open = (await spendsOf(d)).filter((r) => r.returnedAt === undefined);
    assert.deepEqual(open.map((r) => r.orderId).sort(), [String((await rawOrder(String(sale.body.data!._id))).orderId), String(winner.orderId)].sort(), "the open records are exactly the two landed bills");
    assert.equal((await spendsOf(d)).filter((r) => r.returnedAt !== undefined).length, 1, "the twin's own record is the one closed");

    const r = lot(100, hoursFromNow(24));
    const e = await diner([r]);
    let firstId = "";
    const undo = atFirstInsert(async (doc) => {
      firstId = String(doc.orderId);
      await Order.collection.insertOne({ orderId: firstId, status: "Cancelled", createdAt: new Date() });
    });
    let res: Res;
    try {
      res = await api.create(payNowBody(e, bill350(), N));
    } finally {
      undo();
    }
    assert.equal(res.status, 201, `the renumber retry lands - got ${res.status}: ${res.body.error ?? ""}`);
    const landed = await rawOrder(String(res.body.data!._id));
    assert.ok(firstId !== "" && landed.orderId !== firstId, "landmark: the order was renumbered");
    assert.equal(landed.rewardPoints, N);
    assert.equal(await pointsSpentTotal(e), N, "re-spent once, not twice");
    const records = await spendsOf(e);
    assert.equal(records.length, 2);
    assert.equal(records[0].orderId, firstId);
    assert.ok(records[0].returnedAt instanceof Date, "the first attempt's spend was returned");
    assert.equal(records[1].orderId, landed.orderId, "the retry spent against the NEW orderId");
    assert.equal("returnedAt" in records[1], false);
    assert.equal(await ordersOf(e.id), 1);
  });
}
