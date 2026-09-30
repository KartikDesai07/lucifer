/**
 * Menu B2 Slice C live leg — the order routes refuse (409) a NEW line whose
 * product is missing / archived / out of stock, or whose price or name is not
 * what the menu says now; and everything that must NOT be refused still isn't.
 * Drives the REAL route handlers (POST /api/orders, POST /api/orders/[id]/items,
 * GET /api/products) against a real mongod. Only `@/lib/auth` is swapped for a
 * signed-in stub with a SWITCHABLE role (verify-menu-live.ts pattern); every
 * refusal runs as STAFF. Runs EVERY case, prints PASS/FAIL per case, exits
 * non-zero if any failed. The 300-line ceiling splits it: the refusal table
 * (cases 2, 6, 9) is verify-menu-orders-live-refusals.ts, the R6 races (case 7)
 * verify-menu-orders-live-race.ts.
 *
 *   node --import tsx scripts/verify-menu-orders-live.ts
 *
 * SAFETY: refuses any database whose name is not the scratch one below (it
 * must also start with pos_scratch_), and drops ONLY that database, by exact
 * name, over a separate connection before connectDB and again at the end —
 * never lists or drops any other database. (console output is intentional —
 * this is an ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import cache from "@/lib/cache";
import { Order } from "@/models/Order";
import { Counter, slipCounterKey } from "@/models/Counter";
import { Customer } from "@/models/Customer";
import { Product } from "@/models/Product";
import { Settings } from "@/models/Settings";
import { invalidateSettingsCache } from "@/lib/settings";
import { LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";
import { raceCases, type Counters, type Item, type LegCtx, type Line, type Reply } from "./verify-menu-orders-live-race";
import { createRefusals, issue, msg, roundCases, witnessCase } from "./verify-menu-orders-live-refusals";

const SCRATCH_PREFIX = "pos_scratch_";
const DB_NAME = `${SCRATCH_PREFIX}menu_orders`;
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
const STAFF_ID = "665f0000000000000000a001";
const ADMIN_ID = "665f0000000000000000a002";
const FLAT_AT = 8;
const ITEM_AT = 16;
const START_STAMPS = 30;

type Role = "admin" | "staff";
let currentRole: Role = "staff";
function stubAuth(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  stub.exports = {
    auth: async () => ({ user: currentRole === "admin" ? { id: ADMIN_ID, name: "Live leg admin", role: "admin" } : { id: STAFF_ID, name: "Live leg staff", role: "staff" } }),
    handlers: {},
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  require.cache[file] = stub;
}
stubAuth();
let createRoute: typeof import("@/app/api/orders/route");
let itemsRoute: typeof import("@/app/api/orders/[id]/items/route");
let productsRoute: typeof import("@/app/api/products/route");

// ── case runner: every case runs; a case PASSES when all its checks did ──
const results: { name: string; ok: boolean }[] = [];
let caseOk = true;
function check(label: string, ok: boolean): void {
  if (!ok) caseOk = false;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
}
async function runCase(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n${name}`);
  caseOk = true;
  currentRole = "staff"; // every case starts as staff, whatever the last one did
  try {
    await fn();
  } catch (e) {
    caseOk = false;
    console.log(`  FAIL threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  results.push({ name, ok: caseOk });
  console.log(`  => ${caseOk ? "PASS" : "FAIL"}  ${name}`);
}

// ── fixtures + route calls (the routes' exact call shape) ──
const post = (url: string, body: unknown) => new Request(`http://live.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const total = (items: Line[]) => items.reduce((s, l) => s + l.price * l.qty, 0);
async function create(items: Line[], extra: Record<string, unknown> = {}): Promise<Reply> {
  const payload = { customerName: "Menu leg", items, subtotal: total(items), total: total(items), payment: "Unpaid", status: "Pending", receiver: "Live leg", ...extra };
  const res = await createRoute.POST(post("/api/orders", payload));
  return { status: res.status, body: (await res.json()) as Reply["body"] };
}
async function round(id: string, items: Line[], idemKey?: string, extra: Record<string, unknown> = {}): Promise<Reply> {
  const res = await itemsRoute.POST(post(`/api/orders/${id}/items`, { items, ...(idemKey ? { idemKey } : {}), ...extra }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Reply["body"] };
}
const categoryId = new mongoose.Types.ObjectId();
async function mk(name: string, price = 100, extra: Record<string, unknown> = {}): Promise<Item> {
  const doc = await Product.create({ name, categoryId, price, ...extra });
  return { id: String(doc._id), name, price };
}
const ln = (it: Item, qty = 1, extra: Partial<Line> = {}): Line => ({ productId: it.id, name: it.name, price: it.price, qty, ...extra });
let phone = 0;
async function mkCustomer(): Promise<string> {
  phone += 1;
  return String((await Customer.create({ name: `Menu leg ${phone}`, mobile: `98765${String(10000 + phone)}`, stamps: START_STAMPS })).id);
}
const setProduct = (it: { id: string }, set: Record<string, unknown>) => Product.updateOne({ _id: it.id }, { $set: set });
const seqOf = async (key: string) => ((await Counter.findById(key).lean())?.seq as number | undefined) ?? 0;
const today = () => slipCounterKey("kot", new Date()).slice("kot-".length);
const counters = async (): Promise<Counters> => ({ order: await seqOf(`order-${today()}`), kot: await seqOf(`kot-${today()}`), bill: await seqOf(`bill-${today()}`) });
const snap = async (key?: string) => ({ orders: await Order.countDocuments({}), byKey: key ? await Order.countDocuments({ idemKey: key }) : 0, counters: await counters() });
const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v)) as unknown;
const same = (a: unknown, b: unknown) => isDeepStrictEqual(json(a), json(b));
async function tabSnap(id: string) {
  const o = await Order.findById(id).lean();
  return { items: o?.items, kotRounds: o?.kotRounds, kotNumbers: o?.kotNumbers, kotIdemKeys: o?.kotIdemKeys, total: o?.total, updatedAt: o?.updatedAt?.getTime() };
}
const stampsOf = async (id: string) => {
  const c = await Customer.findById(id).select("+redeemedOrders stamps").lean();
  return { stamps: c?.stamps, redeemedOrders: c?.redeemedOrders ?? [] };
};
let anchor: Item; // a never-touched, in-stock item every fixture tab opens with
let chaiId = ""; // the item-reward dish
const openTab = async (extra: Record<string, unknown> = {}) => String((await create([ln(anchor)], extra)).body.data?._id);
const ctx: LegCtx = { check, create, round, mk, ln, counters, snap, same, tabSnap, openTab, setProduct, setRole: (r) => { currentRole = r; }, categoryId };

async function firstCase(): Promise<void> {
  const plain = await mk("Plain Tea");
  const disc = await mk("Discounted Cake", 200, { discount: 10 });
  const latte = await mk("Sized Latte", 100, { variations: [{ name: "Large", price: 300 }, { name: "Small", price: 90 }], discount: 10 });
  const hidden = await mk("Hidden Item", 80, { publicVisible: false });
  const legacyId = new mongoose.Types.ObjectId();
  // A pre-flag doc, raw: no `discount`, no `available` key at all (lean() fills no defaults).
  await Product.collection.insertOne({ _id: legacyId, name: "Legacy Bun", categoryId, price: 40, isActive: true, image: "", modifiers: [] });
  const lines = [
    ["plain line", ln(plain)],
    ["discounted line (200 - 10% = 180)", ln(disc, 1, { price: 180 })],
    ["sized + discounted line (Large 300 - 10% = 270)", ln(latte, 1, { variation: "Large", price: 270 })],
    ["publicVisible:false item (hidden from the QR menu, sellable at the counter)", ln(hidden)],
    ["legacy doc with no discount/available", ln({ id: String(legacyId), name: "Legacy Bun", price: 40 })],
  ] as const;
  for (const [label, l] of lines) check(`${label} → 201`, (await create([l], { idemKey: randomUUID() })).status === 201);
  const all = lines.map(([, l]) => l);
  check("all five in one order → 201", (await create(all, { idemKey: randomUUID() })).status === 201);
  check("the same five as a round on an open tab → 200", (await round(await openTab(), all, randomUUID())).status === 200);
}

async function rewardRefusal(): Promise<void> {
  const t = await mk("Reward Tea");
  await setProduct(t, { available: false });
  const cust = await mkCustomer();
  const key = randomUUID();
  const [stamps, before] = [await stampsOf(cust), await snap(key)];
  const res = await create([ln(t)], { idemKey: key, customerId: cust, rewardAt: FLAT_AT });
  check("rewardAt + an out-of-stock line → 409 with the exact copy", res.status === 409 && res.body.error === msg(issue("out", "Reward Tea")));
  check("the customer's stamps and redeemedOrders deep-equal before/after", same(await stampsOf(cust), stamps));
  check("Order count, idemKey count and the counters unchanged", same(await snap(key), before));
  await setProduct(t, { available: true });
  const control = await create([ln(t)], { idemKey: randomUUID(), customerId: cust, rewardAt: FLAT_AT });
  const spent = await stampsOf(cust);
  check("CONTROL after restocking, new key → 201 and the reward is spent (30 → 22)", control.status === 201 && spent.stamps === START_STAMPS - FLAT_AT && spent.redeemedOrders.length === 1);
}

async function itemReward(): Promise<void> {
  const tea = await mk("Ordered Tea");
  const made = await create([ln(tea)], { idemKey: randomUUID(), customerId: await mkCustomer(), rewardAt: ITEM_AT });
  const rewards = (await Order.findById(made.body.data?._id).lean())?.items.filter((i) => i.reward) ?? [];
  check("create: an item reward whose dish is NOT among the ordered lines → 201 with exactly one reward:true line", made.status === 201 && rewards.length === 1 && String(rewards[0]?.productId) === chaiId);
  const tab = await openTab({ customerId: await mkCustomer() });
  const added = await round(tab, [ln(tea)], randomUUID(), { rewardAt: ITEM_AT });
  const roundRewards = (await Order.findById(tab).lean())?.items.filter((i) => i.reward) ?? [];
  check("round: the same on an open tab → 200 with exactly one reward:true line (the server-appended line is never judged)", added.status === 200 && roundRewards.length === 1 && roundRewards[0]?.kotRound === 2);
}

async function replays(): Promise<void> {
  const t = await mk("Replay Tea");
  const key = randomUUID();
  const first = await create([ln(t)], { idemKey: key });
  await setProduct(t, { available: false });
  let [c0, n0] = [await counters(), await Order.countDocuments({})];
  const again = await create([ln(t)], { idemKey: key });
  check("create: same key after the item went out of stock → 200, same _id", first.status === 201 && again.status === 200 && again.body.data?._id === first.body.data?._id);
  await setProduct(t, { available: true, price: 130 });
  const priced = await create([ln(t)], { idemKey: key });
  check("create: same key after a price change → 200, same _id", priced.status === 200 && priced.body.data?._id === first.body.data?._id);
  check("create: counters and Order count unchanged by both replays", same(await counters(), c0) && (await Order.countDocuments({})) === n0);

  const r = await mk("Replay Round Tea");
  const tab = await openTab();
  const rKey = randomUUID();
  const landed = await round(tab, [ln(r)], rKey);
  await setProduct(r, { available: false });
  [c0, n0] = [await counters(), (await Order.findById(tab).lean())?.items.length ?? 0];
  const rAgain = await round(tab, [ln(r)], rKey);
  check("round: same key after the item went out of stock → 200, still round 2", landed.status === 200 && rAgain.status === 200 && rAgain.body.data?.kotRounds === 2);
  check("round: counters and the tab's line count unchanged", same(await counters(), c0) && (await Order.findById(tab).lean())?.items.length === n0);
}

async function freshProducts(): Promise<void> {
  const list = async (url: string) => {
    const res = await productsRoute.GET(new Request(`http://live.test${url}`));
    return ((await res.json()) as { data?: { _id: string; available?: boolean }[] }).data ?? [];
  };
  const a = await mk("Fresh Tea");
  const b = await mk("Fresh Archived");
  cache.del("products"); // R8: a direct DB write races past this in-process cache; start clean, then prime it
  const primed = await list("/api/products");
  check("primed list: both items are present and in stock", primed.find((p) => p._id === a.id)?.available === true && primed.some((p) => p._id === b.id));
  await setProduct(a, { available: false });
  await setProduct(b, { isActive: false });
  const plain = await list("/api/products");
  check("plain GET /api/products (cached) still shows the item, still in stock", plain.find((p) => p._id === a.id)?.available === true);
  const fresh = await list("/api/products?fresh=1");
  check("GET /api/products?fresh=1 shows the same item with available:false", fresh.find((p) => p._id === a.id)?.available === false);
  check("?fresh=1 still hides an archived item (landmark: the other item is in the same list)", fresh.some((p) => p._id === a.id) && !fresh.some((p) => p._id === b.id));
  cache.del("products");
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX) || dbName !== DB_NAME) throw new Error(`Refusing to run against "${dbName}" — only ${DB_NAME} (scratch ${SCRATCH_PREFIX}*).`);
  process.env.MONGODB_URI = uri;
  const dropScratch = async () => {
    const conn = await mongoose.createConnection(uri).asPromise();
    try {
      if (conn.name !== DB_NAME) throw new Error(`Refusing to drop "${conn.name}"`);
      await conn.dropDatabase(); // this ONE database, by name — nothing else is listed or dropped
    } finally {
      await conn.close();
    }
  };
  // Dropped over a SEPARATE connection BEFORE connectDB (the idem leg's reason:
  // Order's memoized autoIndex must run against a fresh collection).
  await dropScratch();
  createRoute = await import("@/app/api/orders/route");
  itemsRoute = await import("@/app/api/orders/[id]/items/route");
  productsRoute = await import("@/app/api/products/route");
  try {
    await connectDB();
    await Customer.createIndexes();
    chaiId = (await mk("Reward Chai", 60)).id;
    await Settings.create({
      billShowNumber: true, billNumberStart: 1, kotShowNumber: true, kotNumberStart: 1,
      dinerAccountsEnabled: true, loyaltyEnabled: true, loyaltyMinBill: 0,
      loyaltyRules: { v: LOYALTY_RULES_SCHEMA_VERSION, milestones: [
        { at: FLAT_AT, kind: "flat", value: 20, qty: 1 },
        { at: ITEM_AT, kind: "item", value: 0, item: "Reward Chai", itemProductId: chaiId, qty: 1 },
      ] },
    });
    invalidateSettingsCache();
    anchor = await mk("Anchor Item");
    console.log(`\nMenu B2 orders — live against ${dbName}, as staff`);
    await runCase("(1) must-pass lines: plain, sized+discounted, publicVisible:false, legacy doc", firstCase);
    await runCase("(2) create refusals (+ literal copy pins, control 201 each)", () => createRefusals(ctx));
    await runCase("(3) reward + out-of-stock line → 409, stamps untouched", rewardRefusal);
    await runCase("(4) item reward, dish not among the lines → 201 / 200, one reward:true line", itemReward);
    await runCase("(5) replay after the menu changed → 200, same _id, counters unchanged", replays);
    await runCase("(6) round refusals, fired lines never re-judged, closed tab, removed variation", () => roundCases(ctx));
    await runCase("(7) R6 races: a twin lands before the 409 → 200; control → 409", () => raceCases(ctx));
    await runCase("(8) GET /api/products?fresh=1 bypasses the cache", freshProducts);
    await runCase("(9) witness: checkItemVariations / checkItemRemovedModifiers are null for every refused payload", () => witnessCase(ctx));
  } finally {
    await mongoose.disconnect();
    await dropScratch();
  }
  console.log("\n── per-case result ──");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} cases passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
