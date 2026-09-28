/**
 * Smooth-writes Slice B live leg — bill numbers never skip. Drives the REAL
 * route handlers (POST /api/orders, POST /api/orders/[id]/settle) against a
 * real mongod. Only `@/lib/auth` is swapped for a signed-in stub (seeded into
 * the CJS module cache before any route loads — a node script has no request
 * scope for Auth.js), so every leg runs the routes' exact validators, reads,
 * refusals, CAS and numbering.
 *
 *   node --import tsx scripts/verify-slip-numbers-live.ts
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_slip_numbers node --import tsx scripts/verify-slip-numbers-live.ts
 *
 * SAFETY: refuses any database whose name lacks the scratch prefix, and drops
 * the whole scratch database at start and end. (console output is intentional
 * — this is an ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import mongoose from "mongoose";
// None of these reach @/lib/api-helpers (the only importer of @/lib/auth);
// the routes that do are imported in main(), after the stub is in place.
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Counter, nextSlipSequence, slipCounterKey } from "@/models/Counter";
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import { Settings } from "@/models/Settings";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";
import { printedSlipNumber } from "@/lib/print";
import { issueBillNumber, SLIP_NUMBER_DEPS } from "@/lib/slip-numbers";
import { runSettleFollowUps, SETTLE_FOLLOW_UP_DEPS } from "@/lib/settle-followups";
import { claimPromoRedemption, PROMO_USED_ERROR } from "@/lib/order-request-accept-promo";
import { LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";
import { generateOrderId } from "@pos/shared/utils";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}slip_numbers`;
const STAFF_ID = "665f0000000000000000beef";

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
type CreateRoute = typeof import("@/app/api/orders/route");
type SettleRoute = typeof import("@/app/api/orders/[id]/settle/route");
let createRoute: CreateRoute;
let settleRoute: SettleRoute;

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
}

type Body = { success: boolean; data?: { _id: string; billNumber?: number; kotNumbers?: number[] }; error?: string };
const PRODUCT = "665f000000000000000000a1";
const PRICE = 120;
const REWARD_AT = 8;
const REWARD_CODE = "LIVEBILL";
const ONCE_CODE = "ONCE10";
const PAST = new Date("2020-01-15T06:00:00Z");
const excluded = new Set<string>(); // fixtures whose number came from elsewhere

function post(url: string, body: unknown): Request {
  return new Request(`http://live.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function create(extra: Record<string, unknown> = {}): Promise<{ status: number; body: Body }> {
  const payload = { customerName: "Slip leg", items: [{ productId: PRODUCT, name: "Tea", price: PRICE, qty: 1 }], subtotal: PRICE, total: PRICE, payment: "Unpaid", status: "Pending", receiver: "Live leg", ...extra };
  const res = await createRoute.POST(post("/api/orders", payload));
  return { status: res.status, body: (await res.json()) as Body };
}
async function settle(id: string, body: Record<string, unknown>): Promise<{ status: number; body: Body }> {
  const res = await settleRoute.POST(post(`/api/orders/${id}/settle`, body), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Body };
}
const seqOf = async (key: string) => ((await Counter.findById(key).lean())?.seq as number | undefined) ?? 0;
const billKey = () => slipCounterKey("bill", new Date());
const kotKey = () => slipCounterKey("kot", new Date());
async function openTab(): Promise<string> {
  const r = await create();
  if (r.status !== 201 || !r.body.data) throw new Error(`fixture tab failed: ${r.status} ${r.body.error}`);
  return String(r.body.data._id);
}

async function leg1(): Promise<void> {
  console.log("L1 control — the OLD shape (number, then CAS) burns a number on mongod");
  const id = await openTab();
  excluded.add(id);
  const old = await Order.findById(id).lean();
  const oldShape = async () => {
    const n = printedSlipNumber(await nextSlipSequence("bill", null, PAST), 1);
    return Order.findOneAndUpdate({ _id: id, status: "Pending", total: old!.total }, { $set: { status: "Completed", billNumber: n } }, { new: true }).lean();
  };
  const results = await Promise.all([oldShape(), oldShape()]);
  const pastKey = slipCounterKey("bill", PAST);
  check("two overlapping old-shape settles: counter 2, exactly one winner — a skipped number", (await seqOf(pastKey)) === 2 && results.filter(Boolean).length === 1);
}

async function overlappingSettles(n: number): Promise<void> {
  const id = await openTab();
  const tab = await Order.findById(id).lean();
  const before = await seqOf(billKey());
  const results = await Promise.all(Array.from({ length: n }, () => settle(id, { payment: "Cash", expectedTotal: tab!.total })));
  const winners = results.filter((r) => r.status === 200);
  const after = await seqOf(billKey());
  const stored = await Order.findById(id).lean();
  check(`L2 ${n} overlapping settles: one 200, ${n - 1} × 409`, winners.length === 1 && results.filter((r) => r.status === 409).length === n - 1);
  check(`L2 ${n}: bill counter +1 and the 200 carries that number`, after - before === 1 && winners[0]?.body.data?.billNumber === printedSlipNumber(after, 1));
  check(`L2 ${n}: the stored bill holds it, and no other order does`, stored?.billNumber === after && (await Order.countDocuments({ billNumber: after, _id: { $nin: [...excluded] } })) === 1);
}

async function leg3(): Promise<void> {
  console.log("L3 — refused settles take no number");
  const id = await openTab();
  const tab = await Order.findById(id).lean();
  const before = await seqOf(billKey());
  const stale = await settle(id, { payment: "Cash", expectedTotal: tab!.total + 1 });
  const due = await settle(id, { payment: "Due", expectedTotal: tab!.total });
  const done = await openTab();
  await settle(done, { payment: "Cash" });
  const mid = await seqOf(billKey());
  const again = await settle(done, { payment: "Cash" });
  const gone = await openTab();
  await Order.updateOne({ _id: gone }, { $set: { status: "Cancelled" } });
  const cancelled = await settle(gone, { payment: "Cash" });
  check("stale echo 409, Due-without-customer 400: counter unchanged", stale.status === 409 && due.status === 400 && mid - before === 1);
  check("re-settle of a Completed bill and a Cancelled tab: 409, counter unchanged", again.status === 409 && cancelled.status === 409 && (await seqOf(billKey())) === mid);
}

async function leg4(): Promise<void> {
  console.log("L4 — a set that commits then throws is retried with the SAME number");
  const id = await openTab();
  await Order.updateOne({ _id: id }, { $set: { status: "Completed", payment: "Cash" } });
  const before = await seqOf(billKey());
  let first = true;
  let reads = 0;
  const doc = await issueBillNumber(id, 1, {
    ...SLIP_NUMBER_DEPS,
    setIfAbsent: async (oid, n) => {
      const r = await SLIP_NUMBER_DEPS.setIfAbsent(oid, n);
      if (first) {
        first = false;
        throw new Error("socket closed after commit");
      }
      return r;
    },
    readOrder: async (oid) => {
      reads += 1;
      return SLIP_NUMBER_DEPS.readOrder(oid);
    },
  });
  const after = await seqOf(billKey());
  check("one number, counter +1, the retry adopted its own committed write IN the set ($or arm, no fallback read)", after - before === 1 && doc?.billNumber === after && reads === 0);
}

async function leg5(): Promise<void> {
  console.log("L5 — a tab already holding a number is never renumbered");
  const id = await openTab();
  excluded.add(id);
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { billNumber: 77, createdAt: PAST } });
  const before = await seqOf(billKey());
  const r = await settle(id, { payment: "Cash" });
  const miss = await SLIP_NUMBER_DEPS.setIfAbsent(id, 999);
  check("settle 200 keeps 77, counter unchanged; a guarded set with another n matches nothing", r.status === 200 && r.body.data?.billNumber === 77 && (await seqOf(billKey())) === before && miss === null);
}

async function leg6(): Promise<void> {
  console.log("L6 — Pay Now: refusals and a slip failure leave both counters unchanged");
  const cust = await Customer.create({ name: "Slip diner", mobile: "9876500001", stamps: 20 });
  const cid = String(cust._id);
  const counters = async () => [await seqOf(kotKey()), await seqOf(billKey())].join("/");
  const orders = () => Order.countDocuments({ customerName: "Slip leg" });
  const payNow = { payment: "Cash", status: "Completed" };
  let base = await counters();
  let count = await orders();
  const carrier = await create({ payment: "Due", status: "Completed" });
  check("carrier refusal 400: counters and orders unchanged", carrier.status === 400 && (await counters()) === base && (await orders()) === count);

  const nextSeq = (await seqOf(`order-${slipCounterKey("bill", new Date()).slice("bill-".length)}`)) + 1;
  await Customer.updateOne({ _id: cid }, { $push: { redeemedOrders: generateOrderId(nextSeq) } });
  const stamps = await create({ ...payNow, customerId: cid, rewardAt: REWARD_AT });
  check("stamps 409: counters unchanged, stamps untouched", stamps.status === 409 && stamps.body.error === "Not enough stamps for that reward" && (await counters()) === base && (await Customer.findById(cid).lean())?.stamps === 20);

  await claimPromoRedemption(ONCE_CODE, "9876500001", { kind: "order", id: "ORD-ELSEWHERE" });
  const promo = await create({ ...payNow, customerId: cid, promoCode: ONCE_CODE });
  check("promo 409: counters unchanged", promo.status === 409 && promo.body.error === PROMO_USED_ERROR && (await counters()) === base && (await orders()) === count);

  const kotSeq = await seqOf(kotKey());
  await Counter.collection.updateOne({ _id: kotKey() } as never, { $set: { seq: "jammed" } }, { upsert: true });
  const jam = await create({ ...payNow, customerId: cid, rewardAt: REWARD_AT });
  const diner = await Customer.findById(cid).lean();
  await Counter.collection.updateOne({ _id: kotKey() } as never, { $set: { seq: kotSeq } });
  check("KOT $inc throw: 500, no order, bill counter unchanged", jam.status === 500 && (await orders()) === count && (await counters()) === base);
  check("…and the undo returned the stamps AND the minted code (O10)", diner?.stamps === 20 && !(diner?.rewards ?? []).some((r) => r.code === REWARD_CODE));
  // Landmark: this rung really does mint the code on a claim that lands.
  const minted = await create({ ...payNow, customerId: cid, rewardAt: REWARD_AT });
  const holder = await Customer.findById(cid).lean();
  check("landmark: a landed reward claim spends 8 stamps and mints the rung's code", minted.status === 201 && holder?.stamps === 12 && (holder?.rewards ?? []).some((r) => r.code === REWARD_CODE));

  base = await counters();
  count = await orders();
  const ok = await create(payNow);
  const [kot, bill] = (await counters()).split("/").map(Number);
  check("happy Pay Now: 201, KOT +1 and bill +1, the order holds both", ok.status === 201 && `${kot - 1}/${bill - 1}` === base && ok.body.data?.billNumber === bill && ok.body.data?.kotNumbers?.[0] === kot && (await orders()) === count + 1);
}

async function leg7(): Promise<void> {
  console.log("L7 — follow-ups: a ledger throw still frees the table and grants the stamp");
  const cust = await Customer.create({ name: "Follow diner", mobile: "9876500002", stamps: 0 });
  await Table.create({ tableNo: "T-9", status: "Occupied", currentOrderId: "ORD-FOLLOW" });
  const tab = { orderId: "ORD-FOLLOW", customerId: String(cust._id), payment: "Unpaid" as const, total: 500, paidAmount: 0, status: "Pending" as const, tableNo: "T-9" };
  const settings = await getSettings();
  const out = await runSettleFollowUps(tab, { ...tab, payment: "Cash", paidAmount: 500, status: "Completed" }, settings, {
    ...SETTLE_FOLLOW_UP_DEPS,
    reconcileLedger: async () => {
      throw new Error("ledger down");
    },
  });
  const table = await Table.findOne({ tableNo: "T-9" }).lean();
  const diner = await Customer.findById(cust._id).lean();
  check("table Available, stamp granted, customers cache dropped", table?.status === "Available" && table.currentOrderId === "" && diner?.stamps === 1 && out.customersTouched);
}

async function endOfRun(): Promise<void> {
  const top = await seqOf(billKey());
  const held = await Order.find({ billNumber: { $exists: true }, _id: { $nin: [...excluded] } }).select("billNumber").lean();
  const numbers = held.map((o) => o.billNumber as number).sort((a, b) => a - b);
  const gapless = numbers.length === top && numbers.every((n, i) => n === i + 1);
  check(`end of run: today's bill counter ${top} == max bill number, every number 1..${top} held by exactly one order`, gapless);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) throw new Error(`Refusing to run against "${dbName}" — scratch (${SCRATCH_PREFIX}*) databases only.`);
  process.env.MONGODB_URI = uri;
  createRoute = await import("@/app/api/orders/route");
  settleRoute = await import("@/app/api/orders/[id]/settle/route");
  await connectDB();
  await mongoose.connection.dropDatabase();
  await Promise.all([Order.createIndexes(), Customer.createIndexes(), Table.createIndexes()]);
  await Settings.create({
    billShowNumber: true, billNumberStart: 1, kotShowNumber: true, kotNumberStart: 1,
    dinerAccountsEnabled: true, loyaltyEnabled: true, loyaltyMinBill: 0,
    loyaltyRules: { v: LOYALTY_RULES_SCHEMA_VERSION, milestones: [{ at: REWARD_AT, kind: "flat", value: 20, qty: 1, promoCode: REWARD_CODE }] },
    promoCodes: [{ code: REWARD_CODE, kind: "flat", value: 20, active: true }, { code: ONCE_CODE, kind: "flat", value: 10, active: true, oncePerCustomer: true }],
  });
  invalidateSettingsCache();
  console.log(`\nSlice B slip numbers — live against ${dbName}\n`);
  try {
    await leg1();
    console.log("L2 — overlapping settles through the real route");
    await overlappingSettles(2);
    await overlappingSettles(5);
    await leg3();
    await leg4();
    await leg5();
    await leg6();
    await leg7();
    await endOfRun();
  } finally {
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
