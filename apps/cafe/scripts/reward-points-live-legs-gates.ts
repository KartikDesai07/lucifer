/**
 * CB-7 S6 live legs p10-p12 (what points may NOT do, and what the models keep): one reward per bill (create and settle,
 * every refusal writes nothing, a marker landing mid-flight makes the CAS miss and the points go back), the diner-accounts
 * gate (levels off / the Tamil Nadu block still spend), and the strict-schema round trip. Part of
 * verify-reward-points-live.ts. (ops CLI support module, not app code.)
 */
import assert from "node:assert/strict";

import { Customer } from "@/models/Customer";
import { Order } from "@/models/Order";
import type { ISettings } from "@/models/Settings";
import { rewardClaimRefusal } from "@/lib/order-reward-fence";
import { rewardLevelsEarning, scratchCardsBlockedFor } from "@/lib/reward-levels-config";
import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";
import { ONE_REWARD_PER_BILL } from "@pos/shared/reward-card-use";
import { POINTS_NOT_ENOUGH, POINTS_REWARD_EXCLUSIVE } from "@pos/shared/reward-points";
import {
  PROMO_CODE, RUNG_AT, assertCardUntouched, diner, hoursFromNow, line, openTab, ordersOf, rawOrder, revealed, seedSettings, type Ctx,
  type Res,
} from "./reward-card-use-live-kit";
import {
  assertLotUntouched, beforeOrderCas, lot, lotOf, oid, payNowBody, pointsSpentTotal, rawCustomer, settlePoints, spendsOf,
} from "./reward-points-live-kit";

const N = 40;
const STAMPS = 20;

export async function runGateLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const cake = (qty = 1) => line(menu.cake, "Cake", 100, qty);
  const tea = () => line(menu.tea, "Masala Tea", 100);
  const brownie = () => line(menu.brownie, "Brownie", 150);
  const bill350 = () => [cake(2), brownie()];

  await scenario("p10", "one reward per bill: points with a rung / card / promo / GST preset on create = 400 and with a rung / card on settle = 400 (nothing spent); a promo-marked or rewarded tab = 409 with nothing spent; add-round refuses points; a marker landing mid-flight makes the CAS miss and the points go back", async () => {
    await seedSettings({ gst: true });
    const l = lot(100, hoursFromNow(24));
    const c = revealed({ kind: "bill-flat", value: 100 });
    const d = await diner([l, c], { stamps: STAMPS });
    const walletBefore = await rawCustomer(d);
    const create = async (extra: Record<string, unknown>): Promise<Res> => api.create(payNowBody(d, bill350(), N, extra));
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["a stamp rung", { rewardAt: RUNG_AT }, POINTS_REWARD_EXCLUSIVE],
      ["a scratch card", { rewardCardId: c.id }, POINTS_REWARD_EXCLUSIVE],
      ["a promo code", { promoCode: PROMO_CODE }, PROMO_BLOCKS_REWARD],
      ["the GST preset", { discountKind: "gst" }, POINTS_REWARD_EXCLUSIVE],
    ];
    for (const [what, extra, message] of cases) {
      const res = await create(extra);
      assert.equal(res.status, 400, `points + ${what}: got ${res.status} ${res.body.error ?? ""}`);
      assert.equal(res.body.error, message, `points + ${what}`);
    }
    assert.equal(await ordersOf(d.id), 0, "no order was written");
    assert.deepEqual(await rawCustomer(d), walletBefore, "no point, stamp or card was spent");
    const witness = await create({});
    assert.equal(witness.status, 201, `witness: points alone land on the same body - got ${witness.status}: ${witness.body.error ?? ""}`);
    assert.equal(await pointsSpentTotal(d), N);

    const tab = await openTab(api, d, bill350());
    for (const [what, extra] of [["a stamp rung", { rewardAt: RUNG_AT }], ["a scratch card", { rewardCardId: c.id }]] as const) {
      const res = await settlePoints(api, tab, N, extra);
      assert.equal(res.status, 400, `settle: points + ${what}: got ${res.status} ${res.body.error ?? ""}`);
      assert.equal(res.body.error, POINTS_REWARD_EXCLUSIVE);
    }
    assert.equal(await pointsSpentTotal(d), N, "the refused settles spent nothing");
    await assertCardUntouched(d, c, "the card in the refused settle");
    assert.equal((await rawCustomer(d)).stamps, STAMPS, "no stamps spent");
    const round = await api.addRound(tab, { items: [tea()], discount: 0, discountKind: null, rewardPoints: N });
    assert.equal(round.status, 400, "an add-round carries no points (strict schema)");
    assert.equal((await rawOrder(tab)).kotRounds, 1, "no round landed");

    const fresh = lot(100, hoursFromNow(24));
    const cardE = revealed({ kind: "bill-flat", value: 100 });
    const e = await diner([fresh, cardE]);
    const promoTab = await openTab(api, e, bill350(), { promoCode: PROMO_CODE });
    const promoDoc = await rawOrder(promoTab);
    assert.equal(promoDoc.promoCode, PROMO_CODE, "landmark: the tab carries the promo marker");
    const onPromo = await settlePoints(api, promoTab, N);
    assert.equal(onPromo.status, 409);
    assert.equal(onPromo.body.error, rewardClaimRefusal(promoDoc as never));
    assert.equal(onPromo.body.error, PROMO_BLOCKS_REWARD);
    assert.deepEqual(await rawOrder(promoTab), promoDoc, "the promo tab is byte-identical");
    const cardTab = await openTab(api, e, bill350(), { rewardCardId: cardE.id });
    assert.equal((await rawOrder(cardTab)).rewardCardId, cardE.id, "landmark: the tab already carries a card");
    const walletMid = await rawCustomer(e);
    const onCard = await settlePoints(api, cardTab, N);
    assert.equal(onCard.status, 409);
    assert.equal(onCard.body.error, ONE_REWARD_PER_BILL);
    assert.deepEqual(await rawCustomer(e), walletMid, "nothing spent for the rewarded tab");
    assert.equal(await pointsSpentTotal(e), 0, "landmark: the wallet still holds every point");

    const plain = await openTab(api, e, bill350());
    const restore = beforeOrderCas(async () => {
      await Order.collection.updateOne({ _id: oid(plain) }, { $set: { promoCode: PROMO_CODE } });
    });
    let late: Res;
    try {
      late = await settlePoints(api, plain, N);
    } finally {
      restore();
    }
    assert.equal(late.status, 409, `the marker landed after the read - got ${late.status}: ${late.body.error ?? ""}`);
    assert.equal((await rawOrder(plain)).promoCode, PROMO_CODE, "landmark: the marker really landed");
    assert.equal("rewardPoints" in (await rawOrder(plain)), false);
    await assertLotUntouched(e, fresh, "the lot after the missed settle");
    const records = await spendsOf(e);
    assert.equal(records.length, 1, "landmark: the points WERE spent before the miss");
    assert.ok(records[0].returnedAt instanceof Date, "and went back");
  });

  await scenario("p11", "gates: diner accounts OFF refuses points (400, nothing spent); levels switched OFF and the Tamil Nadu scratch block still spend (a held lot is the diner's)", async () => {
    const l0 = lot(100, hoursFromNow(24));
    const off = await diner([l0]);
    await seedSettings({ accounts: false });
    const id = await openTab(api, off, bill350());
    const refused = await settlePoints(api, id, N);
    assert.equal(refused.status, 400, `accounts off: got ${refused.status} ${refused.body.error ?? ""}`);
    assert.equal(refused.body.error, POINTS_NOT_ENOUGH);
    const sale = await api.create(payNowBody(off, bill350(), N));
    assert.equal(sale.status, 400, "and Pay-Now too");
    assert.equal(await ordersOf(off.id), 1, "only the open tab exists");
    await assertLotUntouched(off, l0, "the accounts-off attempts");

    const l1 = lot(100, hoursFromNow(24));
    const l2 = lot(100, hoursFromNow(24));
    const d = await diner([l1, l2]);
    const levelsOff = (await seedSettings({ levels: false })) as unknown as ISettings;
    assert.equal(rewardLevelsEarning(levelsOff, {} as NodeJS.ProcessEnv), false, "landmark: levels are OFF (no earning)");
    const a = await settlePoints(api, await openTab(api, d, bill350()), N);
    assert.equal(a.status, 200, `levels off still spends - got ${a.status}: ${a.body.error ?? ""}`);
    assert.equal(a.body.data!.discount, N);

    const blocked = (await seedSettings({ blocked: true })) as unknown as ISettings;
    assert.equal(scratchCardsBlockedFor(blocked, {} as NodeJS.ProcessEnv), true, "landmark: scratch is blocked for this cafe");
    assert.equal(rewardLevelsEarning(blocked, {} as NodeJS.ProcessEnv), false);
    const b = await api.create(payNowBody(d, bill350(), N));
    assert.equal(b.status, 201, `the block still spends - got ${b.status}: ${b.body.error ?? ""}`);
    assert.equal(b.body.data!.discount, N);
    assert.equal(await pointsSpentTotal(d), 2 * N);
  });

  await scenario("p12", "strict-mode round trip: the new fields survive (record keys, Order.rewardPoints), an undeclared key is dropped, and select:false hides rewardCards / pointsSpends from a plain read", async () => {
    await seedSettings();
    const l = lot(100, hoursFromNow(24));
    const d = await diner([l]);
    const id = await openTab(api, d, bill350());
    assert.equal((await settlePoints(api, id, N)).status, 200);
    const [open] = await spendsOf(d);
    assert.deepEqual(Object.keys(open).sort(), ["at", "lots", "orderId"], "an open record: exactly the declared keys, no returnedAt");
    assert.deepEqual(Object.keys(open.lots[0]).sort(), ["id", "take"]);
    const viaModel = await Order.findById(id).lean();
    assert.equal(viaModel?.rewardPoints, N, "Order.rewardPoints survives the model on read");
    const plainRead = (await Customer.findById(d.id).lean()) as unknown as Record<string, unknown>;
    assert.equal(plainRead.name, "Scratch Diner", "landmark: the plain read returns the row");
    assert.equal("pointsSpends" in plainRead, false, "select:false hides pointsSpends");
    assert.equal("rewardCards" in plainRead, false, "and rewardCards");
    const named = (await Customer.findById(d.id).select("+pointsSpends").lean()) as unknown as { pointsSpends?: unknown[] };
    assert.equal(named.pointsSpends?.length, 1, "an explicit +pointsSpends returns it");
    assert.equal((await api.cancel(id, "round trip")).status, 200);
    const [closed] = await spendsOf(d);
    assert.deepEqual(Object.keys(closed).sort(), ["at", "lots", "orderId", "returnedAt"], "a closed record gains exactly returnedAt");
    await Customer.updateOne({ _id: d.id }, { $push: { pointsSpends: { orderId: "LIVE-P12-X", at: new Date(), lots: [{ id: l.id, take: 1, sneaky: 1 }], sneaky: 1 } } } as never);
    const pushed = (await spendsOf(d)).find((r) => r.orderId === "LIVE-P12-X");
    assert.ok(pushed, "landmark: the pushed record is stored");
    assert.equal("sneaky" in pushed, false, "an undeclared key on a record is dropped");
    assert.equal("sneaky" in pushed.lots[0], false, "and on a lot entry");
    assert.equal((await lotOf(d, l.id)).kind, "points");
  });
}
