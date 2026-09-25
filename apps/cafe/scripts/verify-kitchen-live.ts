/**
 * P4-A — live-DB leg for the Kitchen line board.
 *
 * WHY THIS EXISTS: the board's tick is addressed by a line REF, not by a line
 * `_id` — `Order.items[]` is an embedded `{_id:false}` subdoc, so there is no
 * per-line id to key on. The ref must therefore survive the one write that
 * rewrites the whole array: a PARTIAL VOID (`$set: {items: resolved.nextItems}`
 * in app/api/orders/[id]/items/void/route.ts). A DB-free suite can assert that
 * the pure builder behaves, but it structurally cannot prove that the shape
 * Mongoose actually stores and reads back still produces the same ref — and a
 * ref that shifts silently moves a "done" tick onto a DIFFERENT dish.
 *
 * So these scenarios go through the WRITERS' EXACT SHAPES (the real
 * `resolveItemVoid` output for the void, the real positional `kotFiredAt`
 * idiom for the fire) against a real mongod, and read back what landed.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_kitchen npm run verify:kitchen:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops what it touches. Prints pass/fail only.
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Types } from "mongoose";

import { Order } from "@/models/Order";
import { KotTick } from "@/models/KotTick";
import { buildKitchenRows, type KitchenOrderInput } from "@/lib/kitchen-board";
import { resolveItemVoid } from "@/lib/order-void";
import type { GstConfig } from "@/lib/receipt";
import { orderLineKey } from "@pos/shared/utils";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}kitchen`;

// The real GstConfig shape — NOT a hand-shaped `{mode,rate}`. The cast that
// used to sit on this call suppressed a genuine mismatch; without it the
// compiler checks the live leg against the writer's actual signature.
const GST_OFF: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };

const PRODUCT_A = new Types.ObjectId();
const PRODUCT_B = new Types.ObjectId();

let passed = 0;
let failed = 0;

async function scenario(n: number, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok ${n} — ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${n} — ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A two-line open tab, both lines fired in round 1. */
async function seedTab(orderId: string): Promise<string> {
  const doc = await Order.create({
    orderId,
    customerName: "Walk-In",
    items: [
      { productId: PRODUCT_A, name: "Masala Chai", price: 40, qty: 2, modifiers: [], instructions: "", kotRound: 1 },
      { productId: PRODUCT_B, name: "Veg Sandwich", price: 90, qty: 3, modifiers: [], instructions: "", kotRound: 1 },
    ],
    subtotal: 350,
    total: 350,
    paidAmount: 0,
    payment: "Unpaid",
    status: "Pending",
    receiver: "Live Leg",
    kotRounds: 1,
  });
  return String(doc._id);
}

async function boardOf(id: string): Promise<ReturnType<typeof buildKitchenRows>> {
  const orders = await Order.find({ _id: id, status: "Pending", payment: "Unpaid", kotRounds: { $gte: 1 } })
    .select("orderId items kotRounds kotNumbers kotFiredAt tableNo notes source createdAt")
    .lean();
  const ticks = await KotTick.find({ _id: { $in: [id] } }).select("refs").lean();
  const ticksByOrder: Record<string, string[]> = {};
  for (const tick of ticks) ticksByOrder[tick._id] = tick.refs;
  return buildKitchenRows({ orders: orders as unknown as KitchenOrderInput[], ticksByOrder, now: new Date() });
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = uri.split("/").pop()?.split("?")[0] ?? "";
  assert.ok(
    dbName.startsWith(SCRATCH_PREFIX),
    `refusing to run against "${dbName}" — the database name must start with ${SCRATCH_PREFIX}`,
  );

  await mongoose.connect(uri);
  console.log(`\nKitchen board live leg — ${dbName}\n`);

  try {
    await Order.deleteMany({});
    await KotTick.deleteMany({});

    await scenario(1, "a fired round's kotFiredAt[round-1] lands as a real Date and drives the board's age", async () => {
      const id = await seedTab("ORD-LIVE-0001");
      // The /items route's exact positional idiom, for round 2.
      const firedAt = new Date();
      const old = await Order.findById(id).lean();
      assert.ok(old);
      const round = (old.kotRounds ?? 0) + 1;
      const kotFiredAt = Array.from({ length: round }, (_, i) =>
        i === round - 1 ? firedAt : (old.kotFiredAt?.[i] ?? old.createdAt),
      );
      await Order.updateOne(
        { _id: id, status: "Pending", payment: "Unpaid", kotRounds: old.kotRounds ?? 0 },
        {
          $set: {
            items: [...old.items, { productId: PRODUCT_A, name: "Masala Chai", price: 40, qty: 1, modifiers: [], instructions: "", kotRound: round }],
            kotRounds: round,
            kotFiredAt,
          },
        },
      );

      const stored = await Order.findById(id).lean();
      assert.ok(stored?.kotFiredAt, "kotFiredAt must be stored (a Zod-valid field Mongoose drops is the classic silent loss)");
      assert.equal(stored.kotFiredAt.length, 2, "positional: one slot per fired round, no holes");
      assert.ok(stored.kotFiredAt[0] instanceof Date, "slot 0 backfilled as a real Date, never undefined");
      assert.equal(stored.kotFiredAt[1]?.getTime(), firedAt.getTime(), "round 2's slot is this fire's moment");

      const rows = await boardOf(id);
      const round2 = rows.filter((r) => r.round === 2);
      assert.equal(round2.length, 1, "the new round shows on the board");
      assert.equal(round2[0].firedAtApprox, false, "a stamped round must NOT render as approximate");
    });

    await scenario(2, "a tick is idempotent under a repeated POST (double-tap / offline retry)", async () => {
      const id = await seedTab("ORD-LIVE-0002");
      const rows = await boardOf(id);
      const ref = rows[0].ref;

      // The POST route's exact write, twice.
      await KotTick.updateOne({ _id: id }, { $addToSet: { refs: ref } }, { upsert: true });
      await KotTick.updateOne({ _id: id }, { $addToSet: { refs: ref } }, { upsert: true });

      const stored = await KotTick.findById(id).lean();
      assert.equal(stored?.refs.length, 1, "$addToSet must not accumulate a duplicate ref");

      const after = await boardOf(id);
      assert.equal(after.length, rows.length - 1, "the ticked line leaves the board exactly once");
      assert.ok(!after.some((r) => r.ref === ref), "the ticked ref is gone");
    });

    await scenario(3, "THE HEADLINE INVARIANT — a partial void of line B does not move or lose line A's tick", async () => {
      const id = await seedTab("ORD-LIVE-0003");
      const before = await boardOf(id);
      const lineA = before.find((r) => r.name === "Masala Chai");
      const lineB = before.find((r) => r.name === "Veg Sandwich");
      assert.ok(lineA && lineB, "both seeded lines must be on the board");

      // Tick line A.
      await KotTick.updateOne({ _id: id }, { $addToSet: { refs: lineA.ref } }, { upsert: true });

      // Now partially void line B THROUGH THE REAL RESOLVER, so items[] is
      // rewritten exactly as the void route rewrites it.
      const old = await Order.findById(id).lean();
      assert.ok(old);
      const bIndex = old.items.findIndex((it) => String(it.productId) === String(PRODUCT_B));
      // The void validates its echo with orderLineKey (qty-INCLUSIVE), NOT
      // kotLineRef (qty-free). Using the void's own key here is the point of
      // the scenario: the two schemes must coexist — the void guards on the
      // qty the operator saw, while the kitchen tick survives the qty change
      // that same void causes.
      const resolved = resolveItemVoid({
        items: old.items,
        request: {
          index: bIndex,
          lineKey: orderLineKey({ ...old.items[bIndex], productId: String(old.items[bIndex].productId) }),
          qty: 1,
          reason: "live leg",
          voidedBy: "Live Leg",
          at: new Date(),
        },
        discount: old.discount,
        discountKind: old.discountKind,
        reward: undefined,
        charge: old.chargeAmount ?? 0,
        gstCfg: GST_OFF,
      });
      assert.ok(!("error" in resolved), `the void must resolve: ${"error" in resolved ? resolved.error : ""}`);
      await Order.updateOne({ _id: id }, { $set: { items: resolved.nextItems } });

      const after = await boardOf(id);
      assert.ok(
        !after.some((r) => r.ref === lineA.ref),
        "line A's tick must SURVIVE the sibling void — a ref that shifted here would resurrect cooked food",
      );
      const bAfter = after.find((r) => r.name === "Veg Sandwich");
      assert.ok(bAfter, "line B must still be on the board (only part of it was voided)");
      assert.equal(bAfter.qty, 2, "line B's qty reflects the void (3 - 1)");
      assert.equal(bAfter.ref, lineB.ref, "line B's REF is unchanged by its own qty reduction (the ref is qty-free)");
    });

    await scenario(4, "a settled tab drops off the board entirely (no ticks accrue to closed orders)", async () => {
      const id = await seedTab("ORD-LIVE-0004");
      assert.ok((await boardOf(id)).length > 0, "open tab is on the board");
      await Order.updateOne({ _id: id }, { $set: { status: "Completed", payment: "Cash", paidAmount: 350 } });
      assert.equal((await boardOf(id)).length, 0, "a settled tab contributes no lines");
    });
  } finally {
    await Order.deleteMany({});
    await KotTick.deleteMany({});
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "live leg failed");
  process.exit(1);
});
