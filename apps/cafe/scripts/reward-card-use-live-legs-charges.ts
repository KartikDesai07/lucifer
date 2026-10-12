/**
 * G2 live legs (s91 arbiter round 2): the settle-time reward claim's minBill gate must read the SAME charges the bill is
 * priced with (resolveSettleMoney: the table lane via chargeAmount, the extra lane via extraCharges). Part of
 * verify-reward-card-use-live.ts. (ops CLI support module, not app code.)
 *
 * The fixture: a flat Rs 100 rung at 8 stamps with minBill 520; a Rs 500 tab (5 x Rs 100 tea). With a Rs 30 Packing
 * extra the bill without the claim is Rs 530 (meets 520); without it, Rs 500 (does not). Raw API only - the POS never
 * sends a claim at settle (D9) - so each body is the settle schema's own shape, a claim riding on it.
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Customer } from "@/models/Customer";
import { rewardClaimMessage } from "@/lib/reward-claim-messages";
import { RUNG_AT, diner, line, openTab, rawOrder, seedSettings, settleBody, type Ctx, type Rec, type Res } from "./reward-card-use-live-kit";

const MIN_BILL = 520;
const STAMPS = 10;
const FLAT = 100;
const TAB_ITEMS = 500;
const PACKING = [{ label: "Packing", amount: 30 }];
const WITH_PACKING = 530;
const TOO_SMALL = rewardClaimMessage("below-min-bill");

const stampsOf = async (id: string): Promise<number> =>
  Number(((await Customer.collection.findOne({ _id: new mongoose.Types.ObjectId(id) })) as Rec | null)?.stamps ?? 0);

export async function runChargeLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const fiveTeas = () => [line(menu.tea, "Masala Tea", 100, 5)];
  // A claim that landed: the rung is on the bill, priced off the bill WITH its charges, and the stamps were spent.
  const claimed = async (res: Res, id: string, d: { id: string }, what: string): Promise<void> => {
    assert.equal(res.status, 200, `${what}: the bill meets minBill ${MIN_BILL} - got ${res.status}: ${res.body.error ?? ""}`);
    const order = await rawOrder(id);
    assert.equal(order.rewardAt, RUNG_AT, `${what}: the rung is stored`);
    assert.equal(order.discountKind, "reward", `${what}: the kind is reward`);
    assert.equal(order.total, WITH_PACKING - FLAT, `${what}: Rs ${WITH_PACKING} less the Rs ${FLAT} reward`);
    assert.ok((await stampsOf(d.id)) < STAMPS, `${what}: the stamps were spent`);
  };

  await scenario("g2a", "G2 a Rs 500 tab + Rs 30 Packing extra settled with chargeAmount: 0 and a Rs 100 / minBill 520 claim -> 200, total 430", async () => {
    await seedSettings({ rungMinBill: MIN_BILL });
    const d = await diner([], { stamps: STAMPS });
    const id = await openTab(api, d, fiveTeas(), { extraCharges: PACKING });
    const tab = await rawOrder(id);
    assert.equal(tab.total, WITH_PACKING, "landmark: the tab carries the extra");
    const res = await api.settle(id, settleBody(tab, { chargeAmount: 0, rewardAt: RUNG_AT }));
    await claimed(res, id, d, "a table-charge waiver beside an extra");
  });

  await scenario("g2b", "G2 a Rs 500 tab settled with the Rs 30 extra ADDED at settle and the claim -> 200, total 430", async () => {
    await seedSettings({ rungMinBill: MIN_BILL });
    const d = await diner([], { stamps: STAMPS });
    const id = await openTab(api, d, fiveTeas());
    const tab = await rawOrder(id);
    assert.equal(tab.total, TAB_ITEMS, "landmark: the tab has no charge yet");
    const res = await api.settle(id, settleBody(tab, { extraCharges: PACKING, rewardAt: RUNG_AT }));
    await claimed(res, id, d, "an extra added at settle");
  });

  await scenario("g2c", "G2 the Rs 30 extra REMOVED at settle drops the bill to Rs 500 -> the claim is refused (too small), nothing spent", async () => {
    await seedSettings({ rungMinBill: MIN_BILL });
    const d = await diner([], { stamps: STAMPS });
    const id = await openTab(api, d, fiveTeas(), { extraCharges: PACKING });
    const tab = await rawOrder(id);
    const res = await api.settle(id, settleBody(tab, { extraCharges: [], rewardAt: RUNG_AT }));
    assert.equal(res.status, 400, `the bill without the claim is Rs ${TAB_ITEMS} - got ${res.status}: ${res.body.error ?? ""}`);
    assert.equal(res.body.error, TOO_SMALL);
    assert.equal(await stampsOf(d.id), STAMPS, "no stamp was spent");
    assert.equal((await rawOrder(id)).status, "Pending", "the tab is still open");
  });

  await scenario("g2d", "G2 control: the extra left alone (no chargeAmount, no extraCharges) -> the Rs 530 bill meets minBill -> 200, total 430", async () => {
    await seedSettings({ rungMinBill: MIN_BILL });
    const d = await diner([], { stamps: STAMPS });
    const id = await openTab(api, d, fiveTeas(), { extraCharges: PACKING });
    const res = await api.settle(id, settleBody(await rawOrder(id), { rewardAt: RUNG_AT }));
    await claimed(res, id, d, "the extra untouched");
  });
}
