/**
 * CB-7 S5 live legs m and o (the QR path and the card tab's life): the diner's submit gates and the staff accept
 * (claimed + priced / used elsewhere / unfunded), then a card tab surviving a table move, a QR add-round and voids.
 * Part of verify-reward-card-use-live.ts. (ops CLI support module, not app code.)
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Customer } from "@/models/Customer";
import { OrderRequest } from "@/models/OrderRequest";
import { REWARD_UNFUNDED_ERROR } from "@/lib/order-request-accept-reward";
import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";
import { CARD_NEEDS_SIGN_IN } from "@pos/shared/reward-card-use";
import { orderLineKey } from "@pos/shared/utils";
import type { RewardCardSnapshot } from "@pos/shared/reward-levels";
import {
  PROMO_CODE, TABLE_TOKEN_2, assertCardUntouched, beforeCardClaim, cardOf, coffeeLines, diner, dinerSession, line, ordersOf,
  rawOrder, revealed, seedSettings, setDinerCookie, tabBody, type Ctx, type Diner, type Rec,
} from "./reward-card-use-live-kit";

const FLAT = 40;
const STRANGER_MOBILE = "9111111111";
const OTHER_ORDER = "LIVE-ELSEWHERE-1";
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const requestOf = async (shortCode: string): Promise<Rec> => ((await OrderRequest.collection.findOne({ shortCode })) ?? {}) as Rec;

// The card spent by some OTHER order, straight on the row (a used card, as the claim CAS would leave it).
async function spendElsewhere(d: Diner, cardId: string): Promise<void> {
  const now = new Date();
  await Customer.collection.updateOne(
    { _id: oid(d.id), "rewardCards.id": cardId },
    { $set: { "rewardCards.$.status": "used", "rewardCards.$.usedAt": now, "rewardCards.$.keepUntil": now, "rewardCards.$.orderId": OTHER_ORDER } },
  );
}

export async function runQrLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const cake = (qty = 1) => line(menu.cake, "Cake", 100, qty);
  const qrItems = (productId: string, qty: number) => [{ productId, modifiers: [], qty }];
  const submit = (d: { mobile: string }, extra: Rec = {}) =>
    api.submitQr({ target: { kind: "parcel" }, items: qrItems(menu.cake, 2), name: "Card Diner", mobile: d.mobile, ...extra });
  // A signed-in diner holding one revealed bill-flat card.
  async function signedIn(over: Partial<RewardCardSnapshot> = {}) {
    const c = revealed({ kind: "bill-flat", value: FLAT, ...over });
    const d = await diner([c]);
    setDinerCookie(await dinerSession(d));
    return { c, d };
  }
  const submitted = async (d: Diner, c: RewardCardSnapshot): Promise<{ shortCode: string; requestId: string }> => {
    const res = await submit(d, { requestedCardId: c.id });
    assert.equal(res.status, 201, `fixture: the valid submit must land - got ${res.status}: ${res.body.error ?? ""}`);
    const shortCode = String(res.body.data!.shortCode);
    return { shortCode, requestId: String((await requestOf(shortCode))._id) };
  };

  try {
    await scenario("m1", "QR submit with a card and NO diner session: refused (CARD_NEEDS_SIGN_IN), no request stored", async () => {
      await seedSettings();
      const c = revealed({ kind: "bill-flat", value: FLAT });
      const d = await diner([c]);
      setDinerCookie(null);
      const before = await OrderRequest.countDocuments();
      const res = await submit(d, { requestedCardId: c.id });
      assert.equal(res.status, 422);
      assert.equal(res.body.error, CARD_NEEDS_SIGN_IN);
      assert.equal(await OrderRequest.countDocuments(), before, "nothing was stored");
      await assertCardUntouched(d, c, "the unsigned submit");
    });

    await scenario("m2", "QR submit by diner B with diner A's mobile and A's card: refused (the session's mobile must be the body's), A's card untouched", async () => {
      await seedSettings();
      const c = revealed({ kind: "bill-flat", value: FLAT });
      const a = await diner([c]);
      const b = await diner([]);
      setDinerCookie(await dinerSession(b));
      const res = await submit(a, { requestedCardId: c.id });
      assert.equal(res.status, 422);
      assert.equal(res.body.error, CARD_NEEDS_SIGN_IN);
      await assertCardUntouched(a, c, "the other diner's submit");
      setDinerCookie(await dinerSession(a));
      const own = await submit(a, { requestedCardId: c.id });
      assert.equal(own.status, 201, `witness: the owner's own submit passes the identity gate - got ${own.status}: ${own.body.error ?? ""}`);
    });

    await scenario("m3", "QR submit with a promo code AND a card: refused (PROMO_BLOCKS_REWARD)", async () => {
      await seedSettings();
      const { c, d } = await signedIn();
      const res = await submit(d, { requestedCardId: c.id, promoCode: PROMO_CODE });
      assert.equal(res.status, 422);
      assert.equal(res.body.error, PROMO_BLOCKS_REWARD);
      await assertCardUntouched(d, c, "the promo + card submit");
    });

    await scenario("m4", "QR submit with a valid card: the request stores requestedCardId and NOTHING is claimed (card still revealed)", async () => {
      await seedSettings();
      const { c, d } = await signedIn();
      const { shortCode } = await submitted(d, c);
      assert.equal((await requestOf(shortCode)).requestedCardId, c.id, "the intent is stored on the request");
      await assertCardUntouched(d, c, "the submit");
      assert.equal(await ordersOf(d.id), 0, "and no order yet");
    });

    await scenario("m5", "QR accept: the card is claimed keyed on the landed orderId and the order is priced with it (no rewardAt)", async () => {
      await seedSettings();
      const { c, d } = await signedIn();
      const { requestId } = await submitted(d, c);
      const res = await api.accept(requestId);
      assert.equal(res.status, 200, `accept must land - got ${res.status}: ${res.body.error ?? ""}`);
      const order = res.body.data!.order as Rec;
      assert.equal(order.discount, FLAT);
      assert.equal(order.total, 200 - FLAT);
      const doc = await rawOrder(String(order._id));
      assert.equal(doc.rewardCardId, c.id, "landmark: the accepted order carries the card");
      assert.equal("rewardAt" in doc, false);
      assert.equal((await cardOf(d, c.id)).orderId, order.orderId, "keyed on the order that landed");
      assert.equal((await cardOf(d, c.id)).status, "used");
    });

    await scenario("m6", "QR accept after the card was used elsewhere: the order lands at FULL price with nothing claimed (the stale intent does not fail the food order)", async () => {
      await seedSettings();
      const { c, d } = await signedIn();
      const { requestId } = await submitted(d, c);
      await spendElsewhere(d, c.id);
      const res = await api.accept(requestId);
      assert.equal(res.status, 200, `the order still lands - got ${res.status}: ${res.body.error ?? ""}`);
      const order = res.body.data!.order as Rec;
      assert.equal(order.discount, 0);
      assert.equal(order.total, 200, "full price");
      const doc = await rawOrder(String(order._id));
      for (const key of ["rewardCardId", "discountKind"]) assert.equal(key in doc, false, `no ${key} on the order`);
      const stored = await cardOf(d, c.id);
      assert.equal(stored.status, "used", "landmark: the card is the other order's");
      assert.equal(stored.orderId, OTHER_ORDER, "and was not re-keyed");
    });

    await scenario("m7", "QR accept where the claim MISSES after the card resolved (spent in the window): 409 REWARD_UNFUNDED, request back to pending for staff to reject, no order, the card stays the other order's", async () => {
      await seedSettings();
      const { c, d } = await signedIn();
      const { shortCode, requestId } = await submitted(d, c);
      const restore = beforeCardClaim(() => spendElsewhere(d, c.id));
      let res;
      try {
        res = await api.accept(requestId);
      } finally {
        restore();
      }
      assert.equal(res.status, 409, `the accept must be refused - got ${res.status}`);
      assert.equal(res.body.error, REWARD_UNFUNDED_ERROR);
      assert.equal(await ordersOf(d.id), 0, "no discounted order was written");
      assert.equal((await requestOf(shortCode)).status, "pending", "reject() reverts the request so staff can reject it (the accept never half-lands)");
      assert.equal((await cardOf(d, c.id)).orderId, OTHER_ORDER, "the claim lost to the other order and left it alone");
    });

    await scenario("o", "a card tab keeps its discount (never Rs 0) through a table move, a QR add-round and two voids - re-priced from the stored snapshot", async () => {
      await seedSettings();
      const c = revealed({ kind: "product-percent", value: 20, productId: menu.coffee, productName: "Cold Coffee" });
      const d = await diner([c]);
      setDinerCookie(null);
      const made = await api.create(tabBody(d, [...coffeeLines(menu), cake()], { rewardCardId: c.id, tableNo: "T1" }));
      assert.equal(made.status, 201, `fixture: the card tab opens at T1 - got ${made.status}: ${made.body.error ?? ""}`);
      const id = String(made.body.data!._id);
      assert.equal(made.body.data!.discount, 36, "landmark: 20% of the Rs 180 unit");

      const moved = await api.moveTable(id, "T2");
      assert.equal(moved.status, 200, `the move lands - got ${moved.status}: ${moved.body.error ?? ""}`);
      assert.equal(moved.body.data!.tableNo, "T2");
      assert.equal(moved.body.data!.discount, 36, "a table move keeps the card's money");
      assert.equal(moved.body.data!.total, 364);

      const qr = await api.submitQr({ target: { kind: "table", token: TABLE_TOKEN_2 }, items: qrItems(menu.tea, 1), name: "Table Guest", mobile: STRANGER_MOBILE });
      assert.equal(qr.status, 201, `fixture: a plain QR round for the card tab's table - got ${qr.status}: ${qr.body.error ?? ""}`);
      const accepted = await api.accept(String((await requestOf(String(qr.body.data!.shortCode)))._id));
      assert.equal(accepted.status, 200, `the QR round lands on the tab - got ${accepted.status}: ${accepted.body.error ?? ""}`);
      const round = accepted.body.data!.order as Rec;
      assert.equal(round.kotRounds, 2, "landmark: it was an add-round onto the SAME tab");
      assert.equal(round.discount, 36, "a QR add-round re-prices from the snapshot");
      assert.equal(round.total, 464, "500 - 36");

      const voidAt = async (doc: Rec, productId: string, variation: string | undefined, expectedVoids: number) => {
        const lines = doc.items as Rec[];
        const index = lines.findIndex((l) => String(l.productId) === productId && l.variation === variation);
        assert.ok(index >= 0, "landmark: the line to void is on the tab");
        const stored = { ...lines[index], productId: String(lines[index].productId) } as Parameters<typeof orderLineKey>[0];
        return api.voidLine(id, { index, lineKey: orderLineKey(stored), qty: 1, expectedVoids, reason: "customer changed mind" });
      };
      const cakeVoid = await voidAt(await rawOrder(id), menu.cake, undefined, 0);
      assert.equal(cakeVoid.status, 200, `void lands - got ${cakeVoid.status}: ${cakeVoid.body.error ?? ""}`);
      assert.equal(cakeVoid.body.data!.discount, 36, "voiding an out-of-scope dish keeps the discount");
      const largeVoid = await voidAt(await rawOrder(id), menu.coffee, "Large", 1);
      assert.equal(largeVoid.status, 200, `void lands - got ${largeVoid.status}: ${largeVoid.body.error ?? ""}`);
      assert.equal(largeVoid.body.data!.discount, 24, "the dearest unit is now the Rs 120 one: 20% of 120, re-priced from the snapshot, never Rs 0");
      const doc = await rawOrder(id);
      assert.equal(doc.rewardCardId, c.id, "the card is still the bill's reward");
      assert.equal(doc.discountKind, "reward");
      assert.equal(await ordersOf(d.id), 1, "one order, one tab");
    });
  } finally {
    setDinerCookie(null);
  }
}
