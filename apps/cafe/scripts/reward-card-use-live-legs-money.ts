/**
 * CB-7 S5b live legs F1, F2, F3 (arbiter-confirmed money bugs in the staff order writers). Part of
 * verify-reward-card-use-live.ts. (ops CLI support module, not app code.)
 *
 * F1  minBill must gate the bill WITHOUT the reward: the POS sends `discount` = the reward's own preview amount when a
 *     rung / card is picked, so a gate priced from that figure double-counts the reward and refuses a bill that meets it.
 * F2  a promo code together with the GST preset is refused at create (the promo's rupees were ignored and the once-per-
 *     customer fence burned); a promo tab that already carries "gst" must keep re-sending it without a 409.
 * F3  a same-key retry that loses the reward resolve (the twin already spent the card) must answer the landed order, not
 *     a definite 400 the client would treat as "never sent" and re-ring under a new key.
 *
 * Every payload is the REAL POS shape (discount = the preview amount, discountKind null) - a bare payload skips the branch.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

import { Customer } from "@/models/Customer";
import { Order } from "@/models/Order";
import { PromoRedemption } from "@/models/PromoRedemption";
import { PROMO_BLOCKS_GST_DISCOUNT_MESSAGE } from "@/lib/receipt";
import { REWARD_CARD_CLAIM_DEPS } from "@/lib/reward-card-claim";
import { CARD_BILL_TOO_SMALL } from "@pos/shared/reward-card-use";
import {
  PROMO_CODE, RUNG_AT, assertCardUntouched, cardOf, diner, line, openTab, ordersOf, rawOrder, revealed, roundBody, seedSettings,
  settleBody, tabBody, type Ctx, type Rec, type Res,
} from "./reward-card-use-live-kit";

const FLAT = 100;
const MIN_BILL = 500;
const STAMPS = 10;
const REPLAY_STATUSES = [200, 201];

const stampsOf = async (id: string): Promise<unknown> => (await Customer.collection.findOne({ _id: new mongoose.Types.ObjectId(id) }))?.stamps;

// Parks the FIRST card read (the twin's, after its top replay read missed) until `release()`; every later read passes.
function parkFirstCardRead(): { entered: Promise<void>; release: () => void; restore: () => void } {
  const real = REWARD_CARD_CLAIM_DEPS.readCard;
  let release: () => void = () => undefined;
  let enter: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const entered = new Promise<void>((resolve) => (enter = resolve));
  let calls = 0;
  REWARD_CARD_CLAIM_DEPS.readCard = async (customerId, cardId) => {
    calls += 1;
    if (calls === 1) {
      enter();
      await gate;
    }
    return real(customerId, cardId);
  };
  return { entered, release, restore: () => { REWARD_CARD_CLAIM_DEPS.readCard = real; } };
}

export async function runMoneyLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const tea = (qty = 1) => line(menu.tea, "Masala Tea", 100, qty);
  const brownie = () => line(menu.brownie, "Brownie", 150, 1);
  // 150 + 4 x 100 = 550: meets a 500 minimum, and 450 after the Rs 100 reward does not.
  const bill550 = () => [brownie(), tea(4)];
  const landed = (res: Res, what: string): Rec => {
    assert.ok(res.body.data, `${what}: ${res.status} ${res.body.error ?? ""}`);
    return res.body.data;
  };

  await scenario("s1a", "F1 card create with the POS payload (discount = the Rs 100 preview): a Rs 550 bill meets minBill 500 -> 201, total 450; a Rs 450 bill is still refused", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT, minBill: MIN_BILL });
    const d = await diner([c]);
    const small = await api.create(tabBody(d, [brownie(), tea(3)], { discount: FLAT, discountKind: null, rewardCardId: c.id, total: 350 }));
    assert.equal(small.status, 400, "witness: a bill under the minimum is still refused");
    assert.equal(small.body.error, CARD_BILL_TOO_SMALL);
    await assertCardUntouched(d, c, "the under-minimum create");
    const res = await api.create(tabBody(d, bill550(), { discount: FLAT, discountKind: null, rewardCardId: c.id, total: 450 }));
    assert.equal(res.status, 201, `the bill meets the minimum - got ${res.status}: ${res.body.error ?? ""}`);
    const order = landed(res, "create");
    assert.equal(order.discount, FLAT);
    assert.equal(order.total, 450);
    assert.equal((await cardOf(d, c.id)).status, "used");
  });

  await scenario("s1b", "F1 card add-round with the POS payload: a tab growing to Rs 550 meets minBill 500 -> 200, total 450, card used", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT, minBill: MIN_BILL });
    const d = await diner([c]);
    const id = await openTab(api, d, [brownie(), tea(3)]);
    const res = await api.addRound(id, roundBody([tea()], { discount: FLAT, rewardCardId: c.id }));
    assert.equal(res.status, 200, `the full tab meets the minimum - got ${res.status}: ${res.body.error ?? ""}`);
    assert.equal(landed(res, "add-round").total, 450);
    assert.equal((await cardOf(d, c.id)).status, "used");
  });

  await scenario("s1c", "F1 stamp rung create with the POS payload: a flat Rs 100 rung with minBill 500 on a Rs 550 bill -> 201, 8 stamps spent", async () => {
    await seedSettings({ rungMinBill: MIN_BILL });
    const d = await diner([], { stamps: STAMPS });
    const res = await api.create(tabBody(d, bill550(), { discount: FLAT, discountKind: null, rewardAt: RUNG_AT, total: 450 }));
    assert.equal(res.status, 201, `the bill meets the rung's minimum - got ${res.status}: ${res.body.error ?? ""}`);
    assert.equal(landed(res, "create").total, 450);
    assert.equal(await stampsOf(d.id), STAMPS - RUNG_AT);
  });

  await scenario("s1d", "F1 stamp rung add-round with the POS payload: a tab growing to Rs 550 meets the rung's minBill 500 -> 200, 8 stamps spent", async () => {
    await seedSettings({ rungMinBill: MIN_BILL });
    const d = await diner([], { stamps: STAMPS });
    const id = await openTab(api, d, [brownie(), tea(3)]);
    const res = await api.addRound(id, roundBody([tea()], { discount: FLAT, rewardAt: RUNG_AT }));
    assert.equal(res.status, 200, `add-round meets the rung's minimum - got ${res.status}: ${res.body.error ?? ""}`);
    assert.equal(landed(res, "add-round").total, 450);
    assert.equal(await stampsOf(d.id), STAMPS - RUNG_AT);
  });

  await scenario("s1e", "F1 card settle with the POS payload (discount = the preview): the minimum is gated on the bill without the card", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT, minBill: MIN_BILL });
    const e = await diner([c]);
    const tab = await openTab(api, e, bill550());
    const stored = await rawOrder(tab);
    const settled = await api.settle(tab, settleBody(stored, { discount: FLAT, rewardCardId: c.id }));
    assert.equal(settled.status, 200, `settle meets the card's minimum - got ${settled.status}: ${settled.body.error ?? ""}`);
    assert.equal(landed(settled, "settle").total, 450);
    assert.equal((await cardOf(e, c.id)).status, "used");
  });

  await scenario("s2a", "F2 create with a promo code AND the GST preset: 400 PROMO_BLOCKS_GST_DISCOUNT, no order, no fence row burned; the same code without the preset still lands", async () => {
    await seedSettings({ gst: true, oncePromo: true });
    await PromoRedemption.deleteMany({});
    const d = await diner([]);
    const res = await api.create(tabBody(d, bill550(), { promoCode: PROMO_CODE, discountKind: "gst", discount: 0 }));
    assert.equal(res.status, 400, `got ${res.status}: ${res.body.error ?? ""}`);
    assert.equal(res.body.error, PROMO_BLOCKS_GST_DISCOUNT_MESSAGE);
    assert.equal(await ordersOf(d.id), 0, "no order was written");
    assert.equal(await PromoRedemption.countDocuments({ code: PROMO_CODE }), 0, "nothing was fenced");
    const witness = await api.create(tabBody(d, bill550(), { promoCode: PROMO_CODE, discount: 0 }));
    assert.equal(witness.status, 201, `witness: the once-per-customer code is still unspent - got ${witness.status}: ${witness.body.error ?? ""}`);
    assert.equal(landed(witness, "create").discount, 50);
    assert.equal(await PromoRedemption.countDocuments({ code: PROMO_CODE }), 1, "witness: the fence row is written by a lawful create");
  });

  await scenario("s2b", "F2 a promo tab that already stores kind gst (the shape the old create wrote): the resumed POS re-sending gst on add-round and settle lands 200, kind and marker unchanged", async () => {
    await seedSettings({ gst: true });
    const d = await diner([]);
    const id = await openTab(api, d, bill550(), { promoCode: PROMO_CODE });
    await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { discountKind: "gst" } });
    const before = await rawOrder(id);
    assert.equal(before.promoCode, PROMO_CODE, "landmark: the tab carries the promo marker");
    const round = await api.addRound(id, roundBody([tea()], { discount: before.discount, discountKind: "gst" }));
    assert.equal(round.status, 200, `a re-sent kind the tab already has is not a switch - got ${round.status}: ${round.body.error ?? ""}`);
    const mid = await rawOrder(id);
    assert.equal(mid.discountKind, "gst");
    assert.equal(mid.promoCode, PROMO_CODE);
    const settled = await api.settle(id, settleBody(mid, { discountKind: "gst" }));
    assert.equal(settled.status, 200, `settle - got ${settled.status}: ${settled.body.error ?? ""}`);
    const after = await rawOrder(id);
    assert.equal(after.discountKind, "gst");
    assert.equal(after.promoCode, PROMO_CODE);
  });

  await scenario("s2c", "F2 witness: switching INTO gst on a promo tab that has no gst kind is still 409 (add-round and settle), the promo money kept", async () => {
    await seedSettings({ gst: true });
    const d = await diner([]);
    const id = await openTab(api, d, bill550(), { promoCode: PROMO_CODE });
    const before = await rawOrder(id);
    assert.equal(before.promoCode, PROMO_CODE, "landmark: the tab carries the promo marker");
    assert.equal(before.discountKind, undefined, "landmark: no kind stored");
    const round = await api.addRound(id, roundBody([tea()], { discount: before.discount, discountKind: "gst" }));
    assert.equal(round.status, 409);
    assert.equal(round.body.error, PROMO_BLOCKS_GST_DISCOUNT_MESSAGE);
    const settled = await api.settle(id, settleBody(before, { discountKind: "gst" }));
    assert.equal(settled.status, 409);
    assert.equal(settled.body.error, PROMO_BLOCKS_GST_DISCOUNT_MESSAGE);
    const after = await rawOrder(id);
    assert.equal(after.discount, before.discount, "the promo money survives");
    assert.equal(after.kotRounds, 1, "no round landed");
  });

  await scenario("s3a", "F3 create: a same-key retry parked past its replay read, whose twin then spends the card, answers the landed order (never a 400)", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c]);
    const key = randomUUID();
    const body = tabBody(d, bill550(), { discount: 0, discountKind: null, rewardCardId: c.id, idemKey: key });
    const park = parkFirstCardRead();
    let a: Res;
    let b: Res;
    try {
      const pendingB = api.create(body);
      await park.entered;
      a = await api.create(body);
      park.release();
      b = await pendingB;
    } finally {
      park.restore();
    }
    assert.equal(a.status, 201, `fixture: the original lands - got ${a.status}: ${a.body.error ?? ""}`);
    assert.ok(REPLAY_STATUSES.includes(b.status), `the retry must answer the landed order - got ${b.status}: ${b.body.error ?? ""}`);
    assert.equal(String(landed(b, "retry")._id), String(landed(a, "original")._id), "and it is the SAME order");
    assert.equal(await Order.collection.countDocuments({ idemKey: key }), 1, "exactly one order carries the key");
    assert.equal((await cardOf(d, c.id)).status, "used");
  });

  await scenario("s3b", "F3 add-round: a same-key retry parked past its replay read, whose twin then spends the card, answers the landed round (never a 400)", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c]);
    const id = await openTab(api, d, [brownie(), tea(3)]);
    const key = randomUUID();
    const body = roundBody([tea()], { rewardCardId: c.id, idemKey: key });
    const park = parkFirstCardRead();
    let a: Res;
    let b: Res;
    try {
      const pendingB = api.addRound(id, body);
      await park.entered;
      a = await api.addRound(id, body);
      park.release();
      b = await pendingB;
    } finally {
      park.restore();
    }
    assert.equal(a.status, 200, `fixture: the original round lands - got ${a.status}: ${a.body.error ?? ""}`);
    assert.equal(b.status, 200, `the retry must answer the landed round - got ${b.status}: ${b.body.error ?? ""}`);
    const tab = await rawOrder(id);
    assert.equal(tab.kotRounds, 2, "exactly one round landed");
    assert.deepEqual(((tab.kotIdemKeys ?? []) as string[]).filter((k) => k === key), [key]);
    assert.equal((await cardOf(d, c.id)).status, "used");
  });

}
