// CB-DL-2 S4 T1b — DB-free unit tests for the raw-driver apply-*.ts modules
// (scripts/migrate-links/apply-categories.ts, apply-reset.ts, apply-run.ts).
//
// These modules take a `Db` from the mongodb driver, not a Mongoose model
// (RAW DRIVER ONLY — a schema would cast the very ids/strings being read and
// written). So the fake port here is a MINIMAL in-memory object implementing
// only the `collection(name)` methods the three modules actually call —
// read from source: find()/for-await cursor, find().toArray(), bulkWrite,
// updateMany, deleteMany, countDocuments, insertOne, indexes, dropIndex,
// distinct.
// This is DB-free per the house rule (in-memory fake port), not a "skips the
// real logic" fake — it drives the REAL apply-*.ts functions end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ObjectId } from "mongodb";

import { applyProductCategories, dropLegacyCategory, APPLY_BATCH_SIZE } from "../scripts/migrate-links/apply-categories";
import { applyReset, TABLE_AVAILABLE_STATUS } from "../scripts/migrate-links/apply-reset";
import { runApply } from "../scripts/migrate-links/apply-run";
import { RESET_DEFAULT_COLLECTIONS, type MigrateArgs } from "../scripts/migrate-links/args";

// ── the fake Db port ─────────────────────────────────────────────────────

type Doc = { _id: unknown } & Record<string, unknown>;

interface IndexNotFoundError extends Error {
  code: number;
}

// A minimal find() result: supports for-await (async iterator) AND
// .toArray() — both call shapes the apply-*.ts modules actually use, applying
// the same optional projection (drop keys not listed, always keep _id) the
// real driver would.
function makeFindResult(docs: Doc[], projection?: Record<string, 1>) {
  const project = (d: Doc): Doc => {
    if (!projection) return d;
    const out: Doc = { _id: d._id };
    for (const key of Object.keys(projection)) {
      if (key !== "_id" && Object.hasOwn(d, key)) out[key] = d[key];
    }
    return out;
  };
  const projected = docs.map(project);
  return {
    toArray: async () => projected,
    [Symbol.asyncIterator]: async function* () {
      for (const d of projected) yield d;
    },
  };
}

class FakeCollection {
  docs: Doc[];
  indexNames: Set<string>;

  constructor(seed: Doc[] = [], indexNames: string[] = ["_id_"]) {
    this.docs = seed.map((d) => ({ ...d }));
    this.indexNames = new Set(indexNames);
  }

  find(filter: Record<string, unknown> = {}, options?: { projection?: Record<string, 1> }) {
    const matched = this.docs.filter((d) => matchesFilter(d, filter));
    return makeFindResult(matched, options?.projection);
  }

  async findOne(filter: Record<string, unknown>, options?: { projection?: Record<string, 1> }) {
    const found = this.docs.find((d) => matchesFilter(d, filter));
    if (!found) return null;
    const result = makeFindResult([found], options?.projection);
    const [only] = await result.toArray();
    return only;
  }

  async countDocuments(filter: Record<string, unknown> = {}): Promise<number> {
    return this.docs.filter((d) => matchesFilter(d, filter)).length;
  }

  async insertOne(doc: Doc): Promise<{ insertedId: ObjectId }> {
    const insertedId = (doc._id as ObjectId | undefined) ?? new ObjectId();
    this.docs.push({ ...doc, _id: insertedId });
    return { insertedId };
  }

  async updateMany(
    filter: Record<string, unknown>,
    update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> },
  ): Promise<{ modifiedCount: number }> {
    let modifiedCount = 0;
    for (const d of this.docs) {
      if (!matchesFilter(d, filter)) continue;
      let changed = false;
      if (update.$unset) {
        for (const key of Object.keys(update.$unset)) {
          if (Object.hasOwn(d, key)) {
            delete d[key];
            changed = true;
          }
        }
      }
      if (update.$set) {
        for (const [key, value] of Object.entries(update.$set)) {
          if (d[key] !== value) changed = true;
          d[key] = value;
        }
      }
      if (changed) modifiedCount += 1;
    }
    return { modifiedCount };
  }

  // Documents that re-appear AFTER the next deleteMany — the fake-port model
  // of a write landing inside the closed-shop window, between the reset and
  // the post-apply census. Without this the post-census of a reset collection
  // is always empty and the shape/type terms can never be exercised for a
  // collection named in --reset.
  survivors: Doc[] = [];

  async deleteMany(filter: Record<string, unknown> = {}): Promise<{ deletedCount: number }> {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matchesFilter(d, filter));
    const deletedCount = before - this.docs.length;
    if (this.survivors.length > 0) {
      this.docs.push(...this.survivors);
      this.survivors = [];
    }
    return { deletedCount };
  }

  async bulkWrite(
    ops: { updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } } }[],
  ): Promise<{ modifiedCount: number }> {
    let modifiedCount = 0;
    for (const op of ops) {
      const target = this.docs.find((d) => String(d._id) === String(op.updateOne.filter._id));
      if (!target) continue;
      let changed = false;
      for (const [key, value] of Object.entries(op.updateOne.update.$set)) {
        if (target[key] !== value) changed = true;
        target[key] = value;
      }
      if (changed) modifiedCount += 1;
    }
    return { modifiedCount };
  }

  async indexes(): Promise<{ name: string }[]> {
    return [...this.indexNames].map((name) => ({ name }));
  }

  async dropIndex(name: string): Promise<void> {
    if (!this.indexNames.has(name)) {
      const err = new Error(`index not found with name [${name}]`) as IndexNotFoundError;
      err.code = 27;
      throw err;
    }
    this.indexNames.delete(name);
  }

  async distinct(field: string): Promise<unknown[]> {
    const values = new Set<unknown>();
    for (const d of this.docs) {
      if (Object.hasOwn(d, field)) values.add(d[field]);
    }
    return [...values];
  }
}

// `$type: "objectId"`, `$exists` and `$ne` are the only Mongo operators the
// apply modules' filters use — a tiny matcher covers exactly that surface,
// nothing more (this is not a general Mongo query engine).
function matchesFilter(doc: Doc, filter: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    const value = doc[key];
    if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
      const condObj = cond as { $type?: string; $exists?: boolean; $ne?: unknown };
      if (condObj.$type === "objectId" && !(value instanceof ObjectId)) return false;
      if (condObj.$exists === true && !Object.hasOwn(doc, key)) return false;
      if (condObj.$exists === false && Object.hasOwn(doc, key)) return false;
      if (Object.hasOwn(condObj, "$ne") && value === condObj.$ne) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

class FakeDb {
  collections = new Map<string, FakeCollection>();

  seed(name: string, docs: Doc[], indexNames?: string[]): FakeCollection {
    const col = new FakeCollection(docs, indexNames);
    this.collections.set(name, col);
    return col;
  }

  collection(name: string): FakeCollection {
    let col = this.collections.get(name);
    if (!col) {
      col = new FakeCollection();
      this.collections.set(name, col);
    }
    return col;
  }

  // Queues an orders document that re-appears after the reset's deleteMany —
  // a straggler write inside the closed-shop window.
  seedSurvivingOrder(doc: Doc): void {
    this.collection("orders").survivors.push(doc);
  }
}

function fakeDb(): FakeDb {
  return new FakeDb();
}

// mongodb's `Db` type is much wider than FakeDb; the apply-*.ts modules only
// ever call `.collection(name)` on it, so a narrow cast at the call boundary
// is the intended shape of this fake port (never `any`).
function asDb(db: FakeDb) {
  return db as unknown as import("mongodb").Db;
}

function oid(): ObjectId {
  return new ObjectId();
}

// ── applyProductCategories ──────────────────────────────────────────────

test("applyProductCategories: an exact category-name match resolves and writes categoryId", async () => {
  const db = fakeDb();
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  const productId = oid();
  db.seed("products", [{ _id: productId, category: "Coffee" }]);

  const result = await applyProductCategories(asDb(db), { createMissing: false, batchSize: APPLY_BATCH_SIZE });

  assert.equal(result.matched, 1, "the exact-name match must count as matched");
  assert.equal(result.modified, 1, "the product must have been written");
  const product = db.collection("products").docs[0];
  assert.equal(String(product.categoryId), String(catId), "the product's categoryId must be the matched category's _id");
});

test("applyProductCategories: a case/space mismatch resolves ONLY when the normalized group has exactly one doc", async () => {
  const db = fakeDb();
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  const productId = oid();
  db.seed("products", [{ _id: productId, category: "  coffee " }]);

  const result = await applyProductCategories(asDb(db), { createMissing: false, batchSize: APPLY_BATCH_SIZE });

  assert.equal(result.matched, 1, "a single-member normalized group must resolve the mismatch");
  const product = db.collection("products").docs[0];
  assert.equal(String(product.categoryId), String(catId));
});

test("applyProductCategories: a normalized-name collision is listed in skippedCollision and the product is NOT written", async () => {
  const db = fakeDb();
  db.seed("categories", [
    { _id: oid(), name: "Coffee", order: 1 },
    { _id: oid(), name: "COFFEE", order: 2 },
  ]);
  const productId = oid();
  db.seed("products", [{ _id: productId, category: "coffee" }]);

  const result = await applyProductCategories(asDb(db), { createMissing: false, batchSize: APPLY_BATCH_SIZE });

  assert.equal(result.skippedCollision.length, 1, "the ambiguous normalized group must be reported as a collision");
  assert.deepEqual([...result.skippedCollision[0]].sort(), ["COFFEE", "Coffee"], "the collision must list both colliding spellings");
  const product = db.collection("products").docs[0];
  assert.equal(Object.hasOwn(product, "categoryId"), false, "a collided product must NOT be written");
  assert.equal(result.modified, 0, "no write must have happened for the collided product");
});

test("applyProductCategories: a category name with no matching doc is skippedNoDoc without createMissing, and created+written with it", async () => {
  const dbNoCreate = fakeDb();
  const productId1 = oid();
  dbNoCreate.seed("products", [{ _id: productId1, category: "Bakery" }]);

  const withoutCreate = await applyProductCategories(asDb(dbNoCreate), { createMissing: false, batchSize: APPLY_BATCH_SIZE });
  assert.deepEqual(withoutCreate.skippedNoDoc, ["Bakery"], "with no Category doc and createMissing:false, the name must be skippedNoDoc");
  assert.equal(withoutCreate.created.length, 0, "nothing must be created without the flag");
  const productAfterSkip = dbNoCreate.collection("products").docs[0];
  assert.equal(Object.hasOwn(productAfterSkip, "categoryId"), false, "a skipped-no-doc product must not be written");

  const dbCreate = fakeDb();
  const productId2 = oid();
  dbCreate.seed("products", [{ _id: productId2, category: "Bakery" }]);

  const withCreate = await applyProductCategories(asDb(dbCreate), { createMissing: true, batchSize: APPLY_BATCH_SIZE });
  assert.deepEqual(withCreate.created, ["Bakery"], "with createMissing:true, the missing name must be created");
  assert.deepEqual(withCreate.skippedNoDoc, [], "a name that got created must not also appear in skippedNoDoc");
  const productAfterCreate = dbCreate.collection("products").docs[0];
  assert.ok(productAfterCreate.categoryId instanceof ObjectId, "the product must be written with the newly created category's id");
  const newCategoryDoc = dbCreate.collection("categories").docs.find((c) => c.name === "Bakery");
  assert.ok(newCategoryDoc, "a new Category doc must actually have been inserted");
  assert.equal(String(productAfterCreate.categoryId), String(newCategoryDoc?._id), "the product's categoryId must point at the newly created category");
});

test("applyProductCategories: a product already holding an ObjectId categoryId is counted alreadyObjectId and left untouched", async () => {
  const db = fakeDb();
  const existingCategoryId = oid();
  db.seed("categories", [{ _id: oid(), name: "Coffee", order: 1 }]);
  const productId = oid();
  db.seed("products", [{ _id: productId, categoryId: existingCategoryId }]);

  const result = await applyProductCategories(asDb(db), { createMissing: false, batchSize: APPLY_BATCH_SIZE });

  assert.equal(result.alreadyObjectId, 1, "a product with an ObjectId categoryId must be counted alreadyObjectId");
  assert.equal(result.matched, 0, "an already-migrated product must not also be counted matched");
  assert.equal(result.modified, 0, "an already-migrated product must not be re-written");
  const product = db.collection("products").docs[0];
  assert.equal(String(product.categoryId), String(existingCategoryId), "the existing categoryId must be untouched");
});

test("applyProductCategories: writes are batched at APPLY_BATCH_SIZE — 1001 products yields exactly 3 bulkWrite calls", async () => {
  const db = fakeDb();
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  const TOTAL_PRODUCTS = 1001;
  const products: Doc[] = [];
  for (let i = 0; i < TOTAL_PRODUCTS; i += 1) {
    products.push({ _id: oid(), category: "Coffee" });
  }
  db.seed("products", products);

  const productsCollection = db.collection("products");
  let bulkWriteCalls = 0;
  const originalBulkWrite = productsCollection.bulkWrite.bind(productsCollection);
  productsCollection.bulkWrite = async (ops) => {
    bulkWriteCalls += 1;
    return originalBulkWrite(ops);
  };

  const result = await applyProductCategories(asDb(db), { createMissing: false, batchSize: APPLY_BATCH_SIZE });

  assert.equal(APPLY_BATCH_SIZE, 500, "sanity: APPLY_BATCH_SIZE must be 500 for this test's math (1001 -> 3 batches) to hold");
  assert.equal(bulkWriteCalls, 3, `1001 products at batch size ${APPLY_BATCH_SIZE} must yield 3 bulkWrite calls (500 + 500 + 1), got ${bulkWriteCalls}`);
  assert.equal(result.matched, TOTAL_PRODUCTS);
  assert.equal(result.modified, TOTAL_PRODUCTS);
});

// ── dropLegacyCategory ───────────────────────────────────────────────────

test("dropLegacyCategory: refuses (writes nothing) when any product lacks an ObjectId categoryId", async () => {
  const db = fakeDb();
  db.seed("products", [
    { _id: oid(), categoryId: oid(), category: "Coffee" },
    { _id: oid(), category: "Bakery" }, // no categoryId at all
  ]);

  const result = await dropLegacyCategory(asDb(db));

  assert.equal(result.refused, true, "dropLegacyCategory must refuse when not every product has an ObjectId categoryId");
  assert.equal(result.unset, 0, "a refusal must not unset anything");
  assert.equal(result.indexDropped, false, "a refusal must not drop the index");
  const products = db.collection("products").docs;
  assert.ok(products.some((p) => Object.hasOwn(p, "category")), "the legacy category field must survive a refused drop");
});

test("dropLegacyCategory: unsets category and drops category_1 once every product has an ObjectId categoryId that resolves to a live category", async () => {
  const db = fakeDb();
  const coffeeId = oid();
  const bakeryId = oid();
  db.seed("categories", [
    { _id: coffeeId, name: "Coffee", order: 1 },
    { _id: bakeryId, name: "Bakery", order: 2 },
  ]);
  db.seed(
    "products",
    [
      { _id: oid(), categoryId: coffeeId, category: "Coffee" },
      { _id: oid(), categoryId: bakeryId, category: "Bakery" },
    ],
    ["_id_", "category_1"],
  );

  const result = await dropLegacyCategory(asDb(db));

  assert.equal(result.refused, false, "the drop must proceed once every product has an ObjectId categoryId that resolves");
  assert.equal(result.unset, 2, "both products' legacy category field must be unset");
  assert.equal(result.indexDropped, true, "the category_1 index must be reported as dropped");
  const products = db.collection("products").docs;
  assert.ok(products.every((p) => !Object.hasOwn(p, "category")), "no product may still carry the legacy category field");
  assert.equal(db.collection("products").indexNames.has("category_1"), false, "the category_1 index must actually be gone from the fake collection");
});

test("dropLegacyCategory: swallows IndexNotFound (the index was already gone) without throwing", async () => {
  const db = fakeDb();
  const categoryId = oid();
  db.seed("categories", [{ _id: categoryId, name: "Coffee", order: 1 }]);
  db.seed("products", [{ _id: oid(), categoryId }], ["_id_"]); // no category_1 index seeded

  const result = await dropLegacyCategory(asDb(db));

  assert.equal(result.refused, false);
  assert.equal(result.indexDropped, false, "a missing index must be reported as not-dropped, not thrown");
});

// ── applyReset ───────────────────────────────────────────────────────────

test("applyReset: deleteMany({}) empties every listed collection and never calls drop", async () => {
  const db = fakeDb();
  db.seed("orders", [{ _id: oid() }, { _id: oid() }]);
  db.seed("printjobs", [{ _id: oid() }]);
  let dropCalled = false;
  // A collection object with a `drop` method that flips a flag if ever
  // called — applyReset must never call it (deleteMany keeps indexes).
  const ordersCollection = db.collection("orders") as unknown as { drop?: () => Promise<void> };
  ordersCollection.drop = async () => {
    dropCalled = true;
  };

  const result = await applyReset(asDb(db), ["orders", "printjobs"]);

  assert.deepEqual(result.deleted, { orders: 2, printjobs: 1 }, "deleted counts must be reported per collection");
  assert.equal(db.collection("orders").docs.length, 0, "orders must be empty after reset");
  assert.equal(db.collection("printjobs").docs.length, 0, "printjobs must be empty after reset");
  assert.equal(dropCalled, false, "applyReset must never call drop() — indexes must survive a reset");
});

test("applyReset: releases every table ONLY when 'orders' is in the reset list, and NEVER touches a Reserved table (C5)", async () => {
  const dbWithOrders = fakeDb();
  dbWithOrders.seed("orders", [{ _id: oid() }]);
  const occupiedId = oid();
  const availableId = oid();
  const reservedId = oid();
  const stuckId = oid();
  const noPointerId = oid();
  dbWithOrders.seed("tables", [
    { _id: occupiedId, currentOrderId: "ORD-1", status: "Occupied" },
    { _id: availableId, status: "Available" },
    // C5: an operator-marked Reserved table, with no currentOrderId — the
    // exact shape the erasure bug hit (an empty-filter updateMany would
    // flip this to Available even though no order was ever attached).
    { _id: reservedId, status: "Reserved" },
    // A table stuck Occupied whose pointer was already cleared to "" (the
    // freed shape lib/table-admin.ts's FREE_TABLE_FILTER matches). It MUST be
    // released. NOTE: probe-verified against real MongoDB, `$exists: true`
    // DOES match an empty-string field, so this row alone does NOT separate
    // the shipped filter from the rejected `{currentOrderId:{$exists:true}}`
    // one — the row below is what does.
    { _id: stuckId, currentOrderId: "", status: "Occupied" },
    // THE DISCRIMINATING FIXTURE: Occupied with NO currentOrderId key at all.
    // `$ne: "Reserved"` releases it; `$exists: true` does NOT (probe-verified
    // on the scratch mongod: $exists:true returned only the two rows that
    // carry the key). Without this row the test cannot tell the shipped filter
    // from the rejected one, and a regression would strand this table
    // Occupied on the floor plan forever after DL-3.
    { _id: noPointerId, status: "Occupied" },
  ]);

  const withOrders = await applyReset(asDb(dbWithOrders), ["orders"]);
  assert.equal(withOrders.tablesReleased, 3, "ALL THREE Occupied tables must be released — the one holding an order id, the stuck one with an empty pointer, and the one with no pointer key at all — but NOT the Reserved one");
  assert.equal(withOrders.reservedKept, 1, "the Reserved table must be counted and returned as reservedKept");

  const tables = dbWithOrders.collection("tables").docs;
  const occupiedTable = tables.find((t) => String(t._id) === String(occupiedId));
  const reservedTable = tables.find((t) => String(t._id) === String(reservedId));
  assert.equal(reservedTable?.status, "Reserved", "the Reserved table's status must survive the reset untouched");
  assert.equal(Object.hasOwn(reservedTable as Doc, "currentOrderId"), false, "the Reserved table never had currentOrderId and must still not have it");
  assert.equal(occupiedTable?.status, TABLE_AVAILABLE_STATUS, "the Occupied table must end up Available");
  assert.equal(Object.hasOwn(occupiedTable as Doc, "currentOrderId"), false, "the Occupied table's currentOrderId must be unset");
  const stuckTable = tables.find((t) => String(t._id) === String(stuckId));
  assert.equal(
    stuckTable?.status,
    TABLE_AVAILABLE_STATUS,
    "a table stuck Occupied with an already-cleared currentOrderId MUST be released — an $exists-based filter would skip it and strand the floor plan",
  );
  assert.equal(Object.hasOwn(stuckTable as Doc, "currentOrderId"), false, "the stuck table's empty currentOrderId must be unset too");

  const dbWithoutOrders = fakeDb();
  dbWithoutOrders.seed("printjobs", [{ _id: oid() }]);
  dbWithoutOrders.seed("tables", [{ _id: oid(), currentOrderId: "ORD-1", status: "Occupied" }]);

  const withoutOrders = await applyReset(asDb(dbWithoutOrders), ["printjobs"]);
  assert.equal(withoutOrders.tablesReleased, 0, "tables must not be touched when orders is not in the reset list");
  assert.equal(withoutOrders.reservedKept, 0, "reservedKept must be 0 when orders is not reset (the count is only taken during a release)");
  const untouchedTable = dbWithoutOrders.collection("tables").docs[0];
  assert.equal(untouchedTable.status, "Occupied", "a table must stay untouched when orders is not reset");
});

// ── runApply ───────────────────────────────────────────────────────────

const BASE_ARGS: MigrateArgs = {
  uri: "mongodb://127.0.0.1:27017/pos_scratch_apply",
  dbName: "pos_scratch_apply",
  apply: true,
  backup: "/backups/dump.gz",
  confirm: "pos_scratch_apply",
  out: "/work/report.json",
  reset: null,
  createMissingCategories: false,
  dropLegacyCategory: false,
};

function seedEmptyParentCollections(db: FakeDb): void {
  // buildParentSets/censusOrders/censusRefs read these collections
  // unconditionally — an unseeded name still resolves to an empty
  // FakeCollection via db.collection(), so this is just documentation of
  // what runCensus touches, not a strict requirement of the fake.
  for (const name of [
    "customers",
    "products",
    "tables",
    "staff",
    "orderrequests",
    "orders",
    "categories",
    "duepayments",
    "promoredemptions",
    "printjobs",
  ]) {
    db.collection(name);
  }
}

test("runApply: clean is true when nothing is skipped and no reset/drop was requested", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  db.seed("products", [{ _id: oid(), category: "Coffee" }]);

  const result = await runApply(asDb(db), BASE_ARGS);

  assert.equal(result.clean, true, "with the single product fully resolved and no reset/drop requested, clean must be true");
  assert.equal(result.resetList, null, "resetList must mirror args.reset (null here)");
});

test("runApply: clean is false when a category name is skipped (no doc, createMissing false)", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  db.seed("products", [{ _id: oid(), category: "Bakery" }]); // no matching category doc, createMissing:false

  const result = await runApply(asDb(db), BASE_ARGS);

  assert.equal(result.clean, false, "a skippedNoDoc category name must make the apply result NOT clean");
  assert.deepEqual(result.steps.categories.skippedNoDoc, ["Bakery"]);
});

test("runApply: clean is false when a requested reset collection is still non-empty after reset", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const ordersCollection = db.collection("orders");
  ordersCollection.docs.push({ _id: oid() });
  // Force deleteMany to be a no-op for this one collection to simulate a
  // reset that did not actually empty it (drives runApply's post-reset
  // recount, which is what must catch this).
  ordersCollection.deleteMany = async () => ({ deletedCount: 0 });

  const args: MigrateArgs = { ...BASE_ARGS, reset: ["orders"] };
  const result = await runApply(asDb(db), args);

  assert.equal(result.clean, false, "a reset collection that is still non-empty after --reset must make the result NOT clean");
  assert.deepEqual(result.resetList, ["orders"]);
});

test("runApply: clean is false when --drop-legacy-category was requested but refused", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  db.seed("products", [
    { _id: oid(), categoryId: oid() },
    { _id: oid() }, // no categoryId at all -> dropLegacyCategory refuses
  ]);

  const args: MigrateArgs = { ...BASE_ARGS, dropLegacyCategory: true };
  const result = await runApply(asDb(db), args);

  assert.equal(result.clean, false, "a refused drop-legacy-category must make the apply result NOT clean");
  assert.equal(result.steps.dropLegacy?.refused, true);
});

test("runApply: clean is true end-to-end with reset AND drop-legacy-category both requested and both succeeding", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  db.seed("products", [{ _id: oid(), category: "Coffee" }], undefined);
  db.collection("products").indexNames.add("category_1");
  db.seed("orders", [{ _id: oid() }]);

  const args: MigrateArgs = { ...BASE_ARGS, reset: ["orders"], dropLegacyCategory: true };
  const result = await runApply(asDb(db), args);

  assert.equal(result.clean, true, "a fully-resolved apply with a successful reset and a successful drop must be clean");
  assert.equal(result.steps.dropLegacy?.refused, false);
  assert.equal(db.collection("orders").docs.length, 0, "orders must be reset");
  assert.equal(db.collection("products").indexNames.has("category_1"), false, "category_1 must have been dropped");
});

// ── C1: reset must refuse when the category back-fill is incomplete ────

test("runApply: C1 — a reset is REFUSED (not just marked unclean) when the category back-fill left an unresolved name, and the reset collection's document SURVIVES", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  // A product whose category name has NO Category doc at all.
  db.seed("products", [{ _id: oid(), category: "Bakery" }]);
  // An orders doc that would be destroyed if the reset ran anyway.
  db.seed("orders", [{ _id: oid() }]);

  const args: MigrateArgs = { ...BASE_ARGS, reset: ["orders"], createMissingCategories: false };
  const result = await runApply(asDb(db), args);

  assert.equal(result.steps.reset, null, "the reset step must not have run at all");
  assert.equal(result.clean, false, "a refused reset must never report clean");
  assert.equal(result.resetRefused, true, "the refusal must be reported distinctly (resetRefused)");
  // The load-bearing assertion: the orders collection must STILL hold its
  // document — this is what proves the reset never touched the database,
  // not merely that the verdict says "not clean".
  assert.equal(db.collection("orders").docs.length, 1, "orders must still hold its document — the reset must never have run");
});

// ── C2: a collection left OUT of --reset must not certify clean while ──
// ── it still holds String-shaped link fields ────────────────────────────

test("runApply: C2 — a fully-resolved back-fill with a reset list that OMITS orders is NOT clean when orders.customerId is still String-shaped", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  db.seed("products", [{ _id: oid(), category: "Coffee" }]);
  // orders is NOT in the reset list, and still carries a hex-string
  // customerId (pre-migration shape) rather than an ObjectId.
  db.seed("customers", [{ _id: oid() }]);
  const custId = db.collection("customers").docs[0]._id;
  db.seed("orders", [{ _id: oid(), customerId: String(custId) }]);
  // A collection actually in the reset list, so its own leftover shape must
  // not be what trips this — printjobs holds no link fields to begin with.
  db.seed("printjobs", []);

  const args: MigrateArgs = { ...BASE_ARGS, reset: ["printjobs"] };
  const result = await runApply(asDb(db), args);

  assert.equal(result.clean, false, "orders being left out of --reset while still String-shaped must make the result NOT clean");
  assert.ok(
    result.stringShapedCollections.includes("orders"),
    `stringShapedCollections must name "orders", got: ${JSON.stringify(result.stringShapedCollections)}`,
  );
});

test("runApply: C2 (mirrored positive) — the same scenario with every link already ObjectId-shaped stays clean:true", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  db.seed("products", [{ _id: oid(), category: "Coffee" }]);
  db.seed("customers", [{ _id: oid() }]);
  const custId = db.collection("customers").docs[0]._id;
  // orders is STILL not in the reset list, but customerId is already an
  // ObjectId — this proves the new linkShapeClean term is not vacuously
  // false just because a collection was omitted from --reset.
  db.seed("orders", [{ _id: oid(), customerId: custId }]);
  db.seed("printjobs", []);

  const args: MigrateArgs = { ...BASE_ARGS, reset: ["printjobs"] };
  const result = await runApply(asDb(db), args);

  assert.equal(result.clean, true, "an omitted-from-reset collection whose links are already ObjectId-shaped must still be clean");
  assert.deepEqual(result.stringShapedCollections, [], "no collection should be flagged String-shaped");
});

// ── C34: orders.sourceRequestIds carries no RefShapeBuckets, so only the ──
// ── notObjectId TYPE count can reveal a String-typed array. A String entry ─
// ── is invisible to the Order model's cast query, so the double-accept ────
// ── fence reports an already-claimed request as unclaimed (live-probed:  ──
// ── findOne misses it, {$ne} returns it, and the sparse-unique index  ────
// ── raises no E11000) — the same request can be accepted twice. ───────────

test("runApply: C34 — orders left OUT of --reset with a String-typed sourceRequestIds entry is NOT clean", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  db.seed("products", [{ _id: oid(), category: "Coffee" }]);
  const reqId = oid();
  db.seed("orderrequests", [{ _id: reqId }]);
  // The id RESOLVES (canonicalHex membership finds it, so orphans stays 0) —
  // only the BSON type is wrong. That is exactly the case the census was
  // blind to before C34, and it must not certify clean.
  db.seed("orders", [{ _id: oid(), sourceRequestIds: [String(reqId)] }]);
  db.seed("printjobs", []);

  const args: MigrateArgs = { ...BASE_ARGS, reset: ["printjobs"] };
  const result = await runApply(asDb(db), args);

  assert.equal(
    result.postCensus.orders.sourceRequestIds.orphans,
    0,
    "precondition: the id resolves, so orphans cannot be what trips this — only the TYPE signal can",
  );
  assert.equal(
    result.postCensus.orders.sourceRequestIds.notObjectId,
    1,
    "the String-typed entry must be counted by the notObjectId TYPE bucket",
  );
  assert.equal(result.clean, false, "a String-typed sourceRequestIds in an un-reset orders collection must make the result NOT clean");
  assert.ok(
    result.stringShapedCollections.includes("orders"),
    `stringShapedCollections must name "orders", got: ${JSON.stringify(result.stringShapedCollections)}`,
  );
});

test("runApply: C34 (mirrored positive) — an ObjectId-typed sourceRequestIds entry stays clean:true", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  db.seed("products", [{ _id: oid(), category: "Coffee" }]);
  const reqId = oid();
  db.seed("orderrequests", [{ _id: reqId }]);
  // Same shape, correct BSON type — proves the new term is not vacuously
  // true just because orders was omitted from --reset.
  db.seed("orders", [{ _id: oid(), sourceRequestIds: [reqId] }]);
  db.seed("printjobs", []);

  const args: MigrateArgs = { ...BASE_ARGS, reset: ["printjobs"] };
  const result = await runApply(asDb(db), args);

  assert.equal(result.postCensus.orders.sourceRequestIds.notObjectId, 0, "an ObjectId entry must not be counted as notObjectId");
  assert.equal(result.clean, true, "an ObjectId-typed sourceRequestIds must still be clean");
  assert.deepEqual(result.stringShapedCollections, [], "no collection should be flagged String-shaped");
});

// ── The DL-3 command shape itself: --reset default ──────────────────────
// Every runApply test above passes reset:null, ["orders"] or ["printjobs"],
// so none of them exercised the flag combination the owner actually runs.
// That blind spot hid a real defect: the String-shape/type terms used to be
// gated on "is this collection absent from --reset", and `default` names every
// collection those checks cover — so the whole gate was switched OFF for the
// live command while every test still passed.

test("runApply: C2/C34 — with --reset default, a document surviving the reset with a String-shaped ref is still caught (the gate must not be disabled by the reset list itself)", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  db.seed("products", [{ _id: oid(), category: "Coffee" }]);
  const custId = oid();
  db.seed("customers", [{ _id: custId }]);
  // A write that lands DURING the closed-shop window: the reset emptied
  // orders, then a straggler arrived carrying the pre-migration String shape.
  // The fake port's deleteMany runs first, so seeding after runApply is not
  // possible here — instead this doc models the survivor by being re-added by
  // the port's reset hook. See seedSurvivingOrder below.
  db.seedSurvivingOrder({ _id: oid(), customerId: String(custId), sourceRequestIds: [String(oid())] });

  const args: MigrateArgs = { ...BASE_ARGS, reset: [...RESET_DEFAULT_COLLECTIONS] };
  const result = await runApply(asDb(db), args);

  assert.equal(result.clean, false, "a String-shaped survivor must make the run NOT clean even though its collection was in --reset default");
  assert.ok(
    result.stringShapedCollections.includes("orders"),
    `the offending collection must be named so the exit-3 reason can point at it, got: ${JSON.stringify(result.stringShapedCollections)}`,
  );
});

test("runApply: --reset default on a fully-migrated database is clean (the un-gated shape terms must not fire on empty collections)", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const catId = oid();
  db.seed("categories", [{ _id: catId, name: "Coffee", order: 1 }]);
  db.seed("products", [{ _id: oid(), category: "Coffee" }]);

  const args: MigrateArgs = { ...BASE_ARGS, reset: [...RESET_DEFAULT_COLLECTIONS] };
  const result = await runApply(asDb(db), args);

  assert.equal(result.clean, true, "an emptied collection yields all-zero buckets, so the un-gated shape terms must stay silent");
  assert.deepEqual(result.stringShapedCollections, [], "no collection may be flagged when every reset collection is empty");
});

// ── C6: --create-missing-categories dedupes by normalized name ─────────

test("applyProductCategories: C6 — two unmatched names differing only by case collapse into ONE created Category, and an untrimmed name is stored trimmed", async () => {
  const db = fakeDb();
  const productId1 = oid();
  const productId2 = oid();
  db.seed("products", [
    { _id: productId1, category: "Bakery" },
    { _id: productId2, category: " bakery  " }, // same normalized name, untrimmed + different case
  ]);

  const result = await applyProductCategories(asDb(db), { createMissing: true, batchSize: APPLY_BATCH_SIZE });

  assert.equal(result.created.length, 1, "two case/space-differing spellings of the same name must create exactly ONE Category doc");
  const categoryDocs = db.collection("categories").docs;
  assert.equal(categoryDocs.length, 1, "exactly one Category doc must actually exist in the fake collection");
  assert.equal(categoryDocs[0].name, "Bakery", "the stored name must be trimmed (first raw spelling seen, collapsed whitespace)");

  const product1 = db.collection("products").docs.find((d) => String(d._id) === String(productId1));
  const product2 = db.collection("products").docs.find((d) => String(d._id) === String(productId2));
  assert.ok(product1?.categoryId, "the first product must have been linked");
  assert.ok(product2?.categoryId, "the second product must have been linked");
  assert.equal(
    String(product1?.categoryId),
    String(product2?.categoryId),
    "BOTH products must link to the SAME single created category, not two separate ones",
  );
});

// ── C7: an orphaned/non-ObjectId categoryId must not certify clean, and ──
// ── dropLegacyCategory must refuse rather than destroy the legacy name ──

test("runApply: C7a — a product's categoryId pointing at a DELETED category is NOT clean, categoryIdOrphan.count===1, and dropLegacyCategory REFUSES (the legacy name survives)", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const staleCategoryId = oid(); // no matching doc in "categories" — deleted category
  const productId = oid();
  db.seed("products", [{ _id: productId, categoryId: staleCategoryId, category: "Ghost Category" }]);

  const args: MigrateArgs = { ...BASE_ARGS, dropLegacyCategory: true };
  const result = await runApply(asDb(db), args);

  assert.equal(result.clean, false, "an orphaned categoryId must make the result NOT clean");
  assert.equal(result.postCensus.products.categoryIdOrphan.count, 1, "the orphan must be counted by the post-census");
  // The load-bearing assertion: the drop must have REFUSED, so the legacy
  // name is still on the product — this is what pins the drop-gate hardening,
  // not just the clean verdict.
  assert.equal(result.steps.dropLegacy?.refused, true, "dropLegacyCategory must refuse when a categoryId does not resolve to a live category");
  const product = db.collection("products").docs.find((d) => String(d._id) === String(productId));
  assert.equal(product?.category, "Ghost Category", "the legacy category name must have SURVIVED the refused drop");
});

test("runApply: C7b — a product whose categoryId is a hex STRING (not an ObjectId instance) with no legacy category key counts categoryIdNotObjectId and is NOT clean", async () => {
  const db = fakeDb();
  seedEmptyParentCollections(db);
  const hexString = new ObjectId().toHexString();
  db.seed("products", [{ _id: oid(), categoryId: hexString }]); // no "category" key at all

  const result = await runApply(asDb(db), BASE_ARGS);

  assert.equal(result.postCensus.products.categoryIdNotObjectId.count, 1, "a hex-string categoryId must be counted categoryIdNotObjectId, not silently treated as resolved");
  assert.equal(result.clean, false, "a categoryIdNotObjectId product must make the result NOT clean");
});

// ── source pin: RAW DRIVER ONLY, never Mongoose ─────────────────────────

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const SCRIPT_DIR = "apps/cafe/scripts/migrate-links";
const APPLY_FILES = ["apply-categories.ts", "apply-reset.ts", "apply-run.ts"];

test("PIN: none of the apply-*.ts modules import a Mongoose model or 'mongoose' at all (RAW source, negative — paired with the positive landmark 'from \"mongodb\"')", () => {
  const bannedMongoose = '"' + "mongoose" + '"';
  const bannedMongooseSingle = "'" + "mongoose" + "'";

  for (const file of APPLY_FILES) {
    const rel = `${SCRIPT_DIR}/${file}`;
    const src = readSrc(rel);
    assert.ok(src.length > 100, `positive landmark: ${rel} must have been read (got ${src.length} bytes)`);
    assert.ok(src.includes('from "mongodb"'), `positive landmark: ${rel} must import type Db from "mongodb"`);
    assert.equal(src.includes(bannedMongoose), false, `${rel} must not reference the "mongoose" module string anywhere`);
    assert.equal(src.includes(bannedMongooseSingle), false, `${rel} must not reference the 'mongoose' module string (single-quoted) anywhere`);
  }
});
