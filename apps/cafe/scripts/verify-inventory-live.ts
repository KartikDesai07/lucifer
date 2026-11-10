/**
 * Inventory lite Slice 1 live leg - stock moves on settle / Pay Now and comes back on cancel / admin DELETE, through the
 * REAL route handlers (kit: reward-card-use-live-kit.ts `loadApi` + auth stub) against a real mongod. Cases (a)-(o) of
 * docs/superpowers/plans/2026-11-10-inventory-lite.md "Slice 1" Live cases.
 *
 *   npm run verify:inventory:live          (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_inventory npm run verify:inventory:live
 *
 * Stock items are seeded through the StockItem model; `Product.stockUse` by a raw `$set` (the link route is Slice 3),
 * then `cache.del("products")` as that route will. Quantities are integer milli-units of the stock item's own unit.
 * `stockUsed` and stock qty are read RAW (collection.findOne), never lean-with-defaults.
 *
 * SAFETY: refuses any database whose name lacks the scratch prefix, and drops ONLY this script's own database (at the
 * start and in `finally`; never a list-and-drop by prefix). (console output is intentional - ops CLI script.)
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import cache from "@/lib/cache";
import { Product } from "@/models/Product";
import { StockItem } from "@/models/StockItem";
import { orderLineKey } from "@pos/shared/utils";
import { installStubs, loadApi, rawOrder, type Api, type Rec, type Scenario } from "./reward-card-use-live-kit";
import {
  CHAI_MILK, CHAI_MILK_LARGE, CHAI_SUGAR, CHIPS_START, INT32_EDGE, MILK_START, MILLI, PRICE, REASON, SUGAR_START, assertMoved, assertNoStockUsed, call, chaiL, chaiR, chaiRecipe, chipsLn, createBody, expectUsed, holdSettleCas, ln, ok, openTab, qtyBsonType, seed, setQty, setRecipe, settleBody, settled, stock, usedOf, type Handler, type Stock, type World,
} from "./verify-inventory-live-kit";

const SCRATCH_PREFIX = "pos_scratch_";
const DUPLICATE_KEY = 11000; // MongoDB E11000
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}inventory`;

const tally = { passed: 0, failed: 0 };
const scenario: Scenario = async (id, name, fn) => {
  const error = await fn().then(() => null, (e: unknown) => e ?? new Error("rejected"));
  tally[error ? "failed" : "passed"] += 1;
  console.log(`  ${error ? "FAIL" : "PASS"} ${id}. ${name}`);
  if (error) console.log(`       ${error instanceof Error ? error.message : String(error)}`);
};

async function runCases(api: Api, w: World): Promise<void> {
  const one = await import("@/app/api/orders/[id]/route");
  const products = await import("@/app/api/products/route");
  const del = (id: string) => call(one.DELETE as Handler, "DELETE", `/api/orders/${id}`, id);
  const deducted = (before: Stock, delta: Partial<Stock>, what: string) => stock(w).then((now) => assertMoved(before, now, delta, what));

  await scenario("a", "seed: Milk 10 L, Sugar, Chips; Chai = 150 ml milk + 10 g sugar, Large = 250 ml milk", async () => {
    assert.deepEqual(await stock(w), { milk: MILK_START, sugar: SUGAR_START, chips: CHIPS_START });
    const chai = (await Product.collection.findOne({ _id: new mongoose.Types.ObjectId(w.chai) })) as Rec;
    assert.equal((chai.stockUse as Rec[]).length, 2, "landmark: Chai carries its two stock lines");
  });
  await scenario("b", "open tab + round + void: no stock change, no stockUsed", async () => {
    const before = await stock(w);
    const id = String((await openTab(api, [chaiR(w, 2)]))._id);
    ok(await api.addRound(id, { items: [chipsLn(w, 1)], discount: 0, discountKind: null, expectedTableNo: null, extraCharges: [], idemKey: randomUUID() }), 200, "round");
    const first = ((await rawOrder(id)).items as Rec[])[0];
    const stored = { ...first, productId: String(first.productId) } as Parameters<typeof orderLineKey>[0];
    ok(await api.voidLine(id, { index: 0, lineKey: orderLineKey(stored), qty: 1, expectedVoids: 0, reason: REASON }), 200, "void");
    const after = await rawOrder(id);
    assert.equal((after.voids as unknown[]).length, 1, "landmark: the void landed");
    assertNoStockUsed(after, "Pending", "the open tab");
    await deducted(before, {}, "open tab");
  });
  let settledId = "";
  const C_USED = { milk: 2 * CHAI_MILK + CHAI_MILK_LARGE, sugar: 3 * CHAI_SUGAR, chips: MILLI };
  await scenario("c", "settle: exact deltas (size override, per-item sums), stockUsed in the raw doc", async () => {
    const before = await stock(w);
    settledId = String((await settled(api, [chaiR(w, 2), chaiL(w, 1), chipsLn(w, 1)]))._id);
    await deducted(before, { milk: -C_USED.milk, sugar: -C_USED.sugar, chips: -C_USED.chips }, "settle");
    const doc = await rawOrder(settledId);
    assert.equal(doc.status, "Completed", "landmark: settled");
    assert.deepEqual(usedOf(doc), expectUsed(w, C_USED));
  });
  await scenario("d", "second settle of the same bill: 409, stock unchanged", async () => {
    assert.ok(settledId, "fixture: (c) settled a bill");
    const before = await stock(w);
    ok(await api.settle(settledId, settleBody(await rawOrder(settledId))), 409, "repeat settle");
    await deducted(before, {}, "repeat settle");
  });
  await scenario("e", "two concurrent settles (the POS payload) move stock exactly once", async () => {
    const tab = await openTab(api, [chaiR(w, 1)]);
    const id = String(tab._id);
    const before = await stock(w);
    const hold = holdSettleCas(id);
    const replies = await Promise.all([api.settle(id, settleBody(tab)), api.settle(id, settleBody(tab))]).finally(hold.restore);
    assert.equal(hold.arrived(), 2, "landmark: both settles read Pending and reached the CAS");
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409], "one settle wins, the other misses the CAS");
    await deducted(before, { milk: -CHAI_MILK, sugar: -CHAI_SUGAR }, "race");
    assert.deepEqual(usedOf(await rawOrder(id)), expectUsed(w, { milk: CHAI_MILK, sugar: CHAI_SUGAR }));
  });
  await scenario("f", "cancel the settled bill restores; a second cancel is 409 and unchanged", async () => {
    assert.ok(settledId, "fixture: (c) settled a bill");
    const before = await stock(w);
    ok(await api.cancel(settledId, REASON), 200, "cancel");
    await deducted(before, C_USED, "cancel");
    const doc = await rawOrder(settledId);
    assert.equal(doc.status, "Cancelled", "landmark: cancelled");
    assert.deepEqual(usedOf(doc), expectUsed(w, C_USED), "stockUsed is kept as the record");
    ok(await api.cancel(settledId, REASON), 409, "repeat cancel");
    await deducted(before, C_USED, "repeat cancel");
  });
  await scenario("g", "Pay Now: -3 Chips in the insert; the same send key replayed moves nothing", async () => {
    const before = await stock(w);
    const body = createBody([chipsLn(w, 3)], true);
    const first = await api.create(body);
    ok(first, 201, "Pay Now");
    await deducted(before, { chips: -3 * MILLI }, "Pay Now");
    assert.deepEqual(usedOf(await rawOrder(String(first.body.data!._id))), expectUsed(w, { chips: 3 * MILLI }));
    const again = await api.create(body);
    ok(again, 200, "replay");
    assert.equal(String(again.body.data!._id), String(first.body.data!._id), "landmark: the replay adopts the same order");
    await deducted(before, { chips: -3 * MILLI }, "replay");
  });
  await scenario("h", "cancel an open tab: no stock change", async () => {
    const id = String((await openTab(api, [chaiL(w, 2)]))._id);
    const before = await stock(w);
    ok(await api.cancel(id, REASON), 200, "cancel");
    assertNoStockUsed(await rawOrder(id), "Cancelled", "the cancelled open tab");
    await deducted(before, {}, "open-tab cancel");
  });
  await scenario("i", "an unlinked product settles with no stockUsed key", async () => {
    const before = await stock(w);
    const tab = await settled(api, [ln(w.water, "Water", PRICE.water, 2)]);
    assertNoStockUsed(await rawOrder(String(tab._id)), "Completed", "the unlinked bill");
    await deducted(before, {}, "unlinked");
  });
  await scenario("j", "sell past zero: 200, qty negative, Product.available unchanged", async () => {
    await setQty(w, "chips", MILLI);
    try {
      await settled(api, [chipsLn(w, 3)]);
      assert.equal((await stock(w)).chips, -2 * MILLI, "1 pcs - 3 pcs = -2 pcs");
      const row = (await Product.collection.findOne({ _id: new mongoose.Types.ObjectId(w.chips) })) as Rec;
      assert.equal(row.available, true, "available is never written by inventory");
    } finally {
      await setQty(w, "chips", CHIPS_START);
    }
  });
  await scenario("k", "recipe edited between settle and cancel: the snapshot comes back", async () => {
    const before = await stock(w);
    const tab = await settled(api, [chaiR(w, 1)]);
    await deducted(before, { milk: -CHAI_MILK, sugar: -CHAI_SUGAR }, "landmark: the settle deducted");
    await setRecipe(w.chai, [{ itemId: w.ids.milk, qty: 999 }]);
    try {
      ok(await api.cancel(String(tab._id), REASON), 200, "cancel");
      await deducted(before, {}, "settle then cancel under an edited recipe");
    } finally {
      await setRecipe(w.chai, chaiRecipe(w));
    }
  });
  // s112 review MED: real rows are BSON int32 (every value under 2^31), so the probe starts from an int32 just under
  // the edge and lets the ADD-BACK's $inc push it past 2^31 (a wrap, an error or a kept int32 would fail here).
  await scenario("l", "an int32 stock pushed past 2^31 by an $inc reads back exactly (promoted, never wrapped)", async () => {
    const underEdge = INT32_EDGE - CHAI_MILK / 2;
    try {
      const tab = await settled(api, [chaiR(w, 1)]);
      await setQty(w, "milk", new mongoose.mongo.Int32(underEdge));
      assert.equal(await qtyBsonType(w, "milk"), "int", "landmark: the row starts as an int32, like every real row");
      ok(await api.cancel(String(tab._id), REASON), 200, "cancel");
      assert.equal((await stock(w)).milk, underEdge + CHAI_MILK, "add-back crosses 2^31 upward from an int32");
      assert.equal(await qtyBsonType(w, "milk"), "long", "the server promoted the int32 to a long");
      await settled(api, [chaiR(w, 1)]);
      assert.equal((await stock(w)).milk, underEdge, "deduct crosses 2^31 back downward");
    } finally {
      await setQty(w, "milk", MILK_START);
    }
  });
  await scenario("m", "admin DELETE of a settled bill adds back; of a cancelled bill does not", async () => {
    const before = await stock(w);
    const large = { milk: -CHAI_MILK_LARGE, sugar: -CHAI_SUGAR };
    const a = await settled(api, [chaiL(w, 1)]);
    await deducted(before, large, "landmark: the settle deducted");
    const gone = await del(String(a._id));
    ok(gone, 200, "delete settled");
    assert.equal(gone.body.data!.deleted, true, "landmark: deleted");
    await deducted(before, {}, "delete of a settled bill");
    const b = await settled(api, [chaiL(w, 1)]);
    await deducted(before, large, "landmark: the second settle deducted");
    ok(await api.cancel(String(b._id), REASON), 200, "cancel");
    await deducted(before, {}, "cancel before delete");
    ok(await del(String(b._id)), 200, "delete cancelled");
    await deducted(before, {}, "delete of a cancelled bill");
  });
  await scenario("n", "warm the products cache via GET /api/products, then settle: same result", async () => {
    cache.del("products");
    ok(await call(products.GET as Handler, "GET", "/api/products"), 200, "GET /api/products");
    const warm = cache.get<Rec[]>("products");
    assert.ok(warm?.some((p) => String(p._id) === w.chai && Array.isArray(p.stockUse)), "landmark: the cache holds Chai with its stockUse");
    const before = await stock(w);
    const tab = await settled(api, [chaiL(w, 1)]);
    await deducted(before, { milk: -CHAI_MILK_LARGE, sugar: -CHAI_SUGAR }, "warm-cache settle");
    assert.deepEqual(usedOf(await rawOrder(String(tab._id))), expectUsed(w, { milk: CHAI_MILK_LARGE, sugar: CHAI_SUGAR }));
  });
  // s112 review LOW: the one-tap "track this item's own stock" (Slice 3) leans on this index being REALLY unique.
  await scenario("o", "the ownerProductId index is built unique + partial: a second own-stock row is refused", async () => {
    const index = (await StockItem.collection.indexes()).find((i) => i.name === "ownerProductId_unique_partial");
    assert.ok(index?.unique, "the index exists in the database and is unique");
    assert.deepEqual(index.partialFilterExpression, { ownerProductId: { $exists: true } }, "partial on $exists");
    const owner = new mongoose.Types.ObjectId(w.chips);
    const first = await StockItem.create({ name: "Chips own", unit: "pcs", ownerProductId: owner });
    try {
      const dup = await StockItem.create({ name: "Chips own 2", unit: "pcs", ownerProductId: owner }).then(() => null, (e: unknown) => e);
      assert.equal((dup as { code?: number } | null)?.code, DUPLICATE_KEY, "a second row for the same product is E11000");
    } finally {
      await StockItem.deleteOne({ _id: first._id });
    }
  });
}

const settleIndexBuilds = () => Promise.allSettled(Object.values(mongoose.models).map((model) => model.init()));

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" - the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }
  process.env.MONGODB_URI = uri;
  installStubs();
  await connectDB();
  assert.equal(mongoose.connection.db?.databaseName, dbName, "connected to the guarded scratch database");
  // A clean start (only THIS database): let the connect-time index builds finish, drop, then build the indexes again.
  await settleIndexBuilds();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
  console.log(`\ninventory - live against ${dbName}\n`);
  try {
    await runCases(await loadApi(), await seed());
  } finally {
    // Wait for every model's background index build, or a build landing after the drop leaves an empty database behind.
    await settleIndexBuilds();
    await mongoose.connection.dropDatabase();
    const left = await mongoose.connection.db!.admin().listDatabases();
    console.log(`\nscratch database ${dbName} dropped: ${left.databases.every((d) => d.name !== dbName) ? "yes" : "NO"}`);
    await mongoose.disconnect();
  }
  console.log(`\n${tally.passed} passed, ${tally.failed} failed\n`);
  if (tally.failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
