/**
 * CB-7 S5 live legs P2 + O2 of verify-reward-redemption-live.ts (kit file: the main script is far over the size cap).
 * (ops CLI support module, not app code.)
 *
 * THE BUG (P2, s86): a bill opened with a promo code stores NO marker, so a later reward claim (add-round or settle)
 * is accepted, REPLACES the promo's discount and kind, spends the stamps, and the PromoRedemption row stays burned.
 * THE DECISION (O2, owner s91): the GST Discount preset on a promo bill must be refused too (it replaces the promo).
 * THE FIX CONTRACT: the bill carries `promoCode` (Order.promoCode); every writer refuses the second reward / the GST
 * preset against it, before any claim, and the stored promo money survives.
 *
 * Every leg drives the REAL route handlers (POST /api/orders, /items, /settle) with only `@/lib/auth` swapped for a
 * signed-in stub, exactly as verify-skip-kot-live does, so the routes' own validators, fences and writes run. The
 * promo bill itself is written by the REAL counter create route (discount, PROMO note line, PromoRedemption row).
 * Today that route writes no `promoCode` marker, so the MARKED legs set it by hand (the post-fix shape); the
 * UNMARKED variant is the stated residual (an old promo tab with no marker) and asserts nothing about the outcome.
 */
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { Settings } from "@/models/Settings";
import { PromoRedemption } from "@/models/PromoRedemption";
import { invalidateSettingsCache } from "@/lib/settings";
import { updateSettingsSchema } from "@/schemas";
import { LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";
import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";

export type ScenarioFn = (n: number, name: string, fn: () => Promise<void>) => Promise<void>;

const STAFF_ID = "665f0000000000000000beef";
const PROMO_CODE = "FLAT50";
const PROMO_VALUE = 50;
const RUNG_AT = 8;
const RUNG_VALUE = 100;
const STAMPS = 20;
const CHAI_PRICE = 200;
const GST_RATE = 5;

function stubAuth(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  stub.exports = {
    auth: async () => ({ user: { id: STAFF_ID, name: "Live leg", role: "admin" } }),
    handlers: {},
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  require.cache[file] = stub;
}

type Res = { status: number; body: { success: boolean; data?: Record<string, unknown>; error?: string } };
const idp = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown): Request =>
  new Request(`http://live.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
async function answer(pending: Response | Promise<Response>): Promise<Res> {
  const res = await pending;
  return { status: res.status, body: (await res.json()) as Res["body"] };
}
const raw = (id: string) => Order.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });

// The cafe config the legs run under: a flat ₹100 rung at 8 stamps, one once-per-customer ₹50 promo, GST optional.
async function seedSettings(gst: boolean): Promise<void> {
  await Settings.deleteMany({});
  const parsed = updateSettingsSchema.safeParse({
    loyaltyRules: {
      v: LOYALTY_RULES_SCHEMA_VERSION,
      unitLabel: "stamp",
      milestones: [{ at: RUNG_AT, kind: "flat", value: RUNG_VALUE, item: "" }],
    },
    promoCodes: [{ code: PROMO_CODE, kind: "flat", value: PROMO_VALUE, active: true, oncePerCustomer: true }],
    ...(gst ? { gstEnabled: true, gstNumber: "", gstRate: GST_RATE, gstMode: "exclusive" as const } : {}),
  });
  assert.ok(parsed.success, `settings fixture must parse: ${parsed.success ? "" : JSON.stringify(parsed.error.flatten())}`);
  await Settings.findOneAndUpdate({}, parsed.data, { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true });
  invalidateSettingsCache();
}

export async function runPromoFenceLegs(scenario: ScenarioFn, productId: string, firstNumber: number): Promise<void> {
  // Pointed at the scratch DB by main(); set BEFORE the routes load so connectDB() reuses the same URI.
  stubAuth();
  await connectDB();
  const create = await import("@/app/api/orders/route");
  const items = await import("@/app/api/orders/[id]/items/route");
  const settle = await import("@/app/api/orders/[id]/settle/route");

  const line = { productId, name: "Masala Chai", price: CHAI_PRICE, qty: 1 };
  const freshCustomer = async (): Promise<mongoose.Types.ObjectId> =>
    (await Customer.create({ name: "Promo Fence Diner", mobile: `9${Math.floor(100000000 + Math.random() * 899999999)}`, stamps: STAMPS }))._id as mongoose.Types.ObjectId;
  const stampsOf = async (c: mongoose.Types.ObjectId) => (await Customer.findById(c).select("stamps").lean())!.stamps;

  // The counter's own create route writes the tab: 2 x ₹200 = ₹400, with or without the promo code.
  async function openTab(customerId: mongoose.Types.ObjectId, promo: boolean, mark: boolean): Promise<string> {
    const body = {
      customerName: "Promo Fence Diner", customerId: String(customerId), items: [{ ...line, qty: 2 }],
      subtotal: 400, total: 400, receiver: "Live leg", payment: "Unpaid", status: "Pending",
      ...(promo ? { promoCode: PROMO_CODE } : {}),
    };
    const res = await answer(create.POST(post("/api/orders", body)));
    assert.equal(res.status, 201, `fixture: the counter create route must open the tab (got ${res.status}: ${res.body.error ?? ""})`);
    const id = String(res.body.data!._id);
    if (promo && mark) await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { promoCode: PROMO_CODE } });
    const doc = await raw(id);
    if (promo) {
      // Landmarks: the seeded state really is a promo bill (so a later "unchanged" is not vacuous).
      assert.equal(doc!.discount, PROMO_VALUE, "landmark: the promo's discount is on the tab");
      assert.match(String(doc!.notes), new RegExp(`PROMO ${PROMO_CODE}`), "landmark: the promo note line is on the tab");
      assert.equal(doc!.discountKind, undefined, "landmark: a promo is NOT a discount kind on the order");
      assert.equal(await PromoRedemption.countDocuments({ code: PROMO_CODE }) > 0, true, "landmark: the once-per-customer row is burned");
    }
    if (promo && mark) assert.equal(doc!.promoCode, PROMO_CODE, "landmark: the marked variant carries the marker");
    return id;
  }
  const addRound = (id: string, extra: Record<string, unknown>) =>
    answer(items.POST(post(`/api/orders/${id}/items`, { items: [line], ...extra }), idp(id)));
  const settleTab = (id: string, extra: Record<string, unknown>) =>
    answer(settle.POST(post(`/api/orders/${id}/settle`, { payment: "Cash", ...extra }), idp(id)));

  // The promo bill is exactly as it was: money, kind, no reward snapshot, still open, no second round, stamps intact.
  async function assertPromoSurvives(id: string, customerId: mongoose.Types.ObjectId, res: Res, what: string): Promise<void> {
    const doc = await raw(id);
    const seen = `status=${res.status} discount=${String(doc!.discount)} kind=${String(doc!.discountKind)} stamps=${String(await stampsOf(customerId))} orderStatus=${String(doc!.status)}`;
    assert.ok(res.status === 400 || res.status === 409, `${what} must be REFUSED (400/409) — got ${seen}`);
    assert.equal(doc!.discount, PROMO_VALUE, `the promo's ₹${PROMO_VALUE} must survive — ${seen}`);
    assert.equal(doc!.discountKind, undefined, `the promo bill must not gain a discount kind — ${seen}`);
    assert.equal(doc!.rewardAt, undefined, `no reward snapshot may be written — ${seen}`);
    assert.equal(doc!.status, "Pending", `the tab must stay open — ${seen}`);
    assert.equal(doc!.kotRounds, 1, `no second round may land — ${seen}`);
    assert.equal(await stampsOf(customerId), STAMPS, `no stamps may be spent — ${seen}`);
  }

  try {
    await seedSettings(false);
    const n = (k: number) => firstNumber + k;

    await scenario(n(0), "P2 (marked promo tab): an add-round carrying rewardAt is REFUSED with PROMO_BLOCKS_REWARD; promo discount, kind and stamps untouched", async () => {
      const customerId = await freshCustomer();
      const id = await openTab(customerId, true, true);
      const res = await addRound(id, { rewardAt: RUNG_AT });
      await assertPromoSurvives(id, customerId, res, "a reward claim onto a promo bill (add-round)");
      assert.equal(res.body.error, PROMO_BLOCKS_REWARD, "the refusal must be the shared promo-blocks-reward copy");
    });

    await scenario(n(1), "P2 (marked promo tab): a settle carrying rewardAt is REFUSED with PROMO_BLOCKS_REWARD; the tab stays open, promo and stamps untouched", async () => {
      const customerId = await freshCustomer();
      const id = await openTab(customerId, true, true);
      const res = await settleTab(id, { rewardAt: RUNG_AT });
      await assertPromoSurvives(id, customerId, res, "a reward claim onto a promo bill (settle)");
      assert.equal(res.body.error, PROMO_BLOCKS_REWARD, "the refusal must be the shared promo-blocks-reward copy");
    });

    await scenario(n(2), "P2 witness: the SAME claim on a promo-FREE tab still lands (discount 100, kind reward, 8 stamps spent)", async () => {
      const customerId = await freshCustomer();
      const id = await openTab(customerId, false, false);
      const res = await addRound(id, { rewardAt: RUNG_AT });
      assert.equal(res.status, 200, `the witness claim must land — got ${res.status}: ${res.body.error ?? ""}`);
      const doc = await raw(id);
      assert.equal(doc!.discountKind, "reward");
      assert.equal(doc!.discount, RUNG_VALUE);
      assert.equal(doc!.rewardAt, RUNG_AT);
      assert.equal(await stampsOf(customerId), STAMPS - RUNG_AT, "the witness claim spends exactly the rung's stamps");
    });

    await scenario(n(3), "P2 residual (an OLD promo tab with no marker): outcome logged, nothing asserted — the fix writes the marker going forward only", async () => {
      const customerId = await freshCustomer();
      const id = await openTab(customerId, true, false);
      const marked = (await raw(id))!.promoCode !== undefined;
      const res = await addRound(id, { rewardAt: RUNG_AT });
      console.log(`       [residual] create route wrote the marker: ${marked}; unmarked add-round answered ${res.status} (kind now ${String((await raw(id))!.discountKind)})`);
    });

    await seedSettings(true);
    await scenario(n(4), "O2 (marked promo tab): the GST Discount preset on an add-round is REFUSED (409); the promo discount is kept", async () => {
      const customerId = await freshCustomer();
      const id = await openTab(customerId, true, true);
      const res = await addRound(id, { discountKind: "gst" });
      await assertPromoSurvives(id, customerId, res, "the GST preset onto a promo bill (add-round)");
      assert.equal(res.status, 409, `the owner's decision is a 409 — got ${res.status}`);
    });

    await scenario(n(5), "O2 (marked promo tab): the GST Discount preset at settle is REFUSED (409); the tab stays open with the promo discount", async () => {
      const customerId = await freshCustomer();
      const id = await openTab(customerId, true, true);
      const res = await settleTab(id, { discountKind: "gst" });
      await assertPromoSurvives(id, customerId, res, "the GST preset onto a promo bill (settle)");
      assert.equal(res.status, 409, `the owner's decision is a 409 — got ${res.status}`);
    });
  } finally {
    await Settings.deleteMany({});
    await PromoRedemption.deleteMany({});
    invalidateSettingsCache();
  }
}
