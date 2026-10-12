/**
 * CB-7 S5 live legs k, l, n, q (what a card may NOT do): reassign refused, one reward per bill, points / none never
 * claimable, the diner-accounts gate. Part of verify-reward-card-use-live.ts. (ops CLI support module, not app code.)
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Customer } from "@/models/Customer";
import { Order } from "@/models/Order";
import type { ISettings } from "@/models/Settings";
import { claimRewardCard } from "@/lib/reward-card-claim";
import { rewardLevelsEarning, scratchCardsBlockedFor } from "@/lib/reward-levels-config";
import { CARD_NOT_USABLE, CARD_REWARD_EXCLUSIVE, ONE_REWARD_PER_BILL, REWARD_REASSIGN_REFUSED } from "@pos/shared/reward-card-use";
import {
  RUNG_AT, assertCardUntouched, cardOf, diner, line, openTab, ordersOf, rawOrder, revealed, seedSettings, tabBody, type Ctx,
} from "./reward-card-use-live-kit";

const STAMPS = 20;
const FLAT = 100;
const stampsOf = async (id: string): Promise<unknown> => (await Customer.collection.findOne({ _id: new mongoose.Types.ObjectId(id) }))?.stamps;

type Writer = (filter: unknown, ...rest: unknown[]) => unknown;
// Runs `before` just before the next Order.findOneAndUpdate(...).lean() executes: a card landing between a PUT's read and its write.
function beforeOrderWrite(before: () => Promise<void>): () => void {
  const model = Order as unknown as { findOneAndUpdate: Writer };
  const real = model.findOneAndUpdate.bind(Order);
  model.findOneAndUpdate = (filter, ...rest) => ({
    lean: () => before().then(() => (real(filter, ...rest) as { lean: () => unknown }).lean()),
  });
  return () => {
    model.findOneAndUpdate = real;
  };
}

export async function runFenceLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const cake = (qty = 1) => line(menu.cake, "Cake", 100, qty);
  const tea = () => line(menu.tea, "Masala Tea", 100);

  await scenario("k", "PUT moving a card bill to another customer: 409 REWARD_REASSIGN_REFUSED, order unchanged; a plain bill still moves; a card landing between the PUT's read and write makes it miss", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT });
    const owner = await diner([c]);
    const other = await diner([]);
    const id = await openTab(api, owner, [cake(2)], { customerName: "Card Diner" });
    const claimed = await api.addRound(id, { items: [tea()], discount: 0, discountKind: null, rewardCardId: c.id });
    assert.equal(claimed.status, 200, `fixture: the card lands - got ${claimed.status}: ${claimed.body.error ?? ""}`);
    const before = await rawOrder(id);
    assert.equal(before.rewardCardId, c.id, "landmark: the bill carries the card");
    const res = await api.put(id, { customerId: other.id });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, REWARD_REASSIGN_REFUSED);
    assert.deepEqual(await rawOrder(id), before, "the order is byte-for-byte unchanged");

    const plain = await openTab(api, owner, [cake()]);
    const moved = await api.put(plain, { customerId: other.id });
    assert.equal(moved.status, 200, `witness: a bill with no reward may move - got ${moved.status}: ${moved.body.error ?? ""}`);
    assert.equal(String((await rawOrder(plain)).customerId), other.id);

    const second = revealed({ kind: "bill-flat", value: FLAT });
    const racer = await diner([second]);
    const racing = await openTab(api, racer, [cake(2)]);
    const restore = beforeOrderWrite(async () => {
      await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(racing) }, { $set: { rewardCardId: second.id } });
    });
    let late;
    try {
      late = await api.put(racing, { customerId: other.id });
    } finally {
      restore();
    }
    assert.equal(late.status, 409, `the stale PUT must match nothing - got ${late.status}: ${late.body.error ?? ""}`);
    const stuck = await rawOrder(racing);
    assert.equal(stuck.rewardCardId, second.id, "landmark: the card really landed first");
    assert.equal(String(stuck.customerId), racer.id, "and the bill stayed with its customer");
  });

  await scenario("l", "one reward per bill: card + stamp rung together is 400 CARD_REWARD_EXCLUSIVE (create and round); a second card, a stamp claim on a card bill and a card on a stamp bill are 409 ONE_REWARD_PER_BILL", async () => {
    await seedSettings();
    const c1 = revealed({ kind: "bill-flat", value: FLAT });
    const c2 = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c1, c2], { stamps: STAMPS });
    const both = await api.create(tabBody(d, [cake(2)], { rewardCardId: c1.id, rewardAt: RUNG_AT }));
    assert.equal(both.status, 400);
    assert.equal(both.body.error, CARD_REWARD_EXCLUSIVE);
    assert.equal(await ordersOf(d.id), 0);
    assert.equal(await stampsOf(d.id), STAMPS, "no stamps spent");
    await assertCardUntouched(d, c1, "the both-intents create");

    const tab = await openTab(api, d, [cake(2)], { rewardCardId: c1.id });
    assert.equal((await cardOf(d, c1.id)).status, "used", "landmark: the tab carries card 1");
    const round = await api.addRound(tab, { items: [tea()], rewardCardId: c2.id, rewardAt: RUNG_AT });
    assert.equal(round.status, 400);
    assert.equal(round.body.error, CARD_REWARD_EXCLUSIVE);

    const second = await api.addRound(tab, { items: [tea()], discount: 0, discountKind: null, rewardCardId: c2.id });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, ONE_REWARD_PER_BILL);
    await assertCardUntouched(d, c2, "the second card");
    const stamp = await api.addRound(tab, { items: [tea()], discount: 0, discountKind: null, rewardAt: RUNG_AT });
    assert.equal(stamp.status, 409);
    assert.equal(stamp.body.error, ONE_REWARD_PER_BILL);
    assert.equal(await stampsOf(d.id), STAMPS, "the refused stamp claim spent nothing");
    const stored = await rawOrder(tab);
    assert.equal(stored.rewardCardId, c1.id, "the first card is still the bill's reward");
    assert.equal(stored.kotRounds, 1, "no refused round landed");

    const stampTab = await openTab(api, d, [cake(2)], { rewardAt: RUNG_AT });
    assert.equal(await stampsOf(d.id), STAMPS - RUNG_AT, "landmark: the rung was claimed on this bill");
    const onStamp = await api.addRound(stampTab, { items: [tea()], discount: 0, discountKind: null, rewardCardId: c2.id });
    assert.equal(onStamp.status, 409);
    assert.equal(onStamp.body.error, ONE_REWARD_PER_BILL);
    await assertCardUntouched(d, c2, "the card onto a stamp bill");
  });

  await scenario("n", "points and none cards are never claimable: refused at the route and at the claim CAS (the kind allowlist), untouched; a money card in the same wallet claims", async () => {
    await seedSettings();
    const points = revealed({ kind: "points", value: 20 });
    const none = revealed({ kind: "none", value: 0 });
    const money = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([points, none, money]);
    for (const [name, card] of [["points", points], ["none", none]] as const) {
      const res = await api.create(tabBody(d, [cake(2)], { rewardCardId: card.id }));
      assert.equal(res.status, 400, `a ${name} card is refused at the route`);
      assert.equal(res.body.error, CARD_NOT_USABLE);
      assert.equal(await claimRewardCard(d.id, card.id, `LIVE-N-${name}`, new Date()), false, `and the ${name} claim CAS matches nothing`);
      await assertCardUntouched(d, card, `the ${name} card`);
    }
    assert.equal(await ordersOf(d.id), 0, "no order was written");
    assert.equal(await claimRewardCard(d.id, money.id, "LIVE-N-money", new Date()), true, "witness: the same wallet's money card claims");
  });

  await scenario("q", "diner accounts OFF refuses a staff card claim; a revealed card stays usable while levels are switched OFF and while scratch is blocked (predicate 3)", async () => {
    const c0 = revealed({ kind: "bill-flat", value: FLAT });
    const off = await diner([c0]);
    await seedSettings({ accounts: false });
    const refused = await api.create(tabBody(off, [cake(2)], { rewardCardId: c0.id }));
    assert.equal(refused.status, 400, "accounts off");
    assert.equal(refused.body.error, CARD_NOT_USABLE);
    assert.equal(await ordersOf(off.id), 0);
    await assertCardUntouched(off, c0, "the accounts-off claim");

    const c1 = revealed({ kind: "bill-flat", value: FLAT });
    const c2 = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c1, c2]);
    const levelsOff = (await seedSettings({ levels: false })) as unknown as ISettings;
    assert.equal(rewardLevelsEarning(levelsOff, {} as NodeJS.ProcessEnv), false, "landmark: levels are OFF (no earning)");
    const a = await api.create(tabBody(d, [cake(2)], { rewardCardId: c1.id }));
    assert.equal(a.status, 201, `a revealed card is still usable with levels off - got ${a.status}: ${a.body.error ?? ""}`);
    assert.equal(a.body.data!.discount, FLAT);

    const blocked = (await seedSettings({ blocked: true })) as unknown as ISettings;
    assert.equal(scratchCardsBlockedFor(blocked, {} as NodeJS.ProcessEnv), true, "landmark: scratch is blocked for this cafe");
    assert.equal(rewardLevelsEarning(blocked, {} as NodeJS.ProcessEnv), false);
    const b = await api.create(tabBody(d, [cake(2)], { rewardCardId: c2.id }));
    assert.equal(b.status, 201, `and with scratch blocked - got ${b.status}: ${b.body.error ?? ""}`);
    assert.equal(b.body.data!.discount, FLAT);
    assert.equal((await rawOrder(String(b.body.data!._id))).rewardCardId, c2.id);
  });
}
