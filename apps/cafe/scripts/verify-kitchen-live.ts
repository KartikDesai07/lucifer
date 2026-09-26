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
import { buildKitchenCards } from "@/lib/kitchen-cards";
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

/** Same query shape as the GET /api/kitchen route (orders + ticks incl.
 *  readyAt), fed through buildKitchenCards — the CARD view, not the line
 *  view boardOf gives. Used by the scenarios below that assert on the CARD
 *  staying/leaving the board, not just individual lines. */
async function cardsOf(id: string): Promise<ReturnType<typeof buildKitchenCards>> {
  const orders = await Order.find({ _id: id, status: "Pending", payment: "Unpaid", kotRounds: { $gte: 1 } })
    .select("orderId items kotRounds kotNumbers kotFiredAt tableNo notes source createdAt")
    .lean();
  const ticks = await KotTick.find({ _id: { $in: [id] } }).select("refs readyAt").lean();
  const ticksByOrder: Record<string, string[]> = {};
  const readyAtByOrder: Record<string, Date | undefined> = {};
  for (const tick of ticks) {
    ticksByOrder[tick._id] = tick.refs;
    if (tick.readyAt) readyAtByOrder[tick._id] = tick.readyAt;
  }
  return buildKitchenCards({ orders: orders as unknown as KitchenOrderInput[], ticksByOrder, readyAtByOrder });
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

    await scenario(2, "a tick is idempotent under a repeated POST (double-tap / offline retry) — the line STAYS, done:true, the card STAYS", async () => {
      const id = await seedTab("ORD-LIVE-0002");
      const rows = await boardOf(id);
      const ref = rows[0].ref;

      // The POST route's exact write, twice.
      await KotTick.updateOne({ _id: id }, { $addToSet: { refs: ref } }, { upsert: true });
      await KotTick.updateOne({ _id: id }, { $addToSet: { refs: ref } }, { upsert: true });

      const stored = await KotTick.findById(id).lean();
      assert.equal(stored?.refs.length, 1, "$addToSet must not accumulate a duplicate ref");

      // P4-B: ticked lines STAY on the board (they used to be dropped here).
      const after = await boardOf(id);
      assert.equal(after.length, rows.length, "the ticked line stays on the board — the count must not drop");
      const tickedRow = after.find((r) => r.ref === ref);
      assert.ok(tickedRow, "the ticked ref must still be PRESENT");
      assert.equal(tickedRow?.done, true, "the ticked ref must read done === true");

      // The CARD, not the line, is what would leave — and it has not been
      // marked Ready, so it must still be on the board too.
      const cards = await cardsOf(id);
      assert.equal(cards.length, 1, "the card stays on the board — only a Ready tap removes a card");
    });

    await scenario(3, "THE HEADLINE INVARIANT — a partial void of line B does not move or lose line A's tick (line A STAYS, done:true; the card STAYS)", async () => {
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

      // Confirm the stored KotTick doc still carries exactly one copy of
      // lineA's ref — $addToSet's own dedupe guarantee, checked against the
      // real stored document, not just the rebuilt board.
      const storedTick = await KotTick.findById(id).lean();
      const matchingRefs = (storedTick?.refs ?? []).filter((r) => r === lineA.ref);
      assert.equal(matchingRefs.length, 1, "$addToSet must have stored exactly ONE copy of line A's ref");

      const after = await boardOf(id);
      const tickedA = after.find((r) => r.ref === lineA.ref);
      assert.ok(tickedA, "line A must STAY on the board — a tick no longer removes the row");
      assert.equal(tickedA?.done, true, "line A must read done === true");
      assert.equal(tickedA?.ref, lineA.ref, "line A's ref must be byte-identical post-void — a ref that shifted here would resurrect cooked food");

      const bAfter = after.find((r) => r.name === "Veg Sandwich");
      assert.ok(bAfter, "line B must still be on the board (only part of it was voided)");
      assert.equal(bAfter.done, false, "line B must read done === false — it was never ticked");
      assert.equal(bAfter.qty, 2, "line B's qty reflects the void (3 - 1)");
      assert.equal(bAfter.ref, lineB.ref, "line B's REF is unchanged by its own qty reduction (the ref is qty-free)");

      // The CARD stays too — nothing here marked the order Ready.
      const cards = await cardsOf(id);
      assert.equal(cards.length, 1, "the card stays on the board — a sibling void never clears a card");
      assert.equal(cards[0].totalCount, 2, "the card's totalCount reflects both surviving lines");
      assert.equal(cards[0].doneCount, 1, "exactly one of the two lines (A) is done");
    });

    await scenario(4, "a settled tab drops off the board entirely (no ticks accrue to closed orders)", async () => {
      const id = await seedTab("ORD-LIVE-0004");
      assert.ok((await boardOf(id)).length > 0, "open tab is on the board");
      await Order.updateOne({ _id: id }, { $set: { status: "Completed", payment: "Cash", paidAmount: 350 } });
      assert.equal((await boardOf(id)).length, 0, "a settled tab contributes no lines");
    });

    await scenario(5, "a Ready write ($set readyAt) makes the card disappear; $unset brings it back — the marker round-trips through Mongoose", async () => {
      const id = await seedTab("ORD-LIVE-0005");
      assert.equal((await cardsOf(id)).length, 1, "the card starts on the board");

      // The route's exact Ready write: $set readyAt.
      await KotTick.updateOne({ _id: id }, { $set: { readyAt: new Date() } }, { upsert: true });

      const storedReady = await KotTick.findById(id).lean();
      assert.ok(storedReady?.readyAt instanceof Date, "readyAt must be stored as a real Date — a Zod-valid field a strict schema silently drops is the classic silent loss");

      assert.equal((await cardsOf(id)).length, 0, "the card must disappear once readyAt covers the only fired round");

      // The route's exact un-Ready write: $unset, never null (readiness is
      // read as field PRESENCE, not a boolean value).
      await KotTick.updateOne({ _id: id }, { $unset: { readyAt: "" } });

      const storedUnset = await KotTick.findById(id).lean();
      assert.equal(storedUnset?.readyAt, undefined, "$unset must remove the field entirely, not null it");

      assert.equal((await cardsOf(id)).length, 1, "the card must come back once readyAt is unset");
    });

    await scenario(6, "THE LOST-TICKET LEG — mark an order Ready, fire a LATER round on the same still-open tab, and the card comes BACK with the new round's line", async () => {
      const id = await seedTab("ORD-LIVE-0006");
      assert.equal((await cardsOf(id)).length, 1, "the card starts on the board");

      // Mark it Ready — the route's exact write.
      await KotTick.updateOne({ _id: id }, { $set: { readyAt: new Date() } }, { upsert: true });
      assert.equal((await cardsOf(id)).length, 0, "the card must be hidden immediately after the Ready tap");

      // The tab is STILL OPEN (status Pending, payment Unpaid — seedTab's own
      // shape), so staff can fire another round on it. Write the newer
      // kotFiredAt entry the way the /items route does: POSITIONALLY, one
      // slot per round, backfilling any earlier holes from the existing doc.
      const old = await Order.findById(id).lean();
      assert.ok(old);
      const round = (old.kotRounds ?? 0) + 1;
      const firedAt = new Date();
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

      const cards = await cardsOf(id);
      assert.equal(cards.length, 1, "THE LOST-TICKET RULE: a round fired after the Ready tap must bring the card straight back — a real ticket can never be silently lost");
      const newRoundLine = cards[0].lines.find((l) => l.round === round);
      assert.ok(newRoundLine, "the new round's line must be among the card's lines");
      assert.equal(cards[0].allDone, false, "the newly-fired line is not done — the card is genuinely back to work, not just visually present");
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
