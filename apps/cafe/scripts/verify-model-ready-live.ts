/**
 * Model.init() race live leg: proves modelReady() (lib/db.ts) against a REAL MongoDB. mongoose memoizes a model's
 * init(); with connectDB()'s bufferCommands:false a model compiled while the connection is still connecting gets a
 * REJECTED init memo for the process's life. Steps:
 *   1. the race as it is: two fresh models compiled while connecting, init() rejects for both (the intended
 *      tripwire: it fails when a mongoose upgrade fixes the race, then revisit modelReady);
 *   2. recovery: modelReady(A) resolves, the unique index exists, a duplicate insert answers 11000, a second call
 *      sends no createCollection/createIndexes;
 *   3. fail closed: duplicate rows exist before any index, modelReady(B) rejects with 11000, rejects again on the
 *      next call, and resolves once the duplicate row is removed (the unique index then exists).
 *
 *   npm run verify:model-ready:live
 *
 * SAFETY: refuses any database but exactly pos_scratch_model_ready_live, and only ever drops that one (at the start
 * through a separate scratch connection, at the end in finally).
 * (console output is intentional: this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { connectDB, modelReady } from "@/lib/db";

const SCRATCH_PREFIX = "pos_scratch_";
const DB_NAME = "pos_scratch_model_ready_live";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
}

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 90) : String(error);
}
async function outcome(p: Promise<unknown>): Promise<{ ok: boolean; error?: unknown }> {
  try {
    await p;
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function buildModel(name: string, collection: string) {
  return mongoose.model(name, new mongoose.Schema({ name: { type: String, unique: true } }), collection);
}

/** Counts calls to createCollection/createIndexes on one model while it runs fn; restores the originals. */
async function countFallbackCalls(model: ReturnType<typeof buildModel>, fn: () => Promise<void>): Promise<number> {
  let calls = 0;
  const origIndexes = model.createIndexes.bind(model);
  const origCollection = model.createCollection.bind(model);
  const spy = model as unknown as { createIndexes: unknown; createCollection: unknown };
  spy.createIndexes = (...args: unknown[]) => {
    calls++;
    return (origIndexes as (...a: unknown[]) => unknown)(...args);
  };
  spy.createCollection = (...args: unknown[]) => {
    calls++;
    return (origCollection as (...a: unknown[]) => unknown)(...args);
  };
  try {
    await fn();
  } finally {
    spy.createIndexes = origIndexes;
    spy.createCollection = origCollection;
  }
  return calls;
}

async function hasUniqueNameIndex(model: ReturnType<typeof buildModel>): Promise<{ ok: boolean; detail: string }> {
  const indexes = await model.collection.indexes().catch(() => []);
  const found = indexes.find((i) => i.unique === true && JSON.stringify(i.key) === JSON.stringify({ name: 1 }));
  return { ok: found !== undefined, detail: `indexes: ${indexes.map((i) => i.name).join(", ")}` };
}

/** Drops exactly DB_NAME through its own connection (never the app's default one). */
async function dropScratch(uri: string): Promise<void> {
  const scratch = await mongoose.createConnection(uri).asPromise();
  try {
    if (scratch.name !== DB_NAME) throw new Error(`Refusing to drop "${scratch.name}".`);
    await scratch.dropDatabase();
  } finally {
    await scratch.close();
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX) || dbName !== DB_NAME) {
    throw new Error(`Refusing to run against "${dbName}": the live leg only touches the database ${DB_NAME}.`);
  }
  process.env.MONGODB_URI = uri;

  // Clean slate through a SEPARATE connection: the app's default connection must stay un-opened for step 1.
  await dropScratch(uri);

  console.log(`\nmodelReady live leg: live against ${dbName}\n`);

  try {
    // Step 1: the race as it is.
    const connecting = connectDB(); // un-awaited: the app's real options and cache
    const state = mongoose.connection.readyState;
    check("1a. the default connection is still connecting (readyState 2)", state === 2, `readyState ${state}`);
    const A = buildModel("ModelReadyLiveA", "model_ready_live_a");
    const B = buildModel("ModelReadyLiveB", "model_ready_live_b");
    await connecting;
    // Intended tripwire: if a mongoose upgrade fixes the race, these fail; then revisit modelReady.
    for (const [label, model] of [["A", A], ["B", B]] as const) {
      const r = await outcome(model.init());
      check(`1b. model ${label} compiled while connecting: init() rejects (the bug as it is)`, !r.ok, r.ok ? "resolved" : messageOf(r.error));
    }

    // Step 2: recovery on model A.
    const ready = await outcome(modelReady(A));
    check("2a. modelReady(A) resolves", ready.ok, ready.ok ? "resolved" : messageOf(ready.error));
    const idx = await hasUniqueNameIndex(A);
    check("2b. the unique index on { name: 1 } exists", idx.ok, idx.detail);
    await A.collection.insertOne({ name: "dup" });
    const dup = await outcome(A.collection.insertOne({ name: "dup" }));
    check("2c. a duplicate insert answers 11000", !dup.ok && codeOf(dup.error) === 11000, dup.ok ? "inserted" : `code ${String(codeOf(dup.error))}`);
    let second = await outcome(Promise.resolve());
    const calls = await countFallbackCalls(A, async () => {
      second = await outcome(modelReady(A));
    });
    check("2d. a second modelReady(A) resolves and sends no createCollection/createIndexes", second.ok && calls === 0, `calls ${calls}`);

    // Step 3: fail closed on model B (raw duplicate rows before any index exists).
    const pre = await B.collection.indexes().catch(() => [] as { name?: string }[]);
    check("3a. model B has no unique index yet", !pre.some((i) => i.name === "name_1"), `indexes: ${pre.map((i) => i.name).join(", ") || "none"}`);
    const inserted = await B.collection.insertMany([{ name: "twin" }, { name: "twin" }]);
    check("3b. two rows with the same name inserted raw", inserted.insertedCount === 2, `inserted ${inserted.insertedCount}`);
    const first = await outcome(modelReady(B));
    check("3c. modelReady(B) rejects with 11000", !first.ok && codeOf(first.error) === 11000, first.ok ? "resolved" : `code ${String(codeOf(first.error))}: ${messageOf(first.error)}`);
    const again = await outcome(modelReady(B));
    check("3d. the next modelReady(B) rejects with 11000 again (failure not memoized)", !again.ok && codeOf(again.error) === 11000, again.ok ? "resolved" : `code ${String(codeOf(again.error))}`);
    const removed = await B.collection.deleteOne({ name: "twin" });
    check("3e. one duplicate row removed", removed.deletedCount === 1, `deleted ${removed.deletedCount}`);
    const healed = await outcome(modelReady(B));
    check("3f. modelReady(B) resolves once the duplicate is gone", healed.ok, healed.ok ? "resolved" : messageOf(healed.error));
    const idxB = await hasUniqueNameIndex(B);
    check("3g. the unique index on { name: 1 } now exists", idxB.ok, idxB.detail);
  } finally {
    if (mongoose.connection.name === DB_NAME) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    // mongoose's dropDatabase / close only clear each model's memoized $init; this second drop, through its own
    // connection after disconnect, is defensive: it leaves nothing behind even if the first drop was skipped.
    await dropScratch(uri);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
