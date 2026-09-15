/**
 * CB-DL-1 S6 live leg — proves GET /api/bootstrap's payload builder against a
 * REAL MongoDB, which the DB-free pins cannot: that every part is BYTE-EQUAL to
 * what the five master routes serve (same list functions AND the same raw query
 * shapes those routes had before S1), that `mastersVersion` really moves on an
 * update and on a HARD delete, that it does NOT move across two `getSettings()`
 * calls with the cache cleared between them (the S0 read-first fix — the old
 * unconditional `$setOnInsert` upsert rewrote `updatedAt` on every cache miss),
 * and that the payload fits well inside Vercel's request/response body budget.
 *
 *   npm run verify:bootstrap:live      (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_bootstrap npm run verify:bootstrap:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops only the five collections it creates.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { seedMasters, type SeedCounts } from "./verify-bootstrap-live/fixture";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}bootstrap`;

// Well under Vercel's 4.5 MB body cap — a master payload this size would
// already be a design problem long before the platform limit bit.
const PAYLOAD_CEILING_BYTES = 1_500_000;
const BUILD_BUDGET_MS = 2000;
// The client's live product count, for the extrapolated payload figure below.
const LIVE_PRODUCT_COUNT = 173;
// `at` must be a timestamp from THIS run, not a fixture leftover.
const RECENT_AT_MS = 60_000;

const MASTERS_VERSION_RE =
  /^settings:\d+:\d+\|categories:\d+:\d+\|products:\d+:\d+\|tables:\d+:\d+\|staff:\d+:\d+$/;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

// JSON-normalised deep equality: the payload's parts are the same lean rows the
// routes hand to `success()`, so comparing them AFTER the envelope's JSON
// serialisation is exactly the parity the client sees (ObjectId/Date -> string).
function json(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function deepEqual(label: string, actual: unknown, expected: unknown): void {
  try {
    assert.deepStrictEqual(json(actual), json(expected));
    check(label, true);
  } catch (error) {
    check(label, false);
    console.log(`       ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  // MUST precede every app-code import: connectDB() reads process.env.MONGODB_URI
  // lazily and caches ONE connection on the Node global, so the libraries below
  // (and therefore the real route path) target this scratch database.
  process.env.MONGODB_URI = uri;

  const { connectDB } = await import("@/lib/db");
  const { buildBootstrap } = await import("@/lib/bootstrap");
  const { BOOTSTRAP_VERSION, mastersVersionOf } = await import("@/lib/bootstrap-contract");
  type MastersParts = import("@/lib/bootstrap-contract").MastersParts;
  const { listCategories, listProducts, listStaff, listTables } = await import("@/lib/masters");
  const { getSettings, readSettings, SETTINGS_CACHE_KEY } = await import("@/lib/settings");
  const { default: cache } = await import("@/lib/cache");
  const { Settings } = await import("@/models/Settings");
  const { Category } = await import("@/models/Category");
  const { Product } = await import("@/models/Product");
  const { Table } = await import("@/models/Table");
  const { Staff } = await import("@/models/Staff");

  // The five cache keys `listFromSpec`/`getSettings` write, read off the specs so
  // this leg cannot clear a different key than the code under test caches under.
  const { CATEGORY_LIST, PRODUCT_LIST, TABLE_LIST, STAFF_LIST } = await import("@/lib/masters");
  const CACHE_KEYS = [
    SETTINGS_CACHE_KEY,
    CATEGORY_LIST.cacheKey,
    PRODUCT_LIST.cacheKey,
    TABLE_LIST.cacheKey,
    STAFF_LIST.cacheKey,
  ];
  const clearMasterCaches = (): void => {
    for (const key of CACHE_KEYS) cache.del(key);
  };

  await connectDB();
  // Clean slate even after a crashed prior run (the prefix guard above already
  // fenced this to a scratch database).
  await mongoose.connection.dropDatabase();
  await Promise.all([
    Settings.createIndexes(),
    Category.createIndexes(),
    Product.createIndexes(),
    Table.createIndexes(),
    Staff.createIndexes(),
  ]);

  console.log(`\nCB-DL-1 bootstrap payload — live against ${dbName}\n`);

  const seeded: SeedCounts = await seedMasters({ Settings, Category, Product, Table, Staff });
  clearMasterCaches();

  // ── 1. every part is byte-equal to the SAME function the route calls ───────
  const coldStart = Date.now();
  const payload = await buildBootstrap({ includeStaff: true });
  const coldMs = Date.now() - coldStart;

  deepEqual("settings part === getSettings() (the settings route's own getter)", payload.settings, await getSettings());
  deepEqual("categories part === listCategories() (GET /api/categories' list)", payload.categories, await listCategories());
  deepEqual("products part === listProducts() (GET /api/products' unfiltered list)", payload.products, await listProducts());
  deepEqual("tables part === listTables() (GET /api/tables' list)", payload.tables, await listTables());
  deepEqual("staff part === listStaff() (GET /api/staff's list)", payload.staff, await listStaff());

  // Route-truth: the EXACT query shapes the four routes carried before S1
  // extracted them into lib/masters.ts — a spec that silently changed a sort or
  // a filter would still agree with itself above, but not with these.
  deepEqual(
    "categories part === Category.find().sort({order:1,name:1}) (pre-S1 route query)",
    payload.categories,
    await Category.find().sort({ order: 1, name: 1 }).lean(),
  );
  deepEqual(
    "products part === Product.find({isActive:true}).sort({name:1}) (pre-S1 route query, categoryId sort is meaningless)",
    payload.products,
    await Product.find({ isActive: true }).sort({ name: 1 }).lean(),
  );
  deepEqual(
    "tables part === Table.find().sort({displayOrder:1,tableNo:1}) (pre-S1 route query)",
    payload.tables,
    await Table.find().sort({ displayOrder: 1, tableNo: 1 }).lean(),
  );
  deepEqual(
    'staff part === Staff.find().select("-password").sort({name:1}) (pre-S1 route query)',
    payload.staff,
    await Staff.find().select("-password").sort({ name: 1 }).lean(),
  );

  // ── 2. the archived product is filtered out; no password ever ships ────────
  const names = payload.products.map((p) => p.name);
  check(
    `the archived (isActive:false) product is absent from the products part (${names.length} of ${seeded.products} rows)`,
    !names.includes(seeded.archivedProductName),
  );
  check("products part carries exactly the 5 active products", payload.products.length === 5);
  const staffRows = json(payload.staff) as Record<string, unknown>[];
  check(
    "no staff row carries a password key",
    staffRows.length === seeded.staff && staffRows.every((row) => !Object.hasOwn(row, "password")),
  );

  // ── 3. includeStaff:false drops ONLY the staff part ────────────────────────
  const noStaff = await buildBootstrap({ includeStaff: false });
  check("includeStaff:false yields staff === null (non-admin session)", noStaff.staff === null);
  deepEqual("includeStaff:false settings part matches the admin payload", noStaff.settings, payload.settings);
  deepEqual("includeStaff:false categories part matches the admin payload", noStaff.categories, payload.categories);
  deepEqual("includeStaff:false products part matches the admin payload", noStaff.products, payload.products);
  deepEqual("includeStaff:false tables part matches the admin payload", noStaff.tables, payload.tables);

  // ── 4. envelope fields ────────────────────────────────────────────────────
  check(`v === BOOTSTRAP_VERSION (${BOOTSTRAP_VERSION})`, payload.v === BOOTSTRAP_VERSION);
  const atMs = Date.parse(payload.at);
  check(
    "at parses as a recent ISO timestamp",
    Number.isFinite(atMs) && payload.at === new Date(atMs).toISOString() && Date.now() - atMs < RECENT_AT_MS,
  );
  check(`mastersVersion matches the documented format (${payload.mastersVersion})`, MASTERS_VERSION_RE.test(payload.mastersVersion));
  check(
    "mastersVersion equals mastersVersionOf() recomputed from the payload's own parts",
    payload.mastersVersion ===
      mastersVersionOf({
        settings: payload.settings,
        categories: payload.categories,
        products: payload.products,
        tables: payload.tables,
        staff: payload.staff,
      }),
  );

  // ── 5. payload size + build budget ────────────────────────────────────────
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  const productBytes = Buffer.byteLength(JSON.stringify(payload.products));
  const perProduct = Math.round(productBytes / payload.products.length);
  const extrapolated = bytes - productBytes + perProduct * LIVE_PRODUCT_COUNT;
  console.log(`\n  payload: ${bytes} bytes for ${payload.products.length} products (${perProduct} bytes/product row)`);
  console.log(`  extrapolated to the live catalogue (${LIVE_PRODUCT_COUNT} products): ~${extrapolated} bytes`);
  check(`payload is under PAYLOAD_CEILING_BYTES (${PAYLOAD_CEILING_BYTES})`, bytes <= PAYLOAD_CEILING_BYTES);
  check(
    `extrapolated live payload is under PAYLOAD_CEILING_BYTES (${PAYLOAD_CEILING_BYTES})`,
    extrapolated <= PAYLOAD_CEILING_BYTES,
  );

  const warmStart = Date.now();
  await buildBootstrap({ includeStaff: true });
  const warmMs = Date.now() - warmStart;
  clearMasterCaches();
  const clearedStart = Date.now();
  await buildBootstrap({ includeStaff: true });
  const clearedMs = Date.now() - clearedStart;
  console.log(`\n  buildBootstrap: cold ${coldMs}ms · warm-cache ${warmMs}ms · after cache.del of the five keys ${clearedMs}ms`);
  check(`cold buildBootstrap is under BUILD_BUDGET_MS (${BUILD_BUDGET_MS})`, coldMs <= BUILD_BUDGET_MS);

  // ── 6. mastersVersion moves on an update AND on a HARD delete ─────────────
  const before = payload.mastersVersion;
  await Product.updateOne({ name: seeded.bumpProductName }, { $set: { price: 999 } });
  cache.del(PRODUCT_LIST.cacheKey);
  const afterUpdate = (await buildBootstrap({ includeStaff: true })).mastersVersion;
  check("mastersVersion CHANGES after a product updateOne (updatedAt component)", afterUpdate !== before);

  await Category.deleteOne({ name: seeded.deleteCategoryName });
  cache.del(CATEGORY_LIST.cacheKey);
  const afterDelete = (await buildBootstrap({ includeStaff: true })).mastersVersion;
  check(
    "mastersVersion CHANGES after a category HARD delete (the count component makes deletes visible)",
    afterDelete !== afterUpdate,
  );

  // ── 7. S0: getSettings() no longer writes on a cache miss ─────────────────
  const rawBefore = await Settings.findOne().lean();
  cache.del(SETTINGS_CACHE_KEY);
  const settingsA = await getSettings();
  cache.del(SETTINGS_CACHE_KEY);
  const settingsB = await getSettings();
  const rawAfter = await Settings.findOne().lean();
  // Same DTO cast lib/bootstrap.ts performs at this boundary: the lean row is
  // what mastersVersionOf() actually reads (`updatedAt`), the payload type is
  // the post-JSON client shape.
  const settingsVersion = (doc: unknown): string =>
    mastersVersionOf({
      settings: doc as MastersParts["settings"],
      categories: [],
      products: [],
      tables: [],
      staff: [],
    });
  const versionA = settingsVersion(settingsA);
  const versionB = settingsVersion(settingsB);
  check(
    "mastersVersion's settings component is UNCHANGED across two getSettings() calls with the cache cleared between (S0 read-first fix)",
    versionA === versionB,
  );
  check(
    "the raw Settings doc's updatedAt is identical before/after those two cache-miss reads (no needless M0 write)",
    String(rawBefore?.updatedAt) === String(rawAfter?.updatedAt),
  );

  // ── 8. readSettings() and getSettings() agree ─────────────────────────────
  cache.del(SETTINGS_CACHE_KEY);
  const read = await readSettings();
  cache.del(SETTINGS_CACHE_KEY);
  deepEqual("readSettings() and getSettings() return deep-equal documents", read, await getSettings());

  // ── teardown: only the five collections this leg created ──────────────────
  await Promise.all(
    [Settings, Category, Product, Table, Staff].map((model) =>
      model.collection.drop().catch(() => undefined),
    ),
  );
  clearMasterCaches();
  await mongoose.disconnect();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
