/**
 * Print customization S8 live leg - the token board. Drives the REAL route handlers (POST /api/orders, items, settle,
 * cancel, GET/POST /api/kitchen, GET /api/tokens, POST /api/tokens/[id], PUT /api/settings) against a real mongod.
 * Only `@/lib/auth` is swapped for a signed-in ADMIN stub (the cancel route is admin-only), seeded into the CJS
 * module cache before any route loads, so every leg runs the routes' exact validators, gates and writes.
 * The legs (T1..T11) live in verify-token-live-legs.ts; this file owns the guard, the stub and the drop.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_tokens node --import tsx scripts/verify-token-live.ts
 *
 * SAFETY: refuses any database whose name lacks the scratch prefix, drops the whole scratch database at start and
 * end, prints pass/fail only. (console output is intentional - this is an ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import mongoose from "mongoose";
// None of these reach @/lib/api-helpers (the only importer of @/lib/auth); the routes that do load in main().
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { KotTick } from "@/models/KotTick";
import { Product } from "@/models/Product";
import { Settings } from "@/models/Settings";
import { invalidateSettingsCache } from "@/lib/settings";
import { PRODUCT_ID, PRODUCT_PRICE, runTokenBoardLegs, type Routes } from "./verify-token-live-legs";
import { baseResetMinutes } from "./verify-token-live-clock";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}tokens`;
const STAFF_ID = "665f0000000000000000beef";
const TOKEN_START = 1;

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
stubAuth();

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
}

async function loadRoutes(): Promise<Routes> {
  return {
    create: await import("@/app/api/orders/route"),
    settle: await import("@/app/api/orders/[id]/settle/route"),
    cancel: await import("@/app/api/orders/[id]/cancel/route"),
    items: await import("@/app/api/orders/[id]/items/route"),
    kitchen: await import("@/app/api/kitchen/route"),
    tokens: await import("@/app/api/tokens/route"),
    tokenId: await import("@/app/api/tokens/[id]/route"),
    settings: await import("@/app/api/settings/route"),
  };
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) throw new Error(`Refusing to run against "${dbName}" - scratch (${SCRATCH_PREFIX}*) databases only.`);
  process.env.MONGODB_URI = uri;
  const routes = await loadRoutes();
  await connectDB();
  await mongoose.connection.dropDatabase();
  await Promise.all([Order.createIndexes(), KotTick.createIndexes()]);
  // The order routes refuse a line whose product is missing or whose name/price differ from the menu.
  await Product.create({ _id: PRODUCT_ID, name: "Tea", categoryId: new mongoose.Types.ObjectId(), price: PRODUCT_PRICE });
  // No tokenReadyClearMinutes on purpose: T4 proves the 10-minute DEFAULT. The restart time is derived from the clock so the
  // business day began 6 h ago: the legs' back-dated orders (minutes to a few hours) never cross the day start, at any IST hour.
  await Settings.create({ tokenEnabled: true, tokenNumberStart: TOKEN_START, numberResetMinutes: baseResetMinutes() });
  invalidateSettingsCache();
  console.log(`\nS8 token board - live against ${dbName}\n`);
  try {
    await runTokenBoardLegs(routes, check);
  } finally {
    mongoose.set("debug", false);
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
