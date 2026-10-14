/**
 * CB-7 S6 session 2 live legs q1-q7 (the diner's "Use my points" ASK on the QR path): the public order-request route's
 * gates with a real diner session, the stored intent, and the staff accept copying it as a HINT onto the Order. The ask
 * spends NOTHING at submit or at accept (staff spend at payment), so every leg also proves the wallet is untouched.
 * Part of verify-reward-points-live.ts. (ops CLI support module, not app code.)
 */
import assert from "node:assert/strict";

import mongoose from "mongoose";

import { Customer } from "@/models/Customer";
import { OrderRequest } from "@/models/OrderRequest";
import { POINTS_NEED_SIGN_IN, POINTS_NONE_TO_USE } from "@pos/shared/public-diner-cards";
import { PROMO_BLOCKS_REWARD, REWARD_ON_OPEN_TAB } from "@pos/shared/public-promo";
import { POINTS_REWARD_EXCLUSIVE } from "@pos/shared/reward-points";
import {
  PROMO_CODE, RUNG_AT, TABLE_TOKEN_1, diner, dinerSession, hoursFromNow, line, openTab, rawOrder, revealed, seedSettings, setDinerCookie, type Ctx,
  type Rec, type Res,
} from "./reward-card-use-live-kit";
import { assertLotUntouched, lot, lotsOf, spendsOf } from "./reward-points-live-kit";

const POINTS = 100;
const BILL_QTY = 2;
const STAMPS = 20;
// q7: a number no other leg uses (Customer.mobile is unique).
const FRESH_MOBILE = "9555500007";
const requestOf = async (shortCode: string): Promise<Rec> => ((await OrderRequest.collection.findOne({ shortCode })) ?? {}) as Rec;

export async function runQrPointsLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const qrItems = [{ productId: menu.cake, modifiers: [], qty: BILL_QTY }];
  const submit = (d: { mobile: string }, extra: Rec = {}, target: Rec = { kind: "parcel" }): Promise<Res> =>
    api.submitQr({ target, items: qrItems, name: "Points Diner", mobile: d.mobile, requestedPoints: true, ...extra });
  // A diner holding one revealed points lot, signed in (or not).
  async function holder(signedIn = true) {
    const l = lot(POINTS, hoursFromNow(24));
    const d = await diner([l]);
    setDinerCookie(signedIn ? await dinerSession(d) : null);
    return { l, d };
  }
  const nothingStored = async (what: string, before: number): Promise<void> =>
    assert.equal(await OrderRequest.countDocuments(), before, `${what}: no request was stored`);
  const refused = async (res: Res, message: string, what: string): Promise<void> => {
    assert.equal(res.status, 422, `${what}: got ${res.status} ${res.body.error ?? ""}`);
    assert.equal(res.body.error, message, what);
  };

  try {
    await scenario("q1", "QR submit with the points ask: 201, the request stores requestedPoints, the accept copies pointsRequested onto the Order, and NOTHING is spent (wallet byte-identical, no spend record)", async () => {
      await seedSettings();
      const { l, d } = await holder();
      const walletBefore = await lotsOf(d);
      const res = await submit(d);
      assert.equal(res.status, 201, `the ask must land - got ${res.status}: ${res.body.error ?? ""}`);
      const shortCode = String(res.body.data!.shortCode);
      const stored = await requestOf(shortCode);
      assert.equal(stored.requestedPoints, true, "the ask is stored on the request");
      assert.deepEqual(await lotsOf(d), walletBefore, "submit: the wallet is byte-identical");
      const accepted = await api.accept(String(stored._id));
      assert.equal(accepted.status, 200, `accept must land - got ${accepted.status}: ${accepted.body.error ?? ""}`);
      const order = accepted.body.data!.order as Rec;
      const doc = await rawOrder(String(order._id));
      assert.equal(doc.pointsRequested, true, "the accepted order carries the hint");
      assert.equal("rewardPoints" in doc, false, "and spent nothing (no rewardPoints)");
      assert.equal(order.discount, 0, "full price: the ask is not money");
      assert.deepEqual(await lotsOf(d), walletBefore, "accept: the wallet is byte-identical");
      assert.equal((await spendsOf(d)).length, 0, "and no pointsSpends record exists");
      await assertLotUntouched(d, l, "the lot after submit + accept");
    });

    await scenario("q2", "QR submit with the ask and nothing to use (no lots / a fully spent lot): refused POINTS_NONE_TO_USE, no request stored", async () => {
      await seedSettings();
      const empty = await diner([]);
      setDinerCookie(await dinerSession(empty));
      const before = await OrderRequest.countDocuments();
      await refused(await submit(empty), POINTS_NONE_TO_USE, "no lots");
      const spent = await diner([lot(POINTS, hoursFromNow(24), { pointsSpent: POINTS })]);
      setDinerCookie(await dinerSession(spent));
      await refused(await submit(spent), POINTS_NONE_TO_USE, "a fully spent lot");
      await nothingStored("zero balance", before);
      const { d } = await holder();
      assert.equal((await submit(d)).status, 201, "witness: a held balance passes the same body");
    });

    await scenario("q3", "QR submit with the ask AND another reward: a card / stamp rung -> POINTS_REWARD_EXCLUSIVE, a promo code -> PROMO_BLOCKS_REWARD (no request stored)", async () => {
      await seedSettings();
      const card = revealed({ kind: "bill-flat", value: 40 });
      const l = lot(POINTS, hoursFromNow(24));
      // Stamps for the rung too: the stamp gate runs BEFORE this one, so the rung must itself be affordable to reach it.
      const d = await diner([l, card], { stamps: STAMPS });
      setDinerCookie(await dinerSession(d));
      const before = await OrderRequest.countDocuments();
      await refused(await submit(d, { requestedCardId: card.id }), POINTS_REWARD_EXCLUSIVE, "points + a card");
      await refused(await submit(d, { requestedRewardAt: RUNG_AT }), POINTS_REWARD_EXCLUSIVE, "points + a stamp rung");
      await refused(await submit(d, { promoCode: PROMO_CODE }), PROMO_BLOCKS_REWARD, "points + a promo code");
      await nothingStored("exclusive rewards", before);
      await assertLotUntouched(d, l, "the refused submits");
    });

    await scenario("q4", "QR submit with the ask and no diner session, or diner A's session with diner B's mobile: refused POINTS_NEED_SIGN_IN, B's wallet untouched", async () => {
      await seedSettings();
      const { l, d: a } = await holder(false);
      const before = await OrderRequest.countDocuments();
      await refused(await submit(a), POINTS_NEED_SIGN_IN, "no session");
      const b = await diner([]);
      setDinerCookie(await dinerSession(b));
      await refused(await submit(a), POINTS_NEED_SIGN_IN, "B's session with A's mobile");
      await nothingStored("identity gates", before);
      await assertLotUntouched(a, l, "the other diner's submit");
      setDinerCookie(await dinerSession(a));
      assert.equal((await submit(a)).status, 201, "witness: the owner's own submit passes the identity gate");
    });

    await scenario("q5", "QR submit with the ask onto a table with a bill already running: refused REWARD_ON_OPEN_TAB, no request stored", async () => {
      await seedSettings();
      const { l, d } = await holder();
      await openTab(api, null, [line(menu.tea, "Masala Tea", 100)], { tableNo: "T1" });
      const before = await OrderRequest.countDocuments();
      await refused(await submit(d, {}, { kind: "table", token: TABLE_TOKEN_1 }), REWARD_ON_OPEN_TAB, "an open tab");
      await nothingStored("open tab", before);
      await assertLotUntouched(d, l, "the refused submit");
    });

    await scenario("q6", "gates: diner accounts OFF refuses the ask (POINTS_NONE_TO_USE); Reward Levels OFF and the Tamil Nadu scratch block with a balance still land (201) - held points stay usable", async () => {
      await seedSettings({ accounts: false });
      const { d: off } = await holder();
      const before = await OrderRequest.countDocuments();
      await refused(await submit(off), POINTS_NONE_TO_USE, "accounts off");
      await nothingStored("accounts off", before);

      await seedSettings({ levels: false });
      const { d: noLevels } = await holder();
      const a = await submit(noLevels);
      assert.equal(a.status, 201, `levels off still lands - got ${a.status}: ${a.body.error ?? ""}`);
      assert.equal((await requestOf(String(a.body.data!.shortCode))).requestedPoints, true);

      await seedSettings({ blocked: true });
      const { d: blocked } = await holder();
      const b = await submit(blocked);
      assert.equal(b.status, 201, `the scratch block still lands - got ${b.status}: ${b.body.error ?? ""}`);
      assert.equal((await requestOf(String(b.body.data!.shortCode))).requestedPoints, true);
    });
    await scenario("q7", "review LOW-2: a stale session (the admin moved A to a new number and gave A's old number to B) cannot ask: refused POINTS_NEED_SIGN_IN - the accept would attach B by that number and pre-tick B's points", async () => {
      await seedSettings();
      const { l, d: a } = await holder();
      const b = await diner([lot(POINTS, hoursFromNow(24))]);
      const oldNumber = a.mobile;
      // The admin edit, in this order (mobile is unique): A moves to a fresh number, then B takes A's old one.
      await Customer.collection.updateOne({ _id: new mongoose.Types.ObjectId(a.id) }, { $set: { mobile: FRESH_MOBILE } });
      await Customer.collection.updateOne({ _id: new mongoose.Types.ObjectId(b.id) }, { $set: { mobile: oldNumber } });
      const before = await OrderRequest.countDocuments();
      await refused(await submit(a), POINTS_NEED_SIGN_IN, "A's stale session with the number B now holds");
      await nothingStored("stale session", before);
      await assertLotUntouched(a, l, "A's lot");
      const bNow = { id: b.id, mobile: oldNumber };
      setDinerCookie(await dinerSession(bNow));
      assert.equal((await submit(bNow)).status, 201, "witness: the number's current owner passes");
    });
  } finally {
    setDinerCookie(null);
  }
}
