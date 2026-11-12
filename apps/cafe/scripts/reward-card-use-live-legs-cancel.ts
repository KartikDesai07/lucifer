/**
 * Live legs k1-k3 (s114, owner decision s113): a cancel whose LEDGER reversal throws still gives the bill's reward back.
 * The cancel CAS has landed, so the 500 that follows can never be retried into a give-back (the retry meets the
 * "already cancelled" 409). The stamps (k1), the scratch card (k2) and the points (k3) must therefore be given back
 * BEFORE reconcileLedger, each swallowing its own failure, like the stock add-back. Part of
 * verify-reward-card-use-live.ts. (ops CLI support module, not app code.)
 *
 * The fault: Customer.findByIdAndUpdate rejects for the ledger's `$inc` of visits only (the shape reconcileLedger
 * writes on a settled bill); no give-back uses that method, so every other write is real.
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Customer } from "@/models/Customer";
import {
  RUNG_AT, assertCardUntouched, cardOf, diner, hoursFromNow, line, openTab, rawOrder, revealed, seedSettings, settleBody,
  type Api, type Ctx, type Rec,
} from "./reward-card-use-live-kit";
import { assertLotUntouched, lot, lotOf, settlePoints, spendsOf } from "./reward-points-live-kit";

const STAMPS = 10;
const POINTS = 40;
const LOT_SIZE = 50;
const REASON = "ledger throws";

const rawCustomer = async (id: string): Promise<Rec> =>
  ((await Customer.collection.findOne({ _id: new mongoose.Types.ObjectId(id) })) ?? {}) as Rec;

type Writer = (id: unknown, update: Rec, ...rest: unknown[]) => unknown;

/** Cancels `id` while the ledger reversal rejects: a 500, the order IS cancelled, the ledger untouched, a retry 409s. */
async function cancelWhileLedgerThrows(api: Api, id: string, customerId: string): Promise<void> {
  const model = Customer as unknown as { findByIdAndUpdate: Writer };
  const real = model.findByIdAndUpdate;
  let fired = 0;
  model.findByIdAndUpdate = (target, update, ...rest) => {
    const inc = update?.$inc as Rec | undefined;
    if (inc && "visits" in inc) {
      fired += 1;
      return Promise.reject(new Error("injected: the ledger reversal failed"));
    }
    return real.call(Customer, target, update, ...rest);
  };
  const before = await rawCustomer(customerId);
  let status: number;
  try {
    status = (await api.cancel(id, REASON)).status;
  } finally {
    model.findByIdAndUpdate = real;
  }
  assert.equal(fired, 1, "landmark: the ledger reversal ran once and threw");
  assert.equal(status, 500, "the ledger throw surfaces as a 500");
  assert.equal((await rawOrder(id)).status, "Cancelled", "landmark: the cancel CAS landed before the throw");
  const after = await rawCustomer(customerId);
  for (const key of ["visits", "totalSpend", "totalDue"]) assert.equal(after[key], before[key], `landmark: the ledger ${key} was not reversed`);
  assert.equal((await api.cancel(id, "retry")).status, 409, "the retry meets the already-cancelled 409 (so it can never give back)");
}

export async function runCancelLedgerThrowLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const bill350 = () => [line(menu.cake, "Cake", 100, 2), line(menu.brownie, "Brownie", 150)];

  await scenario("k1", "a settled stamp-reward bill whose cancel's ledger reversal throws: 500, cancelled, and the stamps ARE given back", async () => {
    await seedSettings();
    const d = await diner([], { stamps: STAMPS });
    const id = await openTab(api, d, bill350());
    const settled = await api.settle(id, settleBody(await rawOrder(id), { rewardAt: RUNG_AT }));
    assert.equal(settled.status, 200, `fixture: the stamp claim settles - got ${settled.status}: ${settled.body.error ?? ""}`);
    const order = await rawOrder(id);
    assert.equal(order.rewardStamps, RUNG_AT, "landmark: the bill stored its stamp cost");
    const spent = Number((await rawCustomer(d.id)).stamps);
    assert.ok(spent < STAMPS, "landmark: the stamps were spent at settle");
    await cancelWhileLedgerThrows(api, id, d.id);
    const row = await rawCustomer(d.id);
    assert.equal(row.stamps, spent + RUNG_AT, "the stamps came back despite the ledger throw");
    assert.ok((row.returnedOrders as unknown[] | undefined)?.includes(order.orderId), "the return is marked for this order");
  });

  await scenario("k2", "a settled scratch-card bill whose cancel's ledger reversal throws: 500, cancelled, and the card IS released", async () => {
    await seedSettings();
    const c = revealed();
    const d = await diner([c]);
    const id = await openTab(api, d, bill350(), { rewardCardId: c.id });
    const settled = await api.settle(id, settleBody(await rawOrder(id)));
    assert.equal(settled.status, 200, `fixture: the card bill settles - got ${settled.status}: ${settled.body.error ?? ""}`);
    assert.equal((await rawOrder(id)).status, "Completed", "landmark: the bill is a sale (the ledger reversal will write)");
    assert.equal((await cardOf(d, c.id)).status, "used", "landmark: the card is spent before the cancel");
    await cancelWhileLedgerThrows(api, id, d.id);
    await assertCardUntouched(d, c, "after the cancel whose ledger threw");
  });

  await scenario("k3", "a settled points bill whose cancel's ledger reversal throws: 500, cancelled, and the points ARE returned", async () => {
    await seedSettings();
    const l = lot(LOT_SIZE, hoursFromNow(24));
    const d = await diner([l]);
    const id = await openTab(api, d, bill350());
    const settled = await settlePoints(api, id, POINTS);
    assert.equal(settled.status, 200, `fixture: the points settle lands - got ${settled.status}: ${settled.body.error ?? ""}`);
    assert.equal((await lotOf(d, l.id)).pointsSpent, POINTS, "landmark: the points were spent at settle");
    await cancelWhileLedgerThrows(api, id, d.id);
    await assertLotUntouched(d, l, "the lot after the cancel whose ledger threw");
    assert.ok((await spendsOf(d))[0].returnedAt instanceof Date, "the spend record is closed");
  });
}
