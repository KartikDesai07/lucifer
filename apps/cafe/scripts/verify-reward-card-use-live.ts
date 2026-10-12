/**
 * CB-7 S5 live leg - using a revealed scratch card on a bill (the money path), through the REAL route handlers against a
 * real mongod: claim -> price -> settle, the claim race, the use-by instant, identity, cancel / release, scope money, the
 * category snapshot, free-item at settle, reassign, one reward per bill, the QR submit + accept, void / table move /
 * QR add-round, the strict-schema round trip, the diner-accounts gate and the zero-match refusal, then the S5b money legs
 * (minBill on the bill without the reward, promo + GST preset, same-key retry at the reward-resolve step).
 *
 *   npm run verify:reward-card-use:live          (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reward_card_use npm run verify:reward-card-use:live
 *
 * Legs live in reward-card-use-live-legs-*.ts (kit: reward-card-use-live-kit.ts). Cards are seeded straight onto the
 * Customer row (a revealed card of the real engine); Settings is written straight too (the levels launch lock bypassed).
 *
 * SAFETY: refuses to run against any database whose name does not carry the scratch prefix, and drops THIS script's own
 * scratch database in `finally` (never a list-and-drop by prefix). (console output is intentional - ops CLI script.)
 */
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { installStubs, loadApi, seedMenu, type Scenario } from "./reward-card-use-live-kit";
import { runClaimLegs } from "./reward-card-use-live-legs-claim";
import { runScopeLegs } from "./reward-card-use-live-legs-scope";
import { runFenceLegs } from "./reward-card-use-live-legs-fence";
import { runQrLegs } from "./reward-card-use-live-legs-qr";
import { runMoneyLegs } from "./reward-card-use-live-legs-money";
import { runAcceptLegs } from "./reward-card-use-live-legs-accept";
import { runChargeLegs } from "./reward-card-use-live-legs-charges";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reward_card_use`;

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
  delete process.env.TENANT_ID; // the public route's host gate: a bare loopback host is the "dev" tenant
  installStubs();
  await connectDB();
  console.log(`\nreward card use - live against ${dbName}\n`);

  try {
    const api = await loadApi();
    const menu = await seedMenu();
    const ctx = { api, menu, scenario };
    await runClaimLegs(ctx);
    await runScopeLegs(ctx);
    await runFenceLegs(ctx);
    await runQrLegs(ctx);
    await runMoneyLegs(ctx);
    await runAcceptLegs(ctx);
    await runChargeLegs(ctx);
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
