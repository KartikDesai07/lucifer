/**
 * Skip-KOT S6 live leg ("no kitchen ticket" items). Drives the REAL route handlers (PUT /api/categories/[id],
 * PUT /api/products/[id], POST /api/orders, POST items / items/void, GET + POST /api/kitchen, GET /api/tokens)
 * against a real mongod. Only `@/lib/auth` is swapped for a signed-in ADMIN stub, seeded into the CJS module cache
 * before any route loads, so every leg runs the routes' exact validators, gates and writes. Order requests carry the
 * print-agent headers exactly as a POS tab's agent sends them (no print host: the asking device prints its own), so
 * the routes make their PrintJobs and the legs read them back.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_skipkot node --import tsx scripts/verify-skip-kot-live.ts
 *
 * SAFETY: refuses any database whose name lacks the scratch prefix, drops the whole scratch database at start and
 * end, prints pass/fail only. (console output is intentional - this is an ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { KotTick } from "@/models/KotTick";
import { PrintJob } from "@/models/PrintJob";
import { Counter } from "@/models/Counter";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { Settings } from "@/models/Settings";
import { invalidateSettingsCache } from "@/lib/settings";
import { withKitchenFlags } from "@/lib/kitchen-lines-server";
import { orderLineKey } from "@pos/shared/utils";
import { PRINT_AGENT_HEADER, PRINT_BILL_HEADER, PRINT_DEVICE_ID_HEADER, PRINT_HEADER_ON } from "@pos/shared/print-agent-wire";
import { baseResetMinutes } from "./verify-token-live-clock";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}skipkot`;
const STAFF_ID = "665f0000000000000000beef";
const DEVICE = "live-skipkot-pos-tab";
const TIMING_RUNS = 20;
const FIRE_GAP_MS = 1_100; // a later round's fire instant must be strictly after the Ready stamp
const MENU = {
  food: "665f0000000000000000c001",
  beverages: "665f0000000000000000c002",
  burger: { _id: "665f0000000000000000a101", name: "Burger", price: 150 },
  water: { _id: "665f0000000000000000a102", name: "Water", price: 20 },
  coldCoffee: { _id: "665f0000000000000000a103", name: "Cold Coffee", price: 90 },
};
type Dish = { _id: string; name: string; price: number };

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

async function loadRoutes() {
  return {
    category: await import("@/app/api/categories/[id]/route"),
    product: await import("@/app/api/products/[id]/route"),
    create: await import("@/app/api/orders/route"),
    items: await import("@/app/api/orders/[id]/items/route"),
    void: await import("@/app/api/orders/[id]/items/void/route"),
    kitchen: await import("@/app/api/kitchen/route"),
    tokens: await import("@/app/api/tokens/route"),
  };
}
let r: Awaited<ReturnType<typeof loadRoutes>>;

// ── leg bookkeeping: one PASS/FAIL line per leg, every sub-check listed under it ──
let legFailed: string[] = [];
const legResults: Array<{ name: string; ok: boolean }> = [];
function check(label: string, ok: boolean): void {
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) legFailed.push(label);
}
async function leg(name: string, body: () => Promise<void>): Promise<void> {
  legFailed = [];
  console.log(`\n${name}`);
  try {
    await body();
  } catch (e) {
    legFailed.push(`threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ok = legFailed.length === 0;
  legResults.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` (${legFailed.length} failed)`}`);
}

// ── route calls, exactly as a POS tab makes them ──
type PrintRef = { id: string; kind: string };
type OrderOut = { _id: string; tokenNumber?: number; kotNumbers?: number[]; printJobs?: PrintRef[] };
type Res<T> = { status: number; body: { success: boolean; data?: T; error?: string } };
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const idp = (id: string) => ({ params: Promise.resolve({ id }) });
function request(method: string, url: string, body?: unknown, opts: { agent?: boolean; bill?: boolean } = {}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(opts.agent ? { [PRINT_AGENT_HEADER]: PRINT_HEADER_ON, [PRINT_DEVICE_ID_HEADER]: DEVICE } : {}),
    ...(opts.bill ? { [PRINT_BILL_HEADER]: PRINT_HEADER_ON } : {}),
  };
  return new Request(`http://live.test${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function answer<T>(pending: Response | Promise<Response>): Promise<Res<T>> {
  const res = await pending;
  return { status: res.status, body: (await res.json()) as Res<T>["body"] };
}
const lineOf = (d: Dish, qty = 1) => ({ productId: d._id, name: d.name, price: d.price, qty });
function create(lines: Array<ReturnType<typeof lineOf>>, payNow = false) {
  const sum = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const payload = {
    customerName: "Skip KOT leg", items: lines, subtotal: sum, total: sum, receiver: "Live leg",
    ...(payNow ? { payment: "Cash", status: "Completed" } : { payment: "Unpaid", status: "Pending" }),
  };
  return answer<OrderOut>(r.create.POST(request("POST", "/api/orders", payload, { agent: true, bill: payNow })));
}
const addRound = (id: string, lines: Array<ReturnType<typeof lineOf>>) =>
  answer<OrderOut>(r.items.POST(request("POST", `/api/orders/${id}/items`, { items: lines }, { agent: true }), idp(id)));
const kindsOf = (res: Res<OrderOut>) => (res.body.data?.printJobs ?? []).map((j) => j.kind).join();
const rawOrder = (id: string) => Order.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
const jobsOf = (id: string) => PrintJob.find({ orderId: id }).sort({ createdAt: 1, _id: 1 }).lean();
const snapshotNames = (payload: string): string[] =>
  ((JSON.parse(payload) as { snapshot?: { items?: Array<{ name: string }> } }).snapshot?.items ?? []).map((i) => i.name);
async function seriesTotal(series: "kot" | "token"): Promise<number> {
  const rows = await Counter.collection.find({ _id: { $regex: `^${series}-` } as never }).toArray();
  return rows.reduce((s, row) => s + Number((row as { seq?: number }).seq ?? 0), 0);
}
type Card = { orderId: string; lines: Array<{ name: string }>; newestFiredAt: string };
type Entry = { id: string };
const cardOf = async (id: string) =>
  ((await answer<{ cards: Card[] }>(r.kitchen.GET())).body.data?.cards ?? []).find((c) => c.orderId === id);
async function tokenPlace(id: string): Promise<"preparing" | "ready" | "none"> {
  const b = (await answer<{ preparing: Entry[]; ready: Entry[] }>(r.tokens.GET())).body.data;
  return b?.preparing.some((e) => e.id === id) ? "preparing" : b?.ready.some((e) => e.id === id) ? "ready" : "none";
}
type RawLine = { name: string; noKot?: unknown; kotRound?: number; productId: unknown; qty: number };
const linesOf = async (id: string) => ((await rawOrder(id))?.items ?? []) as RawLine[];

// ── setup: the menu, configured through the REAL menu routes ──
async function setup(): Promise<void> {
  await Category.create([{ _id: MENU.food, name: "Food" }, { _id: MENU.beverages, name: "Beverages" }]);
  await Product.create([
    { ...MENU.burger, categoryId: MENU.food },
    { ...MENU.water, categoryId: MENU.beverages },
    { ...MENU.coldCoffee, categoryId: MENU.beverages },
  ]);
  const cat = await answer(r.category.PUT(request("PUT", `/api/categories/${MENU.beverages}`, { noKot: true }), idp(MENU.beverages)));
  const prod = await answer(r.product.PUT(request("PUT", `/api/products/${MENU.coldCoffee._id}`, { noKot: false }), idp(MENU.coldCoffee._id)));
  const storedCat = await Category.collection.findOne({ _id: new mongoose.Types.ObjectId(MENU.beverages) });
  const storedCoffee = await Product.collection.findOne({ _id: new mongoose.Types.ObjectId(MENU.coldCoffee._id) });
  const storedWater = await Product.collection.findOne({ _id: new mongoose.Types.ObjectId(MENU.water._id) });
  check("PUT /api/categories/[id] {noKot:true} 200 -> Beverages stores noKot:true", cat.status === 200 && storedCat?.noKot === true);
  check("PUT /api/products/[id] {noKot:false} 200 -> Cold Coffee stores noKot:false; Water carries no key (follows Beverages)", prod.status === 200 && storedCoffee?.noKot === false && storedWater !== null && !("noKot" in storedWater));
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) throw new Error(`Refusing to run against "${dbName}" - scratch (${SCRATCH_PREFIX}*) databases only.`);
  process.env.MONGODB_URI = uri;
  r = await loadRoutes();
  await connectDB();
  await mongoose.connection.dropDatabase();
  await Promise.all([Order.createIndexes(), KotTick.createIndexes(), PrintJob.createIndexes()]);
  await Settings.create({
    kotShowNumber: true, kotNumberStart: 1, kotNumberVoidSlips: true, billShowNumber: true, billNumberStart: 1,
    tokenEnabled: true, tokenNumberStart: 1, numberResetMinutes: baseResetMinutes(),
  });
  invalidateSettingsCache();
  console.log(`\nSkip-KOT S6 - live against ${dbName}`);
  try {
    await leg("setup: Beverages skips the kitchen, Cold Coffee overrides to always", setup);
    let mixedId = "";
    await leg("(a) mixed create Burger x2 + Water: Water stamped, Burger keyless, KOT job = Burger only", async () => {
      const res = await create([lineOf(MENU.burger, 2), lineOf(MENU.water)]);
      mixedId = String(res.body.data?._id);
      const lines = await linesOf(mixedId);
      const water = lines.find((l) => l.name === "Water");
      const burger = lines.find((l) => l.name === "Burger");
      check("201; the answer's printJobs are [kot, token]", res.status === 201 && kindsOf(res) === "kot,token");
      check("stored Water line noKot === true", water?.noKot === true);
      check("stored Burger line carries NO noKot key (omit-empty)", burger !== undefined && !("noKot" in burger));
      const jobs = await jobsOf(mixedId);
      const kot = jobs.find((j) => j.jobKey === `kot:${mixedId}:1`);
      const token = jobs.find((j) => j.kind === "token");
      check("landmark: the token job snapshot (whole order) lists Burger AND Water", token !== undefined && JSON.stringify(snapshotNames(token.payload).sort()) === '["Burger","Water"]');
      check("the kot:<id>:1 job snapshot lists Burger only", kot !== undefined && JSON.stringify(snapshotNames(kot.payload)) === '["Burger"]');
      const card = await cardOf(mixedId);
      check("GET /api/kitchen card shows Burger only", card !== undefined && card.lines.length > 0 && card.lines.every((l) => l.name === "Burger"));
    });
    await leg("(b) Water-only Pay Now, KOT numbers + tokens ON: no KOT number, no token, no kot/token job; the bill prints", async () => {
      const [kotBefore, tokenBefore] = [await seriesTotal("kot"), await seriesTotal("token")];
      const res = await create([lineOf(MENU.water, 2)], true);
      const id = String(res.body.data?._id);
      const raw = await rawOrder(id);
      check("201; the answer's printJobs are [bill] only", res.status === 201 && kindsOf(res) === "bill");
      check("landmark: the stored order is Completed with a bill number and its Water line stamped", raw?.status === "Completed" && typeof raw?.billNumber === "number" && (raw?.items as RawLine[])[0]?.noKot === true);
      check("the stored order has no kotNumbers key and no tokenNumber key", raw !== null && !("kotNumbers" in raw) && !("tokenNumber" in raw));
      check("no kot and no token PrintJob for it; exactly one bill job", (await PrintJob.countDocuments({ orderId: id, kind: { $in: ["kot", "token"] } })) === 0 && (await PrintJob.countDocuments({ orderId: id, kind: "bill" })) === 1);
      check("the KOT and token counters did not move", (await seriesTotal("kot")) === kotBefore && (await seriesTotal("token")) === tokenBefore);
      check("never on Now Serving / the token board, no Kitchen card", (await tokenPlace(id)) === "none" && (await cardOf(id)) === undefined);
    });
    let coffeeId = "";
    await leg("(c) Cold Coffee (noKot:false inside the skip category) prints on the KOT", async () => {
      const res = await create([lineOf(MENU.coldCoffee)]);
      coffeeId = String(res.body.data?._id);
      const raw = await rawOrder(coffeeId);
      const kot = (await jobsOf(coffeeId)).find((j) => j.jobKey === `kot:${coffeeId}:1`);
      check("201 with [kot, token] jobs, one KOT number and a token", res.status === 201 && kindsOf(res) === "kot,token" && (raw?.kotNumbers as number[] | undefined)?.length === 1 && typeof raw?.tokenNumber === "number");
      check("the stored line carries no noKot key", !("noKot" in ((raw?.items as RawLine[])[0] ?? { noKot: 1 })));
      check("its KOT job snapshot lists Cold Coffee", kot !== undefined && JSON.stringify(snapshotNames(kot.payload)) === '["Cold Coffee"]');
    });
    await leg("(d) Water-only add-round on an open tab: no KOT number, no KOT job; a later Burger round backfills 0", async () => {
      const before = (await rawOrder(coffeeId))?.kotNumbers as number[];
      const kotBefore = await seriesTotal("kot");
      const res = await addRound(coffeeId, [lineOf(MENU.water)]);
      const raw = await rawOrder(coffeeId);
      check("200; kotRounds 2; the answer names no print job", res.status === 200 && raw?.kotRounds === 2 && kindsOf(res) === "");
      check("kotNumbers unchanged (no entry for round 2) and the KOT counter did not move", JSON.stringify(raw?.kotNumbers) === JSON.stringify(before) && (await seriesTotal("kot")) === kotBefore);
      check("the round-2 Water line is stamped noKot:true", (raw?.items as RawLine[]).some((l) => l.name === "Water" && l.kotRound === 2 && l.noKot === true));
      check("no kot:<id>:2 PrintJob", (await PrintJob.countDocuments({ jobKey: `kot:${coffeeId}:2` })) === 0);
      const burger = await addRound(coffeeId, [lineOf(MENU.burger)]);
      const after = (await rawOrder(coffeeId))?.kotNumbers as number[];
      check("landmark: a Burger round 3 draws a number, kotNumbers = [n1, 0, n3], kot:<id>:3 job made", burger.status === 200 && kindsOf(burger) === "kot" && after.length === 3 && after[0] === before[0] && after[1] === 0 && after[2] > 0 && (await PrintJob.countDocuments({ jobKey: `kot:${coffeeId}:3` })) === 1);
    });
    await leg("(e) a Ready tab that fires a Water-only round stays off GET /api/kitchen and its token stays Ready", async () => {
      const res = await create([lineOf(MENU.burger)]);
      const id = String(res.body.data?._id);
      const card = await cardOf(id);
      check("landmark: the Burger tab has a card and a preparing token", res.status === 201 && card !== undefined && (await tokenPlace(id)) === "preparing");
      const ready = await answer(r.kitchen.POST(request("POST", "/api/kitchen", { action: "ready", orderId: id, ready: true, seenFiredAt: card?.newestFiredAt })));
      check("Kitchen POST ready 200 -> card gone, token Ready", ready.status === 200 && (await cardOf(id)) === undefined && (await tokenPlace(id)) === "ready");
      await sleep(FIRE_GAP_MS);
      const water = await addRound(id, [lineOf(MENU.water)]);
      check("Water round 200 (round 2 fired, later than the Ready stamp)", water.status === 200 && (await rawOrder(id))?.kotRounds === 2);
      check("no ghost card on GET /api/kitchen; the token stays Ready", (await cardOf(id)) === undefined && (await tokenPlace(id)) === "ready");
      await sleep(FIRE_GAP_MS);
      await addRound(id, [lineOf(MENU.burger)]);
      const back = await cardOf(id);
      check("landmark: a later Burger round DOES bring the card back (Preparing), showing no Water line", back !== undefined && back.lines.every((l) => l.name === "Burger") && (await tokenPlace(id)) === "preparing");
    });
    await leg("(f) voiding a Water line: trail entry noKot:true, no void number, no void job; a Burger void still gets both", async () => {
      const voidOf = async (name: string, expectedVoids: number) => {
        const fresh = await linesOf(mixedId); // re-read: a full void splices the line out and shifts the indices
        const index = fresh.findIndex((l) => l.name === name);
        const line = fresh[index];
        const body = { index, lineKey: orderLineKey({ ...line, productId: String(line.productId) } as Parameters<typeof orderLineKey>[0]), qty: 1, expectedVoids, reason: "Live leg void" };
        return answer<OrderOut>(r.void.POST(request("POST", `/api/orders/${mixedId}/items/void`, body, { agent: true }), idp(mixedId)));
      };
      const kotBefore = await seriesTotal("kot");
      const res = await voidOf("Water", 0);
      const raw = await rawOrder(mixedId);
      const entry = (raw?.voids as Array<Record<string, unknown>> | undefined)?.at(-1);
      check("200; the trail entry is Water with noKot:true and no kotNumber", res.status === 200 && entry?.name === "Water" && entry?.noKot === true && !("kotNumber" in (entry ?? {})));
      check("the KOT counter did not move; the answer names no job; no void PrintJob", (await seriesTotal("kot")) === kotBefore && kindsOf(res) === "" && (await PrintJob.countDocuments({ orderId: mixedId, kind: "void" })) === 0);
      const burger = await voidOf("Burger", 1);
      const bEntry = ((await rawOrder(mixedId))?.voids as Array<Record<string, unknown>>).at(-1);
      check("landmark: a Burger void draws a number, keeps no noKot key, makes one void job", burger.status === 200 && typeof bEntry?.kotNumber === "number" && !("noKot" in bEntry) && kindsOf(burger) === "void" && (await PrintJob.countDocuments({ orderId: mixedId, kind: "void" })) === 1);
    });
    await leg(`(g) timing: withKitchenFlags over ${TIMING_RUNS} runs (3 lines, one skip category)`, async () => {
      const sample = [lineOf(MENU.burger), lineOf(MENU.water), lineOf(MENU.coldCoffee)];
      const ms: number[] = [];
      let last: Awaited<ReturnType<typeof withKitchenFlags<(typeof sample)[number]>>> | undefined;
      for (let i = 0; i < TIMING_RUNS; i++) {
        const t0 = performance.now();
        last = await withKitchenFlags(sample);
        ms.push(performance.now() - t0);
      }
      ms.sort((a, b) => a - b);
      const median = (ms[TIMING_RUNS / 2 - 1] + ms[TIMING_RUNS / 2]) / 2;
      console.log(`    median ${median.toFixed(2)} ms (min ${ms[0].toFixed(2)}, max ${ms[TIMING_RUNS - 1].toFixed(2)})`);
      check("landmark: the timed call stamped Water only and kept kitchen:true", last?.kitchen === true && last.lines.map((l) => ("noKot" in l ? l.name : "")).join() === ",Water,");
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  const failedLegs = legResults.filter((l) => !l.ok).length;
  console.log(`\n${legResults.length - failedLegs} legs passed, ${failedLegs} failed\n`);
  if (failedLegs > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
