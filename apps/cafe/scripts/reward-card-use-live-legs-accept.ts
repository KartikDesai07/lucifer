/**
 * Live legs f4a-f4e (the QR accept must never strand a claimed reward): an accept that claimed a card / stamps and then
 * loses its insert for a DEFINITE reason (a sourceRequestIds duplicate = another accept's order won this request; an
 * orderId duplicate followed by a failed retry) must hand the reward back, and an AMBIGUOUS failure where its own order
 * did land must leave the claim alone. Part of verify-reward-card-use-live.ts. (ops CLI support module, not app code.)
 *
 * The faults are injected at `Order.create` (the one write the accept makes), never at the route: the accept path, its
 * claim, its recovery and its compensation are the product's own.
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Customer } from "@/models/Customer";
import { Order } from "@/models/Order";
import { OrderRequest } from "@/models/OrderRequest";
import {
  RUNG_AT, assertCardUntouched, cardOf, diner, dinerSession, revealed, seedSettings, setDinerCookie, type Ctx, type Diner, type Rec,
} from "./reward-card-use-live-kit";

const FLAT = 40;
const STAMPS = 10;
const CREATE_STALLED = 1;
const CREATE_RETRY = 2;
type CreateFn = (...args: unknown[]) => Promise<unknown>;
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const ordersFor = (requestId: string) => Order.collection.find({ sourceRequestIds: oid(requestId) }).toArray() as Promise<Rec[]>;

export async function runAcceptLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const model = Order as unknown as { create: CreateFn };
  const realCreate = model.create.bind(Order);
  const submitFor = async (d: Diner, intent: Rec): Promise<string> => {
    setDinerCookie(await dinerSession(d));
    const res = await api.submitQr({ target: { kind: "parcel" }, items: [{ productId: menu.cake, modifiers: [], qty: 2 }], name: "Card Diner", mobile: d.mobile, ...intent });
    assert.equal(res.status, 201, `fixture: the valid submit must land - got ${res.status}: ${res.body.error ?? ""}`);
    const row = (await OrderRequest.collection.findOne({ shortCode: String(res.body.data!.shortCode) })) as Rec;
    return String(row._id);
  };
  const withCreate = async (fake: CreateFn, run: () => Promise<void>): Promise<void> => {
    model.create = fake;
    try {
      await run();
    } finally {
      model.create = realCreate;
    }
  };
  // Accept, tolerating a thrown 500 (the ambiguous-failure legs end that way): returns the status or "threw".
  const acceptQuietly = async (requestId: string): Promise<number | "threw"> => {
    try {
      return (await api.accept(requestId)).status;
    } catch {
      return "threw";
    }
  };
  // Two accepts of ONE request: A claims the reward then stalls at its insert; B (the reward now spent, so it resolves to
  // nothing and prices at full) inserts first; A's insert then loses on sourceRequestIds and returns B's order as a replay.
  async function raceTwoAccepts(requestId: string): Promise<Awaited<ReturnType<typeof api.accept>>> {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reachedInsert: () => void = () => undefined;
    const aAtInsert = new Promise<void>((resolve) => (reachedInsert = resolve));
    let a!: Awaited<ReturnType<typeof api.accept>>;
    await withCreate(async (...args) => {
      calls += 1;
      if (calls === CREATE_STALLED) {
        reachedInsert();
        await gate;
      }
      return realCreate(...args);
    }, async () => {
      const aPending = api.accept(requestId);
      await aAtInsert;
      const b = await api.accept(requestId);
      assert.equal(b.status, 200, `fixture: the second accept lands the order - got ${b.status}: ${b.body.error ?? ""}`);
      release();
      a = await aPending;
    });
    return a;
  }
  // The first insert collides on a REAL orderId (a row already holds that number): the claim re-keys to the retry id.
  const collideFirstInsert = (then: (doc: Rec, requestId: string) => Promise<unknown>, requestId: string): CreateFn => {
    let calls = 0;
    return async (...args) => {
      calls += 1;
      const doc = args[0] as Rec;
      if (calls === CREATE_STALLED) {
        await Order.collection.insertOne({ orderId: String(doc.orderId), createdAt: new Date(), status: "Completed", items: [], total: 0 });
        return realCreate(...args);
      }
      if (calls === CREATE_RETRY) return then(doc, requestId);
      return realCreate(...args);
    };
  };

  await scenario("f4a", "two accepts of one request: the loser's CARD claim is handed back when its insert loses on sourceRequestIds", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c]);
    const requestId = await submitFor(d, { requestedCardId: c.id });
    const a = await raceTwoAccepts(requestId);
    const landed = await ordersFor(requestId);
    assert.equal(landed.length, 1, "landmark: exactly ONE order landed for the request");
    assert.equal("rewardCardId" in landed[0], false, "landmark: the winner is the full-price order, the card is on no order");
    assert.equal(a.status, 200, `the loser answers with the winner's order (replay) - got ${a.status}: ${a.body.error ?? ""}`);
    await assertCardUntouched(d, c, "the loser's insert that lost the request");
  });

  await scenario("f4b", "two accepts of one request: the loser's STAMP claim is handed back (balance restored, no order carries a reward)", async () => {
    await seedSettings();
    const d = await diner([], { stamps: STAMPS });
    const requestId = await submitFor(d, { requestedRewardAt: RUNG_AT });
    await raceTwoAccepts(requestId);
    const landed = await ordersFor(requestId);
    assert.equal(landed.length, 1, "landmark: exactly ONE order landed for the request");
    assert.equal("rewardAt" in landed[0], false, "landmark: the winner is the full-price order, no stamps on it");
    const row = (await Customer.collection.findOne({ _id: oid(d.id) })) as Rec;
    assert.equal(row.stamps, STAMPS, "the loser's stamps came back: the balance is what it was");
  });

  await scenario("f4c", "orderId collision then the retry insert throws (nothing written): the claim that moved to the retry id is released", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c]);
    const requestId = await submitFor(d, { requestedCardId: c.id });
    await withCreate(
      collideFirstInsert(async () => { throw new Error("simulated socket error on the retry insert (nothing written)"); }, requestId),
      async () => { await acceptQuietly(requestId); },
    );
    assert.equal((await ordersFor(requestId)).length, 0, "landmark: no order landed for the request");
    await assertCardUntouched(d, c, "the failed retry insert");
  });

  await scenario("f4d", "orderId collision then the retry insert loses on sourceRequestIds to another accept's order: the claim is released", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c]);
    const requestId = await submitFor(d, { requestedCardId: c.id });
    await withCreate(
      collideFirstInsert(async (_doc, id) => {
        await Order.collection.insertOne({ orderId: "LIVE-WINNER-1", createdAt: new Date(), status: "Pending", items: [], total: 0, sourceRequestIds: [oid(id)] });
        return realCreate(_doc);
      }, requestId),
      async () => { await acceptQuietly(requestId); },
    );
    const landed = await ordersFor(requestId);
    assert.equal(landed.length, 1, "landmark: another accept's order holds the request");
    assert.equal(landed[0].orderId, "LIVE-WINNER-1");
    await assertCardUntouched(d, c, "the retry insert that lost the request");
  });

  await scenario("f4e", "orderId collision then the retry insert LANDS but its ack is lost (throws): the claim STAYS on the landed order (never revert on a throw)", async () => {
    await seedSettings();
    const c = revealed({ kind: "bill-flat", value: FLAT });
    const d = await diner([c]);
    const requestId = await submitFor(d, { requestedCardId: c.id });
    await withCreate(
      collideFirstInsert(async (doc) => {
        await realCreate(doc);
        throw new Error("simulated lost ack: the insert committed");
      }, requestId),
      async () => { await acceptQuietly(requestId); },
    );
    const landed = await ordersFor(requestId);
    assert.equal(landed.length, 1, "landmark: the retry insert did land");
    const stored = await cardOf(d, c.id);
    assert.equal(stored.status, "used", "the card stays spent against the order that landed");
    assert.equal(stored.orderId, landed[0].orderId, "keyed on the order that landed");
  });
}
