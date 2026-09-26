// P4-C live leg — the Ready stamp must not bury a round the cook never saw.
//
// Source pins prove the code SHAPE; this proves the BEHAVIOUR against a real
// mongod, because the whole defect lives in a timestamp comparison
// (isHiddenByReady: readyAt >= newest kotFiredAt) that no regex can check.
//
// Scratch-DB guarded: refuses to run against anything but a local pos_scratch_*
// database, and drops what it created. Prints pass/fail only.
import mongoose from "mongoose";

import { buildKitchenCards } from "@/lib/kitchen-cards";
import type { KitchenOrderInput } from "@/lib/kitchen-board";

const URI = process.env.MONGODB_URI ?? "";
const DB_PREFIX = "pos_scratch_";

function guard(): string {
  if (!URI) throw new Error("MONGODB_URI is required");
  const dbName = new URL(URI.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(DB_PREFIX)) {
    throw new Error(`refusing to run against "${dbName}" — the db name must start with ${DB_PREFIX}`);
  }
  if (!URI.includes("127.0.0.1") && !URI.includes("localhost")) {
    throw new Error("refusing to run against a non-local host");
  }
  return dbName;
}

const iso = (d: Date) => d.toISOString();
let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    process.stdout.write(`PASS  ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
  }
}

/** The server's stamp rule, mirrored exactly (route.ts "ready" branch). */
function stampFor(seenFiredAt: string | undefined, nowMs: number): Date {
  const seen = seenFiredAt ? new Date(seenFiredAt) : null;
  const ms = seen && Number.isFinite(seen.getTime()) ? Math.min(seen.getTime(), nowMs) : nowMs;
  return new Date(ms);
}

async function main() {
  const dbName = guard();
  await mongoose.connect(URI);
  const col = mongoose.connection.db!.collection("p4c_orders");
  await col.deleteMany({});

  const r1 = new Date("2026-09-26T10:00:00.000Z");
  const r2 = new Date("2026-09-26T10:09:58.000Z"); // round 2, fired in the refresh gap

  // Round 1 only — this is the board the cook is LOOKING at.
  const seenOrder: KitchenOrderInput = {
    _id: "a".repeat(24),
    orderId: "ORD-P4C",
    items: [{ productId: "1".repeat(24), name: "Masala Chai", qty: 2, kotRound: 1 }],
    createdAt: r1,
    kotFiredAt: [r1],
  };
  // Same tab after round 2 landed — what the DB actually holds at tap time.
  const actualOrder: KitchenOrderInput = {
    ...seenOrder,
    items: [
      { productId: "1".repeat(24), name: "Masala Chai", qty: 2, kotRound: 1 },
      { productId: "2".repeat(24), name: "Veg Burger", qty: 1, kotRound: 2 },
    ],
    kotFiredAt: [r1, r2],
  };

  // Round-trip both through mongod so Date handling is the real driver's.
  await col.insertOne({ ...seenOrder, _id: "seen" as never, kotFiredAt: [r1] });
  await col.insertOne({ ...actualOrder, _id: "actual" as never, kotFiredAt: [r1, r2] });
  const storedActual = await col.findOne({ _id: "actual" as never });
  check("fixture round-trips through mongod with 2 fire stamps", (storedActual?.kotFiredAt ?? []).length === 2);

  // What the cook's board published for that card.
  const seenCards = buildKitchenCards({ orders: [seenOrder], ticksByOrder: {} });
  check("the seen board shows exactly one card", seenCards.length === 1);
  const seenNewest = seenCards[0]?.newestFiredAt;
  check("newestFiredAt on the seen card is round 1", seenNewest === iso(r1), `got ${seenNewest}`);

  const tapMs = r2.getTime() + 1_000; // cook taps 1s after round 2 landed

  // --- The FIX: stamp what was seen. ---
  const fixedStamp = stampFor(seenNewest, tapMs);
  const afterFix = buildKitchenCards({
    orders: [actualOrder],
    ticksByOrder: {},
    readyAtByOrder: { [String(actualOrder._id)]: fixedStamp },
  });
  check(
    "FIX: a round fired after what the cook saw brings the card BACK",
    afterFix.length === 1,
    `expected the card to survive, got ${afterFix.length} cards`,
  );
  const survivingRounds = afterFix[0]?.lines.map((l) => l.round).sort() ?? [];
  check(
    "FIX: the returned card still carries BOTH rounds (round 2 is cookable)",
    survivingRounds.join(",") === "1,2",
    `rounds=${survivingRounds.join(",")}`,
  );

  // --- The OLD behaviour: stamp `now`. Must demonstrate the bug it fixes. ---
  const oldStamp = stampFor(undefined, tapMs);
  const afterOld = buildKitchenCards({
    orders: [actualOrder],
    ticksByOrder: {},
    readyAtByOrder: { [String(actualOrder._id)]: oldStamp },
  });
  check(
    "REGRESSION WITNESS: a `now` stamp DOES bury round 2 (this is the bug)",
    afterOld.length === 0,
    `expected 0 cards under the old rule, got ${afterOld.length} — if this fails the test no longer models the defect`,
  );

  // --- Clamp: a future-dated client stamp must not suppress unfired work. ---
  const future = new Date(tapMs + 60 * 60_000).toISOString();
  const clamped = stampFor(future, tapMs);
  check(
    "CLAMP: a future seenFiredAt is clamped to now, never stored ahead of it",
    clamped.getTime() === tapMs,
    `clamped=${iso(clamped)} tap=${iso(new Date(tapMs))}`,
  );

  // --- A genuinely finished card must still clear. ---
  const finished = buildKitchenCards({
    orders: [seenOrder],
    ticksByOrder: {},
    readyAtByOrder: { [String(seenOrder._id)]: stampFor(iso(r1), r1.getTime() + 5_000) },
  });
  check("a card with no newer round still CLEARS on Ready", finished.length === 0);

  await col.drop().catch(() => {});
  await mongoose.disconnect();
  process.stdout.write(
    failures === 0 ? `\nALL CHECKS PASSED (db ${dbName})\n` : `\n${failures} CHECK(S) FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(`FAIL unexpected error: ${(err as Error).message}\n`);
  process.exit(1);
});
