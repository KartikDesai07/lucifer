/**
 * CB-7 S6 live leg - spending reward POINTS on a bill (the money path), through the REAL route handlers against a real
 * mongod: the probe of the two guarded writes (p0), FIFO lots (p1), the use-by instant (p2), the barrier race of two
 * settles (p3), a short balance / a bill smaller than the ask (p4, p5), the settle CAS miss after the spend (p6), cancel
 * (p7), an evicted lot (p8), Pay-Now: Pending refused, the send-key twin, the renumber retry (p9), one reward per bill
 * (p10), the diner-accounts gate (p11), the strict-schema round trip (p12) and the QR points ASK (q1-q6).
 *
 *   npm run verify:reward-points:live          (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reward_points npm run verify:reward-points:live
 *
 * Legs live in reward-points-live-legs-*.ts (kit: reward-points-live-kit.ts, on top of the S5 card kit). Lots are seeded
 * straight onto the Customer row as the engine writes them at the scratch (revealed, pointsSpent 0); Settings is written
 * straight too (the levels launch lock bypassed).
 *
 * SAFETY: refuses to run against any database whose name does not carry the scratch prefix, and drops THIS script's own
 * scratch database in `finally` (never a list-and-drop by prefix). (console output is intentional - ops CLI script.)
 */
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { installStubs, loadApi, seedMenu, type Scenario } from "./reward-card-use-live-kit";
import { runSpendLegs } from "./reward-points-live-legs-spend";
import { runReturnLegs } from "./reward-points-live-legs-return";
import { runGateLegs } from "./reward-points-live-legs-gates";
import { runQrPointsLegs } from "./reward-points-live-legs-qr";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reward_points`;

let passed = 0;
let failed = 0;

const scenario: Scenario = async (id, name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${id}. ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${id}. ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
};

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" - the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }
  process.env.MONGODB_URI = uri;
  delete process.env.TENANT_ID;
  installStubs();
  await connectDB();
  console.log(`\nreward points - live against ${dbName}\n`);

  try {
    const api = await loadApi();
    // The orderId / send-key unique indexes must exist before the twin and renumber legs rely on them.
    await Promise.allSettled(Object.values(mongoose.models).map((model) => model.init()));
    const menu = await seedMenu();
    const ctx = { api, menu, scenario };
    await runSpendLegs(ctx);
    await runReturnLegs(ctx);
    await runGateLegs(ctx);
    await runQrPointsLegs(ctx);
  } finally {
    // Wait for every model's background index build, or a build landing after the drop leaves an empty database behind.
    await Promise.allSettled(Object.values(mongoose.models).map((model) => model.init()));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
