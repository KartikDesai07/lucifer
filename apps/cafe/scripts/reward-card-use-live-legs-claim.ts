/**
 * CB-7 S5 live legs a-g (claim lifecycle): priced + settled, the claim race, the use-by instant, identity, cancel /
 * release, a definite non-write releasing, the promo fence. Part of verify-reward-card-use-live.ts. (ops CLI support
 * module, not app code.)
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Order } from "@/models/Order";
import { claimRewardCard } from "@/lib/reward-card-claim";
import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";
import { CARD_NOT_USABLE } from "@pos/shared/reward-card-use";
import {
  PROMO_CODE, assertCardUntouched, barrier, beforeCardClaim, cardOf, diner, hoursFromNow, line, openTab, ordersOf,
  rawOrder, revealed, seedSettings, settleBody, tabBody, type Ctx,
} from "./reward-card-use-live-kit";

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const FLAT = 100;
const HALF = 50;

export async function runClaimLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const cake = (qty = 1) => line(menu.cake, "Cake", 100, qty);
  const tea = () => line(menu.tea, "Masala Tea", 100);
  const brownie = () => line(menu.brownie, "Brownie", 150);

  await scenario("a", "a bill-flat Rs 100 card: create 201 priced (discount 100, kind reward), card used keyed on the landed orderId, NO rewardAt/rewardStamps; settle keeps the discount", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c]);
    const res = await api.create(tabBody(d, [cake(2), brownie()], { rewardCardId: c.id }));
    assert.equal(res.status, 201, `create must land - got ${res.status}: ${res.body.error ?? ""}`);
    const data = res.body.data!;
    assert.equal(data.discount, FLAT, "the server priced the card's Rs 100");
    assert.equal(data.discountKind, "reward");
    assert.equal(data.total, 250, "350 - 100");
    const id = String(data._id);
    const doc = await rawOrder(id);
    assert.equal(doc.rewardCardId, c.id, "landmark: the order carries the card id");
    assert.equal(doc.rewardKind, "flat");
    assert.equal(doc.rewardValue, FLAT);
    for (const key of ["rewardAt", "rewardStamps"]) assert.equal(key in doc, false, `a card order must store no ${key}`);
    const used = await cardOf(d, c.id);
    assert.equal(used.status, "used");
    assert.equal(used.orderId, data.orderId, "keyed on the orderId that landed");
    assert.ok(used.usedAt instanceof Date, "usedAt is stamped");
    assert.deepEqual(used.keepUntil, used.usedAt, "keepUntil follows usedAt");
    const settled = await api.settle(id, settleBody(doc));
    assert.equal(settled.status, 200, `settle must land - got ${settled.status}: ${settled.body.error ?? ""}`);
    assert.equal(settled.body.data!.status, "Completed");
    assert.equal(settled.body.data!.discount, FLAT, "settle re-prices from the card snapshot - the discount survives");
    assert.equal(settled.body.data!.total, 250);
    assert.equal((await cardOf(d, c.id)).orderId, data.orderId, "the card stays spent on the same order");
  });

  await scenario("b", "two concurrent creates spending ONE card (both held at the claim): exactly one 201, the other 409 CARD_NOT_USABLE with no Order; card.orderId = the winner's", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c]);
    const restore = beforeCardClaim(barrier(2));
    let results;
    try {
      results = await Promise.all([1, 2].map(() => api.create(tabBody(d, [cake(2)], { rewardCardId: c.id }))));
    } finally {
      restore();
    }
    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status === 409);
    assert.equal(won.length, 1, `exactly one create wins - got ${results.map((r) => r.status).join(",")}`);
    assert.equal(lost.length, 1, "the other is a 409");
    assert.equal(lost[0].body.error, CARD_NOT_USABLE);
    assert.equal(await ordersOf(d.id), 1, "the loser left no Order");
    assert.equal((await cardOf(d, c.id)).orderId, won[0].body.data!.orderId, "the card belongs to the winner");
  });

  await scenario("c", "the use-by instant: claim at now == validUntil lands, at +1 ms is refused; the route refuses a card already past its deadline", async () => {
    await seedSettings();
    const onTime = revealed({ validUntil: hoursFromNow(1) });
    const late = revealed({ validUntil: hoursFromNow(1) });
    const d = await diner([onTime, late]);
    assert.equal(await claimRewardCard(d.id, onTime.id, "LIVE-C-1", onTime.validUntil!), true, "the deadline instant is still usable ($gte)");
    assert.equal((await cardOf(d, onTime.id)).status, "used");
    assert.equal(await claimRewardCard(d.id, late.id, "LIVE-C-2", new Date(late.validUntil!.getTime() + 1)), false, "one millisecond past is expired");
    await assertCardUntouched(d, late, "the +1 ms claim");
    const gone = revealed({ validUntil: new Date(Date.now() - 1000) });
    const e = await diner([gone]);
    const res = await api.create(tabBody(e, [cake(2)], { rewardCardId: gone.id }));
    assert.equal(res.status, 400, "an expired card is refused before any claim");
    assert.equal(res.body.error, CARD_NOT_USABLE);
    assert.equal(await ordersOf(e.id), 0, "no order written");
    await assertCardUntouched(e, gone, "the expired card");
  });

  await scenario("d", "another customer's card id on my bill: refused (CARD_NOT_USABLE), no order, the owner's card untouched; the lib claim misses too", async () => {
    await seedSettings();
    const theirs = revealed();
    const owner = await diner([theirs]);
    const thief = await diner([]);
    const res = await api.create(tabBody(thief, [cake(2)], { rewardCardId: theirs.id }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error, CARD_NOT_USABLE);
    assert.equal(await ordersOf(thief.id), 0);
    assert.equal(await claimRewardCard(thief.id, theirs.id, "LIVE-D-1", new Date()), false, "the CAS is keyed on the diner's own row");
    await assertCardUntouched(owner, theirs, "the owner's card");
  });

  await scenario("e", "cancel gives the card back (revealed, keepUntil = validUntil, no usedAt/orderId); a new order then re-claims it", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: HALF });
    const d = await diner([c]);
    const first = await api.create(tabBody(d, [cake(2)], { rewardCardId: c.id }));
    assert.equal(first.status, 201);
    assert.equal((await cardOf(d, c.id)).status, "used", "landmark: the card is spent before the cancel");
    const cancelled = await api.cancel(String(first.body.data!._id), "customer left");
    assert.equal(cancelled.status, 200, `cancel must land - got ${cancelled.status}: ${cancelled.body.error ?? ""}`);
    await assertCardUntouched(d, c, "after the cancel");
    const again = await api.create(tabBody(d, [cake(2)], { rewardCardId: c.id }));
    assert.equal(again.status, 201, "the released card is claimable again");
    const stored = await cardOf(d, c.id);
    assert.equal(stored.status, "used");
    assert.equal(stored.orderId, again.body.data!.orderId);
    assert.notEqual(stored.orderId, first.body.data!.orderId, "now keyed on the NEW order");
  });

  await scenario("f", "an add-round whose order CAS misses (a concurrent round lands between the claim and the write): 409 and the card is revealed again; a fresh retry then lands", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: HALF });
    const d = await diner([c]);
    const id = await openTab(api, d, [cake(2)]);
    const before = await rawOrder(id);
    const body = { items: [tea()], discount: 0, discountKind: null, rewardCardId: c.id };
    const restore = beforeCardClaim(async () => {
      await Order.collection.updateOne({ _id: oid(id) }, { $inc: { kotRounds: 1 } });
    });
    let res;
    try {
      res = await api.addRound(id, body);
    } finally {
      restore();
    }
    assert.equal(res.status, 409, `the round must miss - got ${res.status}: ${res.body.error ?? ""}`);
    await assertCardUntouched(d, c, "the missed round");
    const doc = await rawOrder(id);
    assert.equal(doc.kotRounds, (before.kotRounds as number) + 1, "landmark: the concurrent round (our injected bump) is the only change");
    assert.equal("rewardCardId" in doc, false, "the missed round wrote no reward");
    assert.equal((doc.items as unknown[]).length, 1, "and no item");
    const retry = await api.addRound(id, body);
    assert.equal(retry.status, 200, `a fresh retry must land - got ${retry.status}: ${retry.body.error ?? ""}`);
    assert.equal(retry.body.data!.discount, HALF);
    assert.equal((await cardOf(d, c.id)).orderId, before.orderId, "the retry spent the released card on the tab");
  });

  await scenario("g", "promo fence: a promo tab refuses a card (409 PROMO_BLOCKS_REWARD, promo money kept); promo + card on create is a 400; a marker landing mid-flight makes the CAS miss and the card goes back", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c]);
    const promoTab = await openTab(api, d, [cake(2)], { promoCode: PROMO_CODE });
    const promoDoc = await rawOrder(promoTab);
    assert.equal(promoDoc.promoCode, PROMO_CODE, "landmark: the create route wrote the promo marker");
    assert.equal(promoDoc.discount, HALF, "landmark: the promo's Rs 50 is on the tab");
    const refused = await api.addRound(promoTab, { items: [tea()], discount: HALF, discountKind: null, rewardCardId: c.id });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, PROMO_BLOCKS_REWARD);
    const after = await rawOrder(promoTab);
    assert.equal(after.discount, HALF, "the promo discount is kept");
    assert.equal(after.kotRounds, 1, "no second round landed");
    assert.equal("rewardCardId" in after, false);
    await assertCardUntouched(d, c, "the promo-blocked round");

    const both = await api.create(tabBody(d, [cake(2)], { rewardCardId: c.id, promoCode: PROMO_CODE }));
    assert.equal(both.status, 400, "a card and a promo on one create");
    assert.equal(both.body.error, PROMO_BLOCKS_REWARD);
    assert.equal(await ordersOf(d.id), 1, "only the promo tab exists - the refused create wrote nothing");
    await assertCardUntouched(d, c, "the card + promo create");

    const plain = await openTab(api, d, [cake(2)]);
    const restore = beforeCardClaim(async () => {
      await Order.collection.updateOne({ _id: oid(plain) }, { $set: { promoCode: PROMO_CODE } });
    });
    let late;
    try {
      late = await api.addRound(plain, { items: [tea()], discount: 0, discountKind: null, rewardCardId: c.id });
    } finally {
      restore();
    }
    assert.equal(late.status, 409, `the marker landed after the read - got ${late.status}: ${late.body.error ?? ""}`);
    assert.equal((await rawOrder(plain)).promoCode, PROMO_CODE, "landmark: the marker really landed");
    assert.equal("rewardCardId" in (await rawOrder(plain)), false);
    await assertCardUntouched(d, c, "the mid-flight marker");
  });
}
