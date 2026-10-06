/**
 * Print customization S6 live legs — tokens + the daily restart time. A sibling of verify-slip-numbers-live.ts,
 * which calls runTokenLegs() inside its own try/finally: it owns the scratch-prefix guard, the auth stub (seeded in
 * the CJS cache BEFORE this module loads any route), the Product/Settings fixtures and the final dropDatabase.
 * The REAL routes run here (create / items / void / settle), so every leg goes through the routes' exact validators,
 * refusals, CAS and numbering. (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { Order } from "@/models/Order";
import { Counter, nextSlipSequence, type SlipSeries } from "@/models/Counter";
import { Settings } from "@/models/Settings";
import { invalidateSettingsCache } from "@/lib/settings";
import { cafeDateString, orderLineKey } from "@pos/shared/utils";
import { slipDayKey } from "@pos/shared/slip-day";

type Check = (label: string, ok: boolean) => void;
type Body = { success: boolean; data?: { _id: string; billNumber?: number; tokenNumber?: number }; error?: string };
type Res = { status: number; body: Body };
type Routes = {
  create: typeof import("@/app/api/orders/route");
  settle: typeof import("@/app/api/orders/[id]/settle/route");
  items: typeof import("@/app/api/orders/[id]/items/route");
  voidItem: typeof import("@/app/api/orders/[id]/items/void/route");
};

const PRODUCT = "665f000000000000000000a1"; // the main script's fixture product: Tea at PRICE
const PRICE = 120;
const TOKEN_START = 101;
const PARALLEL_CREATES = 20;
const RESET_4AM = 240;
const RESET_LATE = 1439; // shifts the day back ~24h, so its key differs from today's at almost any time of day
const MS_PER_MINUTE = 60_000;
const ist = (iso: string) => new Date(iso); // fixed instants below are written in UTC, commented in IST
const compact = (d: Date) => cafeDateString(d).replace(/-/g, "");

let routes: Routes;
const post = (url: string, body: unknown) =>
  new Request(`http://live.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function answer(res: Response): Promise<Res> {
  return { status: res.status, body: (await res.json()) as Body };
}
function create(extra: Record<string, unknown> = {}): Promise<Res> {
  const payload = { customerName: "Token leg", items: [{ productId: PRODUCT, name: "Tea", price: PRICE, qty: 1 }], subtotal: PRICE, total: PRICE, payment: "Unpaid", status: "Pending", receiver: "Live leg", ...extra };
  return routes.create.POST(post("/api/orders", payload)).then(answer);
}
const payNow = () => create({ payment: "Cash", status: "Completed" });
const addRound = (id: string) =>
  routes.items.POST(post(`/api/orders/${id}/items`, { items: [{ productId: PRODUCT, name: "Tea", price: PRICE, qty: 1 }] }), { params: Promise.resolve({ id }) }).then(answer);
const settle = (id: string) =>
  routes.settle.POST(post(`/api/orders/${id}/settle`, { payment: "Cash" }), { params: Promise.resolve({ id }) }).then(answer);
async function voidOne(id: string): Promise<Res> {
  const tab = await Order.findById(id).lean();
  const line = tab!.items[0];
  const lineKey = orderLineKey({ ...line, productId: String(line.productId) });
  const body = { index: 0, lineKey, qty: 1, expectedVoids: tab!.voids?.length ?? 0, reason: "Wrong order" };
  return routes.voidItem.POST(post(`/api/orders/${id}/items/void`, body), { params: Promise.resolve({ id }) }).then(answer);
}

async function setSettings(patch: Record<string, unknown>): Promise<void> {
  await Settings.updateOne({}, { $set: patch });
  invalidateSettingsCache();
}
const seqOf = async (key: string) => ((await Counter.findById(key).lean())?.seq as number | undefined) ?? 0;
const tokenDocs = () => Counter.countDocuments({ _id: /^token-/ });
const rawHasToken = async (id: string) => (await Order.collection.countDocuments({ _id: new mongoose.Types.ObjectId(id), tokenNumber: { $exists: true } })) === 1;
const tokenOf = async (id: string) => (await Order.collection.findOne({ _id: new mongoose.Types.ObjectId(id) }))?.tokenNumber as number | undefined;
async function counterSnapshot(): Promise<Map<string, number>> {
  return new Map((await Counter.find().lean()).map((c) => [String(c._id), c.seq as number]));
}
const changedKeys = (before: Map<string, number>, after: Map<string, number>) =>
  [...after].filter(([k, v]) => before.get(k) !== v).map(([k]) => k).sort();

async function t1(check: Check): Promise<void> {
  console.log("T1 tokens off, restart 0 - the old keys, no token anywhere");
  await setSettings({ tokenEnabled: false, numberResetMinutes: 0 });
  const independentKey = `kot-${compact(new Date())}`; // built from cafeDateString here, not through the counter helper
  const before = await seqOf(independentKey);
  const r = await create();
  const id = String(r.body.data?._id);
  check("201 and the kot counter moved on the independently built key", r.status === 201 && (await seqOf(independentKey)) === before + 1);
  check("no token-* counter document exists", (await tokenDocs()) === 0);
  check("the answer and the RAW stored order carry no tokenNumber ($exists:false)", r.body.data?.tokenNumber === undefined && !(await rawHasToken(id)));
}

const tokensT2: { hold1?: string; hold2?: string; payNow?: string } = {};
async function t2(check: Check): Promise<void> {
  console.log(`T2 tokens on, start ${TOKEN_START} - one token per order, none for an add-round, void or settle`);
  await setSettings({ tokenEnabled: true, tokenNumberStart: TOKEN_START });
  const hold1 = await create();
  const hold2 = await create({ items: [{ productId: PRODUCT, name: "Tea", price: PRICE, qty: 2 }], subtotal: PRICE * 2, total: PRICE * 2 });
  const paid = await payNow();
  tokensT2.hold1 = String(hold1.body.data?._id);
  tokensT2.hold2 = String(hold2.body.data?._id);
  tokensT2.payNow = String(paid.body.data?._id);
  const tokens = [hold1, hold2, paid].map((x) => x.body.data?.tokenNumber);
  check(`two held tabs and a Pay Now get ${TOKEN_START}, ${TOKEN_START + 1}, ${TOKEN_START + 2}`, [hold1, hold2, paid].every((x) => x.status === 201) && tokens.join() === [TOKEN_START, TOKEN_START + 1, TOKEN_START + 2].join());
  const day = `token-${slipDayKey(new Date())}`;
  check("the Pay Now also carries its bill number, and today's token counter is 3 (one document)", typeof paid.body.data?.billNumber === "number" && (await seqOf(day)) === 3 && (await tokenDocs()) === 1);
  const kotBefore = await seqOf(`kot-${slipDayKey(new Date())}`);
  const round = await addRound(tokensT2.hold1);
  const voided = await voidOne(tokensT2.hold2);
  const settled = await settle(tokensT2.hold1);
  check("add round 200, void 200, settle 200", round.status === 200 && voided.status === 200 && settled.status === 200);
  check("the token counter is still 3 - none of the three drew a token", (await seqOf(day)) === 3);
  check("landmark: the add round and the void slip DID draw their kitchen tickets", (await seqOf(`kot-${slipDayKey(new Date())}`)) > kotBefore);
  check("each order still holds its own token after the round, void and settle", (await tokenOf(tokensT2.hold1)) === TOKEN_START && (await tokenOf(tokensT2.hold2)) === TOKEN_START + 1 && (await tokenOf(tokensT2.payNow)) === TOKEN_START + 2);
}

async function t3(check: Check): Promise<void> {
  console.log(`T3 ${PARALLEL_CREATES} parallel creates - distinct tokens, counter +${PARALLEL_CREATES}`);
  const key = `token-${slipDayKey(new Date())}`;
  const before = await seqOf(key);
  const results = await Promise.all(Array.from({ length: PARALLEL_CREATES }, () => create()));
  const tokens = results.map((r) => r.body.data?.tokenNumber);
  const distinct = new Set(tokens);
  const want = Array.from({ length: PARALLEL_CREATES }, (_, i) => TOKEN_START + before + i);
  check("all 201", results.every((r) => r.status === 201));
  check(`${PARALLEL_CREATES} distinct tokens, exactly the next ${PARALLEL_CREATES} numbers`, distinct.size === PARALLEL_CREATES && [...distinct].sort().join() === want.sort().join());
  check(`the token counter moved by exactly ${PARALLEL_CREATES}`, (await seqOf(key)) === before + PARALLEL_CREATES);
}

async function t4(check: Check): Promise<void> {
  console.log("T4 restart 240 - the slip counters live on the shifted day");
  await setSettings({ numberResetMinutes: RESET_4AM });
  const now = new Date();
  const shifted = compact(new Date(now.getTime() - RESET_4AM * MS_PER_MINUTE));
  check("slipDayKey(now, 240) equals the independent cafeDateString(now - 240 min)", slipDayKey(now, RESET_4AM) === shifted);
  const before = await counterSnapshot();
  const r = await create();
  const touched = changedKeys(before, await counterSnapshot());
  const orderKey = `order-${compact(now)}`; // order ids deliberately stay on the midnight key
  check("201, a token and the kot number are on the order", r.status === 201 && typeof r.body.data?.tokenNumber === "number");
  check(`exactly kot-${shifted}, token-${shifted} and ${orderKey} moved`, touched.join() === [`kot-${shifted}`, `token-${shifted}`, orderKey].sort().join());
  // Deterministic whatever the time of day: at 23:59 the shifted day is yesterday, so the key cannot be today's.
  await setSettings({ numberResetMinutes: RESET_LATE });
  const lateKey = compact(new Date(Date.now() - RESET_LATE * MS_PER_MINUTE));
  const beforeLate = await counterSnapshot();
  await create();
  const late = changedKeys(beforeLate, await counterSnapshot());
  check(`restart 1439: kot-${lateKey} and token-${lateKey} moved (a different day from today's ${compact(now)})`, lateKey !== compact(now) && late.includes(`kot-${lateKey}`) && late.includes(`token-${lateKey}`) && !late.includes(`token-${compact(now)}`));
}

type Draw = { key: string; seq: number };
async function draws(series: SlipSeries, plan: Array<[Date, number, number]>): Promise<Draw[]> {
  const out: Draw[] = [];
  for (const [at, resetMinutes, times] of plan) {
    for (let i = 0; i < times; i += 1) {
      const seq = await nextSlipSequence(series, null, at, resetMinutes);
      out.push({ key: `${series}-${slipDayKey(at, resetMinutes)}`, seq });
    }
  }
  return out;
}
function risesPerKey(all: Draw[]): boolean {
  const last = new Map<string, number>();
  for (const { key, seq } of all) {
    if (seq <= (last.get(key) ?? 0)) return false;
    last.set(key, seq);
  }
  return new Set(all.map((d) => `${d.key}#${d.seq}`)).size === all.length;
}

async function t5(check: Check): Promise<void> {
  console.log("T5 the restart time changed mid-night, on a real mongod (fixed 2020 instants)");
  // 00:00 -> 04:00 changed at 02:00 on 2020-03-10 IST. Instants are UTC: 01:00 IST = 19:30Z the day before.
  const yesterdayNoon = ist("2020-03-09T06:30:00Z");
  const at0100 = ist("2020-03-09T19:30:00Z");
  const at0230 = ist("2020-03-09T21:00:00Z");
  const at0430 = ist("2020-03-09T23:00:00Z");
  const up = await draws("token", [[yesterdayNoon, 0, 5], [at0100, 0, 3], [at0230, RESET_4AM, 2], [at0430, RESET_4AM, 2]]);
  check("00:00 -> 04:00: 02:30 continues yesterday's key at N+1 (6, 7), 04:30 continues today's at k+1 (4, 5)", up.slice(8).map((d) => `${d.key}:${d.seq}`).join() === "token-20200309:6,token-20200309:7,token-20200310:4,token-20200310:5");
  check("00:00 -> 04:00: the per-key seq strictly rises, no (key, seq) twice", risesPerKey(up));
  // 04:00 -> 00:00 changed at 02:00 on 2020-06-10 IST.
  const b0100 = ist("2020-06-09T19:30:00Z");
  const b0200 = ist("2020-06-09T20:30:00Z");
  const b0430 = ist("2020-06-09T23:00:00Z");
  const down = await draws("kot", [[b0100, RESET_4AM, 3], [b0200, 0, 2], [b0430, 0, 2]]);
  check("04:00 -> 00:00: after the change today's key starts fresh at 1, then 2, 3, 4", down.slice(3).map((d) => `${d.key}:${d.seq}`).join() === "kot-20200610:1,kot-20200610:2,kot-20200610:3,kot-20200610:4");
  check("04:00 -> 00:00: the per-key seq strictly rises, no (key, seq) twice", risesPerKey(down));
}

async function t6(check: Check): Promise<void> {
  console.log("T6 tokens off again - nothing new is drawn, older orders keep theirs");
  await setSettings({ tokenEnabled: false, numberResetMinutes: 0 });
  const key = `token-${slipDayKey(new Date())}`;
  const before = await seqOf(key);
  const docs = await tokenDocs();
  const r = await create();
  check("201, no tokenNumber in the answer or the raw doc", r.status === 201 && r.body.data?.tokenNumber === undefined && !(await rawHasToken(String(r.body.data?._id))));
  check("the token counter and the token-* document set are unchanged", (await seqOf(key)) === before && (await tokenDocs()) === docs);
  check("the T2 orders keep their tokens", (await tokenOf(tokensT2.hold1 ?? "")) === TOKEN_START && (await tokenOf(tokensT2.payNow ?? "")) === TOKEN_START + 2);
}

export async function runTokenLegs(check: Check): Promise<void> {
  routes = {
    create: await import("@/app/api/orders/route"),
    settle: await import("@/app/api/orders/[id]/settle/route"),
    items: await import("@/app/api/orders/[id]/items/route"),
    voidItem: await import("@/app/api/orders/[id]/items/void/route"),
  };
  await t1(check);
  await t2(check);
  await t3(check);
  await t4(check);
  await t5(check);
  await t6(check);
}
