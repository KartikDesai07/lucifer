/**
 * Smooth-writes Slice B live leg — safe re-taps (F5 idemKey). Drives the REAL
 * route handlers (POST /api/orders, POST /api/orders/[id]/items) against a
 * real mongod. Only `@/lib/auth` is swapped for a signed-in stub (seeded into
 * the CJS module cache before any route loads — a node script has no request
 * scope for Auth.js). Proves: one order / one round / one set of numbers per
 * key, sequential AND overlapping; mismatch and cancel refusals; the unique
 * partial index on real mongod, built by the route's own targeted ensure (the
 * resettable one findCreateReplay runs) — never by an explicit createIndexes()
 * here — and a failed ensure that never 500s a create; a Pay Now sale read
 * before its bill number is stored answers 503 while young (never an
 * unnumbered 200) and is numbered by the replay once past the settle window.
 *
 *   node --import tsx scripts/verify-order-idem-live.ts
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_order_idem node --import tsx scripts/verify-order-idem-live.ts
 *
 * SAFETY: refuses any database whose name lacks the scratch prefix, and drops
 * the whole scratch database at start and end. (console output is intentional
 * — this is an ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
// None of these reach @/lib/api-helpers (the only importer of @/lib/auth);
// the routes that do are imported in main(), after the stub is in place.
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Counter, slipCounterKey } from "@/models/Counter";
import { Customer } from "@/models/Customer";
import { Product } from "@/models/Product";
import { Settings } from "@/models/Settings";
import { invalidateSettingsCache } from "@/lib/settings";
import { BILL_NUMBER_PENDING_ERROR, BILL_NUMBER_SETTLE_MS, isIdemKeyDuplicate } from "@/lib/order-idem";
import { isDuplicateKeyError } from "@pos/shared/api";
import { IDEM_KEY_MISMATCH_ERROR, IDEM_REPLAY_CANCELLED_ERROR } from "@pos/shared/order-idem";
import { LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}order_idem`;
const STAFF_ID = "665f0000000000000000beef";
const IDEM_INDEX = "idemKey_unique_partial";
const PENDING_STATUS = 503;
/** How far past the settle window an "old" sale is aged. */
const AGE_MARGIN_MS = 1000;

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
let createRoute: typeof import("@/app/api/orders/route");
let itemsRoute: typeof import("@/app/api/orders/[id]/items/route");

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
}

type OrderBody = { _id: string; kotRounds?: number; kotIdemKeys?: string[]; billNumber?: number; kotNumbers?: number[] };
type Reply = { status: number; body: { success: boolean; data?: OrderBody; error?: string } };
const TEA = "665f000000000000000000a1";
const CAKE = "665f000000000000000000a2";
const REWARD_AT = 8;
const line = (productId: string, qty = 1, extra: Record<string, unknown> = {}) => ({ productId, name: "Line", price: 100, qty, ...extra });

function post(url: string, body: unknown): Request {
  return new Request(`http://live.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function create(extra: Record<string, unknown>): Promise<Reply> {
  const payload = { customerName: "Idem leg", items: [line(TEA)], subtotal: 100, total: 100, payment: "Unpaid", status: "Pending", receiver: "Live leg", ...extra };
  const res = await createRoute.POST(post("/api/orders", payload));
  return { status: res.status, body: (await res.json()) as Reply["body"] };
}
async function round(id: string, items: unknown[], idemKey?: string): Promise<Reply> {
  const res = await itemsRoute.POST(post(`/api/orders/${id}/items`, { items, ...(idemKey ? { idemKey } : {}) }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Reply["body"] };
}
const seqOf = async (key: string) => ((await Counter.findById(key).lean())?.seq as number | undefined) ?? 0;
const today = () => slipCounterKey("kot", new Date()).slice("kot-".length);
const counters = async () => ({ order: await seqOf(`order-${today()}`), kot: await seqOf(`kot-${today()}`), bill: await seqOf(`bill-${today()}`) });
const byKey = (key: string) => Order.countDocuments({ idemKey: key });

async function leg1(): Promise<void> {
  console.log("L1 — the unique partial index, built by the real route's own ensure (no createIndexes); a failed ensure never wedges");
  // The model's own autoIndex pass (started by connectDB) settles first, so
  // from here on only the route's ensure can build the index. Then the index
  // is swapped for a same-name, different-spec one — the unrelated index
  // conflict a production collection could hold — so the ensure must fail.
  await Order.init();
  await Order.collection.dropIndex(IDEM_INDEX);
  await Order.collection.createIndex({ idemKey: 1 }, { name: IDEM_INDEX });
  const blocked = await create({ idemKey: randomUUID() });
  const stillBlocked = (await Order.collection.indexes()).find((i) => i.name === IDEM_INDEX);
  check("with the ensure failing on a conflicting index, a keyed create still lands (201, not 500)", blocked.status === 201 && stillBlocked?.unique !== true);
  await Order.collection.dropIndex(IDEM_INDEX);
  const first = await create({ idemKey: randomUUID() });
  check("the next keyed create lands (201): the failed ensure was not memoized, it ran again", first.status === 201);
  const idx = (await Order.collection.indexes()).find((i) => i.name === IDEM_INDEX);
  check(
    "getIndexes() has idemKey_unique_partial: { idemKey: 1 }, unique, partial on $exists, not sparse",
    idx?.unique === true && idx.sparse !== true &&
      JSON.stringify(idx.key) === JSON.stringify({ idemKey: 1 }) &&
      JSON.stringify(idx.partialFilterExpression) === JSON.stringify({ idemKey: { $exists: true } }),
  );
  const base = { customerName: "Index leg", items: [line(TEA)], subtotal: 100, total: 100, paidAmount: 0, payment: "Unpaid", receiver: "x" };
  await Order.create({ ...base, orderId: "IDX-1" });
  await Order.create({ ...base, orderId: "IDX-2" });
  check("two keyless orders coexist", (await Order.countDocuments({ orderId: /^IDX-/ })) === 2);
  const key = randomUUID();
  await Order.create({ ...base, orderId: "IDX-3", idemKey: key });
  const same = await Order.create({ ...base, orderId: "IDX-4", idemKey: key }).then(() => null, (e: unknown) => e);
  const dupId = await Order.create({ ...base, orderId: "IDX-1" }).then(() => null, (e: unknown) => e);
  check("same key → E11000 that isIdemKeyDuplicate names", isDuplicateKeyError(same) && isIdemKeyDuplicate(same));
  check("an orderId collision is a duplicate but NOT an idemKey one", isDuplicateKeyError(dupId) && !isIdemKeyDuplicate(dupId));
  check("the stored doc really carries the key (not stripped)", (await Order.findOne({ orderId: "IDX-3" }).lean())?.idemKey === key);
}

async function leg2(): Promise<string> {
  console.log("L2 — sequential re-send of a create: one order, numbers once");
  const key = randomUUID();
  const before = await counters();
  const first = await create({ idemKey: key });
  const again = await create({ idemKey: key });
  const after = await counters();
  check("201 then 200 with the same order", first.status === 201 && again.status === 200 && again.body.data?._id === first.body.data?._id);
  check("one order; order/KOT counters +1 once; no bill number for a tab", (await byKey(key)) === 1 && after.order - before.order === 1 && after.kot - before.kot === 1 && after.bill === before.bill);
  const payKey = randomUUID();
  const b2 = await counters();
  const pay1 = await create({ idemKey: payKey, payment: "Cash", status: "Completed" });
  const pay2 = await create({ idemKey: payKey, payment: "Cash", status: "Completed" });
  const a2 = await counters();
  check("Pay Now re-send: one order, bill +1, the replay carries the same bill number", (await byKey(payKey)) === 1 && a2.bill - b2.bill === 1 && pay2.body.data?.billNumber === pay1.body.data?.billNumber && pay1.body.data?.billNumber === a2.bill);
  return String(first.body.data?._id);
}

async function leg3(): Promise<void> {
  console.log("L3 — overlapping creates with one key: one order, the losers' claims come back");
  for (const status of ["Pending", "Completed"] as const) {
    const cust = await Customer.create({ name: `Overlap ${status}`, mobile: status === "Pending" ? "9876511111" : "9876522222", stamps: 30 });
    const key = randomUUID();
    const before = await counters();
    const payload = { idemKey: key, customerId: String(cust._id), rewardAt: REWARD_AT, ...(status === "Completed" ? { payment: "Cash", status } : {}) };
    const replies = await Promise.all([create(payload), create(payload), create(payload)]);
    const numbered = status === "Completed";
    const oks = replies.filter((r) => r.status === 201 || r.status === 200);
    const pending = replies.filter((r) => r.status === PENDING_STATUS);
    const ids = new Set(oks.map((r) => r.body.data?._id));
    const diner = await Customer.findById(cust._id).select("+redeemedOrders +returnedOrders stamps").lean();
    const stored = await Order.findOne({ idemKey: key }).lean();
    const won = stored?.orderId ?? "";
    const spent = diner?.redeemedOrders ?? [];
    const back = diner?.returnedOrders ?? [];
    const losersReturned = spent.filter((o) => o !== won).every((o) => back.includes(o));
    check(`${status}: the replies that succeed all carry the SAME order, and one order exists`, oks.length >= 1 && ids.size === 1 && (await byKey(key)) === 1);
    if (numbered) {
      console.log(`       (${pending.length} of 3 overlapping replies read the sale before its number: 503)`);
      check(
        `${status}: EVERY reply either carries the stored bill number or is the 503 with the plain copy — never a 200 without it`,
        stored?.billNumber !== undefined &&
          oks.every((r) => r.body.data?.billNumber === stored.billNumber) &&
          pending.every((r) => r.body.success === false && r.body.error === BILL_NUMBER_PENDING_ERROR) &&
          oks.length + pending.length === replies.length,
      );
    } else {
      check(`${status}: a tab has no bill number by design — every reply succeeds`, oks.length === replies.length);
    }
    const again = await create(payload);
    const after = await counters();
    check(
      `${status}: a follow-up same-key Send gets the stored order (200)${numbered ? " WITH its bill number" : ""}, drawing nothing`,
      again.status === 200 && again.body.data?._id === String(stored?._id) &&
        again.body.data?.billNumber === stored?.billNumber && (!numbered || again.body.data?.billNumber !== undefined),
    );
    check(`${status}: stamps spent once (30 → 22): the winner's spend stands, every loser's spend was returned`, diner?.stamps === 30 - REWARD_AT && spent.includes(won) && !back.includes(won) && losersReturned);
    const billOk = status === "Completed" ? after.bill - before.bill === 1 : after.bill === before.bill;
    console.log(`       (KOT counter moved +${after.kot - before.kot}: a loser that drew its ticket before losing is an accepted burn)`);
    check(`${status}: bill counter ${status === "Completed" ? "+1 exactly (M2: only the insert winner numbers)" : "unchanged"}`, billOk);
  }
}

async function leg3b(): Promise<void> {
  console.log("L3b — a Pay Now sale read in the gap before its bill number is stored (the gap held open)");
  const key = randomUUID();
  const payload = { idemKey: key, payment: "Cash", status: "Completed" };
  const landed = await create(payload);
  const billNumber = landed.body.data?.billNumber;
  check("landmark: the sale lands numbered (201)", landed.status === 201 && billNumber !== undefined);
  // The window between the winner's insert and its guarded number set.
  await Order.updateOne({ idemKey: key }, { $unset: { billNumber: "" } });
  const bill0 = (await counters()).bill;
  const inGap = await create(payload);
  check(
    "a same-key Send in the gap answers 503 with the plain copy (never a 200 without the number), drawing nothing",
    inGap.status === PENDING_STATUS && inGap.body.success === false && inGap.body.error === BILL_NUMBER_PENDING_ERROR && (await counters()).bill === bill0,
  );
  await Order.updateOne({ idemKey: key }, { $set: { billNumber } });
  const numbered = await create(payload);
  check("once the number is stored, Send again gets the numbered order (200)", numbered.status === 200 && numbered.body.data?.billNumber === billNumber && numbered.body.data?._id === landed.body.data?._id);
  // A cafe that does not number its bills has no gap to wait out.
  await Settings.updateOne({}, { $set: { billShowNumber: false } });
  invalidateSettingsCache();
  await Order.updateOne({ idemKey: key }, { $unset: { billNumber: "" } });
  try {
    const unnumbered = await create(payload);
    check("bill numbering OFF: the same unnumbered sale replays as 200", unnumbered.status === 200 && unnumbered.body.data?.billNumber === undefined);
  } finally {
    await Settings.updateOne({}, { $set: { billShowNumber: true } });
    invalidateSettingsCache();
    await Order.updateOne({ idemKey: key }, { $set: { billNumber } });
  }
  // An OLD unnumbered sale (its winner's numbering failed, or it predates
  // numbering being switched on): past the settle window the replay numbers
  // it. Aged over the raw collection — Mongoose drops a $set of the immutable
  // createdAt without a word.
  await Order.collection.updateOne(
    { idemKey: key },
    { $unset: { billNumber: "" }, $set: { createdAt: new Date(Date.now() - BILL_NUMBER_SETTLE_MS - AGE_MARGIN_MS) } },
  );
  const billBefore = (await counters()).bill;
  const finished = await create(payload);
  const billAfter = (await counters()).bill;
  const storedNow = (await Order.findOne({ idemKey: key }).lean())?.billNumber;
  check(
    "an OLD unnumbered sale: the replay issues the NEXT bill number (counter +1 exactly) and answers 200 with it",
    finished.status === 200 && billAfter - billBefore === 1 && finished.body.data?.billNumber === billAfter &&
      storedNow === billAfter && finished.body.data?._id === landed.body.data?._id,
  );
  const again = await create(payload);
  check(
    "a second replay draws nothing: the same number, the counter unchanged",
    again.status === 200 && again.body.data?.billNumber === billAfter && (await counters()).bill === billAfter,
  );
}

async function leg4to9(tabId: string): Promise<void> {
  console.log("L4 — sequential re-send of a round");
  const k2 = randomUUID();
  const kot0 = (await counters()).kot;
  const r2 = await round(tabId, [line(CAKE, 2)], k2);
  const kot1 = (await counters()).kot;
  const r2b = await round(tabId, [line(CAKE, 2)], k2);
  const tab2 = await Order.findById(tabId).lean();
  check("round 2 lands: kotRounds 2, two ticket slots, kotIdemKeys[1] = key", r2.status === 200 && tab2?.kotRounds === 2 && tab2.kotNumbers?.length === 2 && tab2.kotIdemKeys?.[1] === k2);
  check("the re-send replays (200), writes nothing, draws no ticket", r2b.status === 200 && r2b.body.data?.kotRounds === 2 && (await counters()).kot === kot1 && kot1 - kot0 === 1 && tab2?.items.length === 2);

  console.log("L5 — overlapping sends of one round");
  const k3 = randomUUID();
  const beforeKot = (await counters()).kot;
  const overlap = await Promise.all([1, 2, 3].map(() => round(tabId, [line(TEA, 3)], k3)));
  const tab3 = await Order.findById(tabId).lean();
  check("all three answer 200 with round 3; the round landed ONCE", overlap.every((r) => r.status === 200 && r.body.data?.kotRounds === 3) && tab3?.kotRounds === 3 && tab3.items.filter((i) => i.kotRound === 3).length === 1);
  console.log(`       (KOT counter moved +${(await counters()).kot - beforeKot}: tickets drawn before a lost CAS are the accepted burn)`);

  console.log("L6 — a keyless round after a keyed one; the keyed re-send still replays its own round");
  const plain = await round(tabId, [line(TEA, 1)]);
  const late = await round(tabId, [line(CAKE, 2)], k2);
  check("keyless round 4 lands; re-sending round 2's key replays (kotRounds stays 4)", plain.status === 200 && late.status === 200 && late.body.data?.kotRounds === 4 && late.body.data?.kotIdemKeys?.[1] === k2);

  console.log("L7 — a void between landing and the re-send is still the same round");
  await Order.updateOne(
    { _id: tabId },
    { $pull: { items: { kotRound: 2 } }, $push: { voids: { productId: CAKE, name: "Line", price: 100, qty: 2, kotRound: 2, reason: "live leg", voidedBy: "Live leg", at: new Date() } } },
  );
  const voided = await round(tabId, [line(CAKE, 2)], k2);
  check("replay (200), no new round", voided.status === 200 && voided.body.data?.kotRounds === 4);

  console.log("L8 — a mismatched re-send is refused, nothing written");
  const stamp = (await Order.findById(tabId).lean())?.updatedAt?.getTime();
  const wrong = await round(tabId, [line(CAKE, 5)], k2);
  check("409 with the mismatch copy; the tab is untouched", wrong.status === 409 && wrong.body.error === IDEM_KEY_MISMATCH_ERROR && (await Order.findById(tabId).lean())?.updatedAt?.getTime() === stamp);

  console.log("L9 — a cancelled order refuses the replay");
  await Order.updateOne({ _id: tabId }, { $set: { status: "Cancelled" } });
  const gone = await round(tabId, [line(TEA, 3)], k3);
  const tabKey = (await Order.findById(tabId).lean())?.idemKey ?? "";
  const goneCreate = await create({ idemKey: tabKey });
  check("round and create re-sends both 409 with the cancelled copy", gone.status === 409 && gone.body.error === IDEM_REPLAY_CANCELLED_ERROR && goneCreate.status === 409 && goneCreate.body.error === IDEM_REPLAY_CANCELLED_ERROR);
}

async function legM7(): Promise<void> {
  console.log("M7 — a landed round replays even after its product lost the variation");
  const product = await Product.create({ name: "Latte", categoryId: new mongoose.Types.ObjectId(), price: 100, variations: [{ name: "Large", price: 150 }] });
  const pid = String(product._id);
  const tab = await create({});
  const id = String(tab.body.data?._id);
  const key = randomUUID();
  // B2: a sized line bills at the size's price (Large 150) under the product's
  // own name — the plain `line()` defaults (100, "Line") would be refused.
  const sized = [line(pid, 1, { variation: "Large", price: 150, name: "Latte" })];
  const landed = await round(id, sized, key);
  await Product.updateOne({ _id: pid }, { $set: { variations: [{ name: "Small", price: 90 }] } });
  const replay = await round(id, sized, key);
  const fresh = await round(id, sized, randomUUID());
  check("same key → 200 replay; a NEW key with the same lines → the variation 400", landed.status === 200 && replay.status === 200 && replay.body.data?.kotRounds === 2 && fresh.status === 400);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) throw new Error(`Refusing to run against "${dbName}" — scratch (${SCRATCH_PREFIX}*) databases only.`);
  process.env.MONGODB_URI = uri;
  // Dropped over a SEPARATE connection, BEFORE connectDB(): Order's init()
  // (autoIndex, memoized per process) must be the first index build this
  // process runs, against an orders collection that no longer exists. A drop
  // after connectDB() could land after that one build and leave the other
  // indexes absent for the rest of the run. L1 then proves the route's own
  // idemKey ensure, so nothing here calls Order.createIndexes().
  const scratch = await mongoose.createConnection(uri).asPromise();
  try {
    await scratch.dropDatabase();
    const left = await scratch.db?.listCollections({ name: Order.collection.collectionName }).toArray();
    if (left === undefined || left.length > 0) throw new Error("the scratch orders collection survived the drop");
  } finally {
    await scratch.close();
  }
  createRoute = await import("@/app/api/orders/route");
  itemsRoute = await import("@/app/api/orders/[id]/items/route");
  await connectDB();
  await Customer.createIndexes();
  await Settings.create({
    billShowNumber: true, billNumberStart: 1, kotShowNumber: true, kotNumberStart: 1,
    dinerAccountsEnabled: true, loyaltyEnabled: true, loyaltyMinBill: 0,
    loyaltyRules: { v: LOYALTY_RULES_SCHEMA_VERSION, milestones: [{ at: REWARD_AT, kind: "flat", value: 20, qty: 1 }] },
  });
  invalidateSettingsCache();
  // Menu B2: the order routes refuse (409) a NEW line whose product is missing,
  // archived, out of stock, priced or named differently from the menu. Every
  // line this leg sends is `line()` — name "Line", price 100 — so the two shared
  // products carry exactly that name and base price (no discount, no sizes).
  const categoryId = new mongoose.Types.ObjectId();
  await Product.create([TEA, CAKE].map((_id) => ({ _id, name: "Line", categoryId, price: 100 })));
  console.log(`\nSlice B order idempotency — live against ${dbName}\n`);
  try {
    await leg1();
    const tabId = await leg2();
    await leg3();
    await leg3b();
    await leg4to9(tabId);
    await legM7();
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
