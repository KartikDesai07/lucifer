/**
 * Inventory lite, Slice 3 live leg: GET/PUT /api/products/[id]/stock-use and POST .../stock-use/own through the REAL
 * route handlers against a real mongod (auth stub with a switchable role: reward-card-use-live-kit installStubs).
 * Stored values are read RAW from the collections (`products`, `stockitems`, `orders`), never through Mongoose casting.
 *
 *   npm run verify:inventory:stock-use:live
 *
 * SAFETY: refuses any database whose name is not exactly DB_NAME (a pos_scratch_* database) and drops ONLY that one
 * database (at the start and in finally). (console output is intentional: ops CLI script, not app code.)
 */
import assert from "node:assert/strict";
import path from "node:path";
import mongoose from "mongoose";

import cache from "@/lib/cache";
import { connectDB } from "@/lib/db";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { StockItem } from "@/models/StockItem";
import { STOCK_QTY_SCALE } from "@pos/shared/inventory";
import { installStubs, loadApi, rawOrder, STAFF_ID, type Api, type Rec, type Res, type Scenario } from "./reward-card-use-live-kit";
import { createBody, ln, usedOf } from "./verify-inventory-live-kit";

const SCRATCH_PREFIX = "pos_scratch_";
const DB_NAME = `${SCRATCH_PREFIX}inventory_stock_use`;
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
const GHOST = "665f0000000000000000beef"; // a valid ObjectId no row carries
const ML_150 = 150000; // 150 ml in milli-ml
const G_10 = 10000; // 10 g in milli-g
const PRICE = 40;
const OWN_START = 5 * STOCK_QTY_SCALE;

type Role = "admin" | "staff";
type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const tally = { passed: 0, failed: 0 };
const scenario: Scenario = async (id, name, fn) => {
  const error = await fn().then(() => null, (e: unknown) => e ?? new Error("rejected"));
  tally[error ? "failed" : "passed"] += 1;
  console.log(`  ${error ? "FAIL" : "PASS"} ${id}. ${name}`);
  if (error) console.log(`       ${error instanceof Error ? error.message : String(error)}`);
};

// installStubs signs in as admin; this swaps the stubbed `auth` so a leg can act as staff (same module object).
function setRole(role: Role): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = require.cache[file];
  assert.ok(stub, "the auth stub is installed");
  const admin = { id: STAFF_ID, name: "Live leg", role: "admin" };
  stub.exports.auth = async () => ({ user: role === "admin" ? admin : { ...admin, role: "staff" } });
}

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);
const rawProduct = async (id: string): Promise<Rec> => ((await Product.collection.findOne({ _id: oid(id) })) ?? {}) as Rec;
const rawItem = async (id: string): Promise<Rec> => ((await StockItem.collection.findOne({ _id: oid(id) })) ?? {}) as Rec;
const ownedBy = (productId: string) => StockItem.collection.countDocuments({ ownerProductId: oid(productId) });
const itemCount = () => StockItem.collection.countDocuments({});
const useOf = async (id: string) => {
  const row = await rawProduct(id);
  return "stockUse" in row ? (row.stockUse as Rec[]) : undefined;
};
const plain = (links: Rec[] | undefined) => links?.map((l) => ({ ...l, itemId: String(l.itemId) }));
const status = (res: Res, want: number, what: string) => assert.equal(res.status, want, `${what}: got ${res.status} ${res.body.error ?? ""}`);

interface Routes {
  use: { GET: Handler; PUT: Handler };
  own: { POST: Handler };
}
const send = (handler: Handler, method: string, url: string, id: string, body?: unknown): Promise<Res> =>
  handler(
    new Request(`http://127.0.0.1${url}`, {
      method,
      headers: { host: "127.0.0.1", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ).then(async (res) => ({ status: res.status, body: (await res.json()) as Res["body"] }));

async function runCases(api: Api, r: Routes, categoryId: unknown): Promise<void> {
  const seedItem = async (name: string, unit: string, extra: Rec = {}) => String((await StockItem.create({ name, unit, qty: 0, ...extra }))._id);
  const mk = async (name: string, extra: Rec = {}) =>
    String((await Product.create({ name, categoryId, price: PRICE, discount: 0, available: true, isActive: true, image: "", modifiers: [], ...extra }))._id);
  const sized = () => ({ variations: [{ name: "Regular", price: PRICE }, { name: "Large", price: PRICE + 10 }] });
  const get = (id: string) => send(r.use.GET, "GET", `/api/products/${id}/stock-use`, id);
  const put = (id: string, lines: unknown[]) => send(r.use.PUT, "PUT", `/api/products/${id}/stock-use`, id, { lines });
  const tap = (id: string, unit = "pcs") => send(r.own.POST, "POST", `/api/products/${id}/stock-use/own`, id, { unit });
  const milk = await seedItem("Milk", "L");
  const sugar = await seedItem("Sugar", "kg");
  const line = (itemId: string, unit: string, qtyMilli: number, sizes?: unknown[]) => ({ itemId, unit, qtyMilli, ...(sizes ? { sizes } : {}) });

  await scenario("a", "PUT 150 ml vs Milk (L) stores qty 150, raw, with no extra keys", async () => {
    const chai = await mk("Chai a");
    const res = await put(chai, [line(milk, "ml", ML_150)]);
    status(res, 200, "PUT");
    assert.deepEqual(plain(await useOf(chai)), [{ itemId: milk, qty: 150 }]);
    const stored = (await useOf(chai))![0];
    assert.equal(typeof stored.qty, "number");
    assert.deepEqual(res.body.data, { lines: [{ itemId: milk, name: "Milk", unit: "L", qtyMilli: 150 }] });
  });
  await scenario("b", "a g recipe vs an L item is 400 and the product has no stockUse key", async () => {
    const chai = await mk("Chai b");
    const res = await put(chai, [line(milk, "g", G_10)]);
    status(res, 400, "cross-group");
    assert.match(res.body.error ?? "", /Pick a unit that fits Milk \(L\)/);
    assert.equal(await useOf(chai), undefined);
  });
  await scenario("c", "set, then lines [] leaves no stockUse key at all", async () => {
    const chai = await mk("Chai c");
    status(await put(chai, [line(sugar, "g", G_10)]), 200, "set");
    assert.deepEqual(plain(await useOf(chai)), [{ itemId: sugar, qty: 10 }]);
    status(await put(chai, []), 200, "clear");
    assert.equal(await useOf(chai), undefined);
    assert.equal("stockUse" in (await rawProduct(chai)), false);
  });
  await scenario("d", "per-size amounts are stored; an unknown size is 400 and leaves it unchanged", async () => {
    const chai = await mk("Chai d", sized());
    const sizes = [{ name: "Regular", qtyMilli: 100000 }, { name: "Large", qtyMilli: 0 }];
    status(await put(chai, [line(milk, "ml", ML_150, sizes), line(sugar, "g", G_10)]), 200, "PUT");
    const want = [{ itemId: milk, qty: 150, sizes: [{ name: "Regular", qty: 100 }, { name: "Large", qty: 0 }] }, { itemId: sugar, qty: 10 }];
    assert.deepEqual(plain(await useOf(chai)), want);
    const bad = await put(chai, [line(milk, "ml", ML_150, [{ name: "Huge", qtyMilli: 1000 }])]);
    status(bad, 400, "unknown size");
    assert.match(bad.body.error ?? "", /no size named "Huge"/);
    assert.deepEqual(plain(await useOf(chai)), want);
    const flat = await mk("Chai d2");
    status(await put(flat, [line(milk, "L", 1000, [{ name: "Regular", qtyMilli: 1 }])]), 400, "sizes on a sizeless item");
    assert.equal(await useOf(flat), undefined);
  });
  await scenario("e", "an archived stock item in a PUT is 400 and the stored use is unchanged", async () => {
    const old = await seedItem("Old syrup", "ml", { archived: true });
    const chai = await mk("Chai e");
    status(await put(chai, [line(sugar, "kg", 1000)]), 200, "set");
    const res = await put(chai, [line(old, "ml", 5000)]);
    status(res, 400, "archived");
    assert.match(res.body.error ?? "", /Old syrup is archived/);
    assert.deepEqual(plain(await useOf(chai)), [{ itemId: sugar, qty: 1000 }]);
  });
  await scenario("f", "staff GET / PUT / POST are 403 and nothing is written", async () => {
    const chai = await mk("Chai f");
    const items = await itemCount();
    setRole("staff");
    try {
      status(await get(chai), 403, "staff GET");
      status(await put(chai, [line(milk, "L", 1000)]), 403, "staff PUT");
      status(await tap(chai), 403, "staff POST");
    } finally {
      setRole("admin");
    }
    assert.equal(await useOf(chai), undefined);
    assert.equal(await itemCount(), items, "no stock item created");
  });
  await scenario("g", "two CONCURRENT one-taps: both 200, ONE own StockItem, linked once with qty 1000", async () => {
    const chips = await mk("Chips g");
    const replies = await Promise.all([tap(chips), tap(chips)]);
    assert.deepEqual(replies.map((x) => x.status), [200, 200], JSON.stringify(replies.map((x) => x.body)));
    assert.equal(await ownedBy(chips), 1);
    const own = (await StockItem.collection.findOne({ ownerProductId: oid(chips) })) as Rec;
    assert.deepEqual([own.name, own.unit, own.qty, own.v], ["Chips g", "pcs", 0, 1]);
    assert.deepEqual(plain(await useOf(chips)), [{ itemId: String(own._id), qty: STOCK_QTY_SCALE }]);
    const again = await tap(chips);
    status(again, 200, "a later repeat tap is a replay");
    assert.equal(await ownedBy(chips), 1);
    assert.equal((await useOf(chips))!.length, 1);
  });
  await scenario("h", "one-tap on an item that already uses another stock item is 409, no StockItem created", async () => {
    const chai = await mk("Chai h");
    status(await put(chai, [line(milk, "L", 1000)]), 200, "set");
    const items = await itemCount();
    status(await tap(chai), 409, "one-tap");
    assert.equal(await itemCount(), items);
    assert.equal(await ownedBy(chai), 0);
    assert.deepEqual(plain(await useOf(chai)), [{ itemId: milk, qty: 1000 }]);
  });
  await scenario("i", "one-tap with a name taken by an active item is 409 and no new StockItem", async () => {
    await seedItem("sparkling water", "pcs");
    const water = await mk("Sparkling Water");
    const items = await itemCount();
    status(await tap(water), 409, "name collision");
    assert.equal(await itemCount(), items);
    assert.equal(await useOf(water), undefined);
  });
  await scenario("j", "end to end: a real Pay Now of 1 own-tracked item takes exactly 1000 milli off it", async () => {
    const cola = await mk("Cola j");
    status(await tap(cola), 200, "one-tap");
    const own = (await StockItem.collection.findOne({ ownerProductId: oid(cola) })) as Rec;
    await StockItem.collection.updateOne({ _id: oid(String(own._id)) }, { $set: { qty: OWN_START } });
    const res = await api.create(createBody([ln(cola, "Cola j", PRICE, 1)], true));
    status(res, 201, "Pay Now");
    assert.equal((await rawItem(String(own._id))).qty, OWN_START - STOCK_QTY_SCALE);
    const doc = await rawOrder(String(res.body.data!._id));
    assert.equal(doc.status, "Completed", "landmark: the order is a Pay Now");
    assert.deepEqual(usedOf(doc), [{ itemId: String(own._id), qty: STOCK_QTY_SCALE }]);
  });
  await scenario("k", "GET: unknown product is 404; a bad id is 404; a set use reads back name, unit, archived", async () => {
    status(await get(GHOST), 404, "unknown product");
    status(await get("not-an-id"), 404, "bad id");
    const chai = await mk("Chai k");
    status(await put(chai, [line(milk, "ml", ML_150), line(sugar, "g", G_10)]), 200, "set");
    const res = await get(chai);
    status(res, 200, "GET");
    assert.deepEqual(res.body.data, { lines: [{ itemId: milk, name: "Milk", unit: "L", qtyMilli: 150 }, { itemId: sugar, name: "Sugar", unit: "kg", qtyMilli: 10 }] });
    await StockItem.collection.updateOne({ _id: oid(sugar) }, { $set: { archived: true } });
    try {
      const after = await get(chai);
      assert.deepEqual((after.body.data as Rec).lines, [
        { itemId: milk, name: "Milk", unit: "L", qtyMilli: 150 },
        { itemId: sugar, name: "Sugar", unit: "kg", archived: true, qtyMilli: 10 },
      ]);
    } finally {
      await StockItem.collection.updateOne({ _id: oid(sugar) }, { $unset: { archived: "" } });
    }
    status(await put(GHOST, []), 404, "PUT unknown product");
    status(await tap(GHOST), 404, "POST unknown product");
  });
  await scenario("l", "the products cache key is gone after a PUT (and after a one-tap), not after a refused PUT", async () => {
    const chai = await mk("Chai l");
    const warm = () => cache.set("products", [{ _id: chai }]);
    warm();
    assert.ok(cache.get("products"), "landmark: the cache is warm");
    status(await put(chai, [line(milk, "L", 1000, [{ name: "Nope", qtyMilli: 1 }])]), 400, "refused PUT");
    assert.ok(cache.get("products"), "a refused PUT leaves the cache alone");
    status(await put(chai, [line(milk, "ml", ML_150)]), 200, "PUT");
    assert.equal(cache.get("products"), undefined);
    const chips = await mk("Chips l");
    warm();
    status(await tap(chips), 200, "one-tap");
    assert.equal(cache.get("products"), undefined);
  });
}

const settleIndexBuilds = () => Promise.allSettled(Object.values(mongoose.models).map((model) => model.init()));

// The exact-name guard: prefix AND the one name this leg owns.
function scratchUri(): string {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX) || dbName !== DB_NAME) {
    throw new Error(`Refusing to run against "${dbName}": only ${DB_NAME} (a ${SCRATCH_PREFIX}* database) is allowed.`);
  }
  return uri;
}

async function main(): Promise<void> {
  process.env.MONGODB_URI = scratchUri();
  installStubs();
  await connectDB();
  assert.equal(mongoose.connection.db?.databaseName, DB_NAME, "connected to the guarded scratch database");
  await settleIndexBuilds();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
  console.log(`\ninventory stock use - live against ${DB_NAME}\n`);
  try {
    const use = await import("@/app/api/products/[id]/stock-use/route");
    const own = await import("@/app/api/products/[id]/stock-use/own/route");
    const category = await Category.create({ name: "Menu", order: 1 });
    await runCases(await loadApi(), { use: { GET: use.GET as Handler, PUT: use.PUT as Handler }, own: { POST: own.POST as Handler } }, category._id);
  } finally {
    await settleIndexBuilds();
    await mongoose.connection.dropDatabase();
    const left = await mongoose.connection.db!.admin().listDatabases();
    console.log(`\nscratch database ${DB_NAME} dropped: ${left.databases.every((d) => d.name !== DB_NAME) ? "yes" : "NO"}`);
    await mongoose.disconnect();
  }
  console.log(`\n${tally.passed} passed, ${tally.failed} failed\n`);
  if (tally.failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
