/**
 * Kitchen board, paid Walk-In / parcel arm (spec 2026-11-13 kitchen-paid-walkin) — live-DB leg.
 *
 * WHAT IT PROVES: against a real mongod, through the REAL GET and POST of app/api/kitchen/route.ts, a PAID
 * (Completed) Walk-In (no tableNo) or parcel order of the business day stays on the board until the kitchen taps
 * Ready or 120 minutes pass; table orders still leave on payment; a token order is exactly one card; and the arm's
 * candidate query is served by an index (no COLLSCAN). Orders are seeded in the shapes the create and settle routes
 * write (status/payment, kotRounds 1, kotFiredAt [t], one kitchen line with kotRound 1).
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_kitchen_walkin npm run verify:kitchen:walkin:live
 *
 * SAFETY: refuses any database but exactly pos_scratch_kitchen_walkin on 127.0.0.1 or localhost; drops that database
 * at the start and in finally (never any other). No network: the realtime publisher is switched off below.
 */
delete process.env.REALTIME_PUBLISH_URL;
delete process.env.REALTIME_PUBLISH_SECRET;

import Module from "node:module";
import path from "node:path";
import mongoose, { Types } from "mongoose";

import { connectDB } from "@/lib/db";
import cache from "@/lib/cache";
import { SETTINGS_CACHE_KEY } from "@/lib/settings";
import { Order } from "@/models/Order";
import { KotTick } from "@/models/KotTick";
import { Settings } from "@/models/Settings";
import { TOKEN_DAY_SCAN_LIMIT } from "@/lib/token-board";
import { walkInArmFilter } from "@/lib/kitchen-walkin";
import { slipDayStart } from "@pos/shared/slip-day";
import { dayRange } from "@pos/shared/utils";

const DB_NAME = "pos_scratch_kitchen_walkin";
const MIN = 60_000;
const HOUR = 60 * MIN;

// The route runs behind requireAuth(); a stubbed lib/auth (the verify-kitchen-live.ts idiom) lets the real handlers
// run. It must be installed before the route is imported.
function stubAuth(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  stub.exports = {
    auth: async () => ({ user: { id: "665f0000000000000000beef", name: "Live leg", role: "staff" } }),
    handlers: {},
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  require.cache[file] = stub;
}
stubAuth();

interface Card {
  orderId: string;
  newestFiredAt: string;
  lines: Array<{ ref: string }>;
}
type Route = typeof import("@/app/api/kitchen/route");
let route: Route;
let passed = 0;
let failed = 0;
let seq = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(ok ? `PASS  ${name}` : `FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function board(): Promise<Card[]> {
  const res = await route.GET();
  const json = (await res.json()) as { data?: { cards: Card[] }; cards?: Card[] };
  return json.data?.cards ?? json.cards ?? [];
}
async function post(body: unknown): Promise<number> {
  const res = await route.POST(new Request("http://localhost/api/kitchen", { method: "POST", body: JSON.stringify(body) }));
  return res.status;
}
const find = (cards: Card[], id: string) => cards.find((c) => c.orderId === id);
async function onBoard(id: string): Promise<boolean> {
  return find(await board(), id) !== undefined;
}

interface Seed {
  paid?: boolean;
  tableNo?: string;
  parcel?: boolean;
  tokenNumber?: number;
  firedMinAgo?: number;
  createdHoursAgo?: number;
  status?: string;
  noKot?: boolean;
}
/** One order in the shape the create/settle routes write; returns its _id string. */
async function seed(o: Seed = {}): Promise<string> {
  seq += 1;
  const fired = new Date(Date.now() - (o.firedMinAgo ?? 5) * MIN);
  const paid = o.paid ?? true;
  const doc = await Order.create({
    orderId: `WK-${seq}`,
    customerName: "Walk-In",
    items: [
      { productId: new Types.ObjectId(), name: "Masala Chai", price: 40, qty: 1, modifiers: [], instructions: "", kotRound: 1, ...(o.noKot ? { noKot: true } : {}) },
    ],
    subtotal: 40,
    total: 40,
    paidAmount: paid ? 40 : 0,
    payment: paid ? "Cash" : "Unpaid",
    status: o.status ?? (paid ? "Completed" : "Pending"),
    receiver: "Live leg",
    kotRounds: 1,
    kotFiredAt: [fired],
    ...(o.tableNo ? { tableNo: o.tableNo } : {}),
    ...(o.parcel ? { parcel: true } : {}),
    ...(o.tokenNumber ? { tokenNumber: o.tokenNumber } : {}),
  });
  // createdAt is the business-day bound and the floor of the newest-fire rule: a real order is created BEFORE its
  // round fires, so default it to a minute earlier (Order.create would stamp "now"). Set it on the collection so no
  // timestamps logic can interfere.
  const created = o.createdHoursAgo !== undefined ? new Date(Date.now() - o.createdHoursAgo * HOUR) : new Date(fired.getTime() - MIN);
  await Order.collection.updateOne({ _id: doc._id }, { $set: { createdAt: created } });
  return String(doc._id);
}
const settle = (id: string) => Order.updateOne({ _id: id }, { $set: { status: "Completed", payment: "Cash", paidAmount: 40 } });
async function setTokens(on: boolean): Promise<void> {
  await Settings.updateOne({}, { $set: { tokenEnabled: on } });
  cache.del(SETTINGS_CACHE_KEY);
}

function assertSafeTarget(): void {
  const uri = process.env.MONGODB_URI ?? "";
  const m = /^mongodb:\/\/([^/?]+)\/([^?]*)/.exec(uri);
  const host = (m?.[1] ?? "").split("@").pop() ?? "";
  if (!m || m[2] !== DB_NAME || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    console.error(`Refusing to run: MONGODB_URI must be mongodb://127.0.0.1:27017/${DB_NAME} (got ${uri || "nothing"}).`);
    process.exit(2);
  }
}
async function dropScratch(): Promise<void> {
  if (mongoose.connection.name !== DB_NAME) throw new Error(`connected to ${mongoose.connection.name}, not ${DB_NAME}`);
  await mongoose.connection.dropDatabase();
}

async function run(): Promise<void> {
  await connectDB();
  await dropScratch();
  await Order.init();
  route = await import("@/app/api/kitchen/route");

  // A reset time that puts today's business-day start 6 h (inside 3-12 h) before now, at any hour of the day.
  const target = new Date(Date.now() - 6 * HOUR);
  const reset = Math.floor((target.getTime() - dayRange(target).start.getTime()) / MIN);
  const dayStart = slipDayStart(new Date(), reset);
  const ageH = (Date.now() - dayStart.getTime()) / HOUR;
  console.log(`dayStart ${dayStart.toISOString()} (reset ${reset} min, ${ageH.toFixed(2)} h before now)`);
  if (ageH < 3 || ageH > 12) throw new Error("computed dayStart is not 3-12 h before now");
  await Settings.create({ tokenEnabled: false, numberResetMinutes: reset });
  cache.del(SETTINGS_CACHE_KEY);

  // 1-4: Pay Now Walk-In, Ready, Undo, tick.
  const a = await seed();
  const card = find(await board(), a);
  check("1 paid Pay Now Walk-In is on the board", card !== undefined);
  const seen = card?.newestFiredAt;
  const ready = await post({ action: "ready", orderId: a, ready: true, seenFiredAt: seen });
  check("2 Ready answers 200 and the card is gone", ready === 200 && !(await onBoard(a)), `status ${ready}`);
  const undo = await post({ action: "ready", orderId: a, ready: false });
  check("3 Undo answers 200 and the card is back", undo === 200 && (await onBoard(a)), `status ${undo}`);
  const tick = await post({ action: "tick", orderId: a, ref: card?.lines[0]?.ref ?? "x", done: true });
  check("4 a line tick on a paid Walk-In answers 200", tick === 200, `status ${tick}`);

  // 5: KOT-first Walk-In, settled in place.
  const b = await seed({ paid: false });
  const before = await onBoard(b);
  await settle(b);
  check("5 KOT-first Walk-In is on the board open and after the settle", before && (await onBoard(b)), `open ${before}`);

  // 6-8: QR parcel, paid table order, stale.
  check("6 paid QR parcel is on the board", await onBoard(await seed({ parcel: true })));
  const t = await seed({ tableNo: "T-1" });
  const tableTick = await post({ action: "tick", orderId: t, ref: "x", done: true });
  check("7 paid table order is NOT on the board and a tick answers 404", !(await onBoard(t)) && tableTick === 404, `tick ${tableTick}`);
  check("8 paid Walk-In fired 121 minutes ago is NOT on the board", !(await onBoard(await seed({ firedMinAgo: 121 }))));

  // 9-12: review focus 1-4.
  const u = await seed({ paid: false, tableNo: "T-9" });
  await Order.updateOne({ _id: u }, { $unset: { tableNo: "" } });
  await settle(u);
  check("9 an UNSEATed tab, paid, is on the board", await onBoard(u));
  const s = await seed({ paid: false });
  await Order.updateOne({ _id: s }, { $set: { tableNo: "T-2" } });
  await settle(s);
  check("10 a Walk-In given a table, then paid, is NOT on the board", !(await onBoard(s)));
  const r = await seed({ paid: false, firedMinAgo: 10 });
  await KotTick.updateOne({ _id: r }, { $set: { readyAt: new Date(Date.now() - 10 * MIN) } }, { upsert: true });
  await settle(r);
  check("11 an open Walk-In marked Ready, then paid, is NOT on the board", !(await onBoard(r)));
  const old = await seed({ createdHoursAgo: 25, firedMinAgo: 30 });
  check("12 a Walk-In created before today's dayStart is NOT on the board", !(await onBoard(old)));

  // 13: cancelled.
  await Order.updateOne({ _id: a }, { $set: { status: "Cancelled" } });
  check("13 a Cancelled order is gone", !(await onBoard(a)));

  // 14: tokens on.
  await setTokens(true);
  const tok = await seed({ tokenNumber: 7 });
  check("14a tokens on: a paid Walk-In WITH a token is exactly one card", (await board()).filter((c) => c.orderId === tok).length === 1);
  check("14b tokens on: a paid Walk-In WITHOUT a token is on the board", await onBoard(await seed()));
  await setTokens(false);

  // 15: skip-KOT.
  check("15 a paid Walk-In whose only line is noKot has no card", !(await onBoard(await seed({ noKot: true }))));

  // 16: the arm's candidate query uses an index.
  const mode = { enabled: false, dayStart, clearMinutes: 10 };
  const plan = await Order.find({ ...walkInArmFilter(mode), kotRounds: { $gte: 1 } })
    .sort({ createdAt: -1 })
    .limit(TOKEN_DAY_SCAN_LIMIT)
    .explain("queryPlanner");
  const winning = JSON.stringify((plan as unknown as { queryPlanner: { winningPlan: unknown } }).queryPlanner.winningPlan);
  const indexes = [...winning.matchAll(/"indexName":"([^"]+)"/g)].map((x) => x[1]);
  console.log(`winning plan index: ${indexes.join(", ") || "(none)"}`);
  check("16 the Walk-In candidate query has no COLLSCAN", !winning.includes("COLLSCAN") && indexes.length > 0, winning);
}

async function main(): Promise<void> {
  assertSafeTarget();
  try {
    await run();
  } catch (error) {
    failed += 1;
    console.log(`FAIL  leg aborted — ${error instanceof Error ? error.stack : String(error)}`);
  } finally {
    try {
      await dropScratch();
    } catch (error) {
      console.log(`WARN  could not drop ${DB_NAME}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await mongoose.disconnect();
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
