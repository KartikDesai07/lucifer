/**
 * CB-7 S2 live leg - proves the DB-truth the DB-free tests cannot, for "one counted bill moves one diner one step":
 *   the REAL advanceRewardProgress (REWARD_PROGRESS_DEPS, env: {}) against Mongo, then the REAL runSettleFollowUps
 *   and runCreateFollowUps with their real deps (the only thing not exercised is bill-number issuing: an empty
 *   numbering plan never calls issueBillNumbers, and no table / promo is involved), and the PIN-set / staff-reset
 *   UPDATE SHAPES of the two PIN routes (copied here, each pinned to the route SOURCE so a drift fails the leg).
 *   The blob is written straight into Settings (enabled:true) - the WRITE gate's launch lock is bypassed on purpose.
 *
 *   npm run verify:reward-progress:live          (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reward_progress npm run verify:reward-progress:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the scratch prefix, and drops that whole
 * scratch database in `finally`. (console output is intentional - this is an ops CLI script, not app code.)
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import { advanceRewardProgress } from "@/lib/reward-progress";
import { runSettleFollowUps, SETTLE_FOLLOW_UP_DEPS, type SettledTab } from "@/lib/settle-followups";
import { runCreateFollowUps, CREATE_FOLLOW_UP_DEPS } from "@/lib/order-create-followups";
import { grantStampForSettledOrder } from "@/lib/diner-loyalty-earn";
import { reconcileLedger } from "@/lib/order";
import { REWARD_PROGRESS_DEPS } from "@/lib/reward-progress";
import { SCRATCH_BLOCK_ENV_VAR } from "@pos/shared/reward-levels";
import {
  BLOB, CLEAN_ENV, DEPS, L1_SIZE, L2_SIZE, T0, after, orderAt, rawOf, cardsOf, writeSettings,
  assertRouteShapes, barrierDeps, pinSetLikeRoute, resetLikeRoute, type Rec,
} from "./reward-progress-live-kit";
import { newCustomer } from "./reward-levels-live-kit";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reward_progress`;
const HUNDRED = 100;
const FAR_STEP = 101;

let passed = 0;
let failed = 0;

async function scenario(id: string, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${id}. ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${id}. ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

const idOf = (id: mongoose.Types.ObjectId): string => String(id);
// A customer holding a stored anchor, optionally already `steps` deep in the ladder.
const anchored = (steps?: number, extra: Rec = {}) => newCustomer(undefined, { rewardsAnchorAt: T0, ...(steps === undefined ? {} : { cardSteps: steps }), ...extra });

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" - the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }
  assertRouteShapes();
  process.env.MONGODB_URI = uri;
  await connectDB();
  await Customer.init();

  try {
    let settings = await writeSettings(BLOB);
    const advance = (id: mongoose.Types.ObjectId, order: ReturnType<typeof orderAt>) => advanceRewardProgress(settings, idOf(id), order, DEPS);

    await scenario("a", "PIN set writes the anchor with $min; a re-set after a reset keeps the FIRST anchor (pinSetAt moves, the anchor does not)", async () => {
      await Customer.deleteMany({});
      const id = await newCustomer();
      const mobile = String((await rawOf(id)).mobile);
      const first = after(T0, 5);
      assert.equal(await pinSetLikeRoute(mobile, first), true, "the first set claims the account");
      let raw = await rawOf(id);
      assert.deepEqual(raw.rewardsAnchorAt, first, "the anchor was written by the SAME update as the hash");
      assert.deepEqual(raw.pinSetAt, first);
      assert.ok("pinHash" in raw, "landmark: the hash landed");
      assert.equal(await pinSetLikeRoute(mobile, after(first, 1)), false, "a second set on a held PIN claims nothing");
      await resetLikeRoute(id);
      raw = await rawOf(id);
      assert.ok(!("pinHash" in raw) && !("pinSetAt" in raw), "landmark: the reset cleared the PIN");
      assert.deepEqual(raw.rewardsAnchorAt, first, "the anchor survived the reset");
      const later = after(first, 600);
      assert.equal(await pinSetLikeRoute(mobile, later), true, "re-set after the reset");
      raw = await rawOf(id);
      assert.deepEqual(raw.pinSetAt, later, "pinSetAt moved to the second set");
      assert.deepEqual(raw.rewardsAnchorAt, first, "$min kept the first anchor");
    });

    await scenario("b", "reset on a PIN holder with no anchor copies pinSetAt into it, then the $unset leaves the anchor; a customer with no PIN gets none", async () => {
      await Customer.deleteMany({});
      const pinAt = after(T0, -2880);
      const holder = await newCustomer(undefined, { pinHash: "x", pinSetAt: pinAt });
      await resetLikeRoute(holder);
      const raw = await rawOf(holder);
      assert.deepEqual(raw.rewardsAnchorAt, pinAt, "the anchor is the PIN date");
      assert.ok(!("pinHash" in raw) && !("pinSetAt" in raw), "and the PIN really was unset after the copy");
      const bare = await newCustomer();
      await resetLikeRoute(bare);
      assert.ok(!("rewardsAnchorAt" in (await rawOf(bare))), "no PIN, no anchor from a reset");
      const done = await anchored();
      await Customer.updateOne({ _id: done }, { $set: { pinHash: "y", pinSetAt: after(T0, 99) } });
      await resetLikeRoute(done);
      assert.deepEqual((await rawOf(done)).rewardsAnchorAt, T0, "an already-anchored diner's anchor is not overwritten by the copy");
    });

    await scenario("c", "no anchor + no PIN -> not-anchored; nothing is written (the whole document is byte-for-byte unchanged)", async () => {
      await Customer.deleteMany({});
      const id = await newCustomer();
      const before = await rawOf(id);
      assert.deepEqual(await advance(id, orderAt(after(T0, 10))), { counted: false, reason: "not-anchored" });
      assert.deepEqual(await rawOf(id), before);
    });

    await scenario("d", "a PIN holder with no anchor is lazily anchored at pinSetAt and counted", async () => {
      await Customer.deleteMany({});
      const pinAt = after(T0, -2880);
      const id = await newCustomer(undefined, { pinHash: "x", pinSetAt: pinAt });
      const order = orderAt(after(pinAt, 30));
      assert.deepEqual(await advance(id, order), { counted: true, cardIssued: true });
      const raw = await rawOf(id);
      assert.deepEqual(raw.rewardsAnchorAt, pinAt, "$min wrote the lazy anchor = the PIN date");
      assert.equal(raw.cardSteps, 1);
      assert.deepEqual(raw.cardStepOrders, [order.orderId]);
    });

    await scenario("e", "a bill created before the anchor is not counted - by the pre-read, and by the CAS filter when the pre-read is stale", async () => {
      await Customer.deleteMany({});
      const id = await anchored();
      const before = await rawOf(id);
      assert.deepEqual(await advance(id, orderAt(after(T0, -1))), { counted: false, reason: "before-anchor" });
      assert.deepEqual(await rawOf(id), before, "nothing written");
      assert.deepEqual(await advance(id, orderAt(T0)), { counted: true, cardIssued: true }, "the equal instant counts");
      // The filter alone: a pre-read that LIES (an older anchor) cannot get a pre-anchor bill past the database.
      const lateAnchor = await newCustomer(undefined, { rewardsAnchorAt: after(T0, 60) });
      const stale = { ...DEPS, readProgress: (() => {
        let calls = 0;
        return async (cid: string) => (++calls === 1 ? { rewardsAnchorAt: T0 } : REWARD_PROGRESS_DEPS.readProgress(cid));
      })() };
      const res = await advanceRewardProgress(settings, idOf(lateAnchor), orderAt(after(T0, 5)), stale);
      assert.deepEqual(res, { counted: false, reason: "before-anchor" }, "the filter missed, the re-read classified it");
      assert.ok(!("cardSteps" in (await rawOf(lateAnchor))), "and the counter never moved");
    });

    await scenario("f", "the same order twice = one step (the second answers already-counted); one marker, one card", async () => {
      await Customer.deleteMany({});
      const id = await anchored();
      const order = orderAt(after(T0, 3));
      assert.deepEqual(await advance(id, order), { counted: true, cardIssued: true });
      assert.deepEqual(await advance(id, order), { counted: false, reason: "already-counted" });
      const raw = await rawOf(id);
      assert.equal(raw.cardSteps, 1);
      assert.deepEqual(raw.cardStepOrders, [order.orderId]);
      assert.equal((await cardsOf(id)).length, 1);
    });

    await scenario("g", "two DIFFERENT orders racing on one diner (barrier: both read the same counter) = cardSteps 2, one card per step, step:1 / step:2", async () => {
      await Customer.deleteMany({});
      const id = await anchored();
      const { deps, reads, writes } = barrierDeps(2);
      const [o1, o2] = [orderAt(after(T0, 3)), orderAt(after(T0, 4))];
      const results = await Promise.all([advanceRewardProgress(settings, idOf(id), o1, deps), advanceRewardProgress(settings, idOf(id), o2, deps)]);
      assert.deepEqual(results, [{ counted: true, cardIssued: true }, { counted: true, cardIssued: true }], "both counted");
      assert.equal(reads(), 3, "contention really happened: the loser re-read once");
      assert.equal(writes(), 3, "two winners and one lost write");
      const raw = await rawOf(id);
      assert.equal(raw.cardSteps, 2);
      assert.deepEqual([...(raw.cardStepOrders as string[])].sort(), [o1.orderId, o2.orderId].sort());
      const cards = await cardsOf(id);
      assert.deepEqual(cards.map((c) => c.issueKey).sort(), ["step:1", "step:2"], "exactly one card per lifetime step");
      assert.equal(new Set(cards.map((c) => c.id)).size, 2, "distinct card ids");
    });

    await scenario("g2", "three orders racing = cardSteps 3, three distinct issueKeys, all counted (within the CAS attempt budget)", async () => {
      await Customer.deleteMany({});
      const id = await anchored();
      const { deps } = barrierDeps(3);
      const orders = [orderAt(after(T0, 3)), orderAt(after(T0, 4)), orderAt(after(T0, 5))];
      const results = await Promise.all(orders.map((o) => advanceRewardProgress(settings, idOf(id), o, deps)));
      assert.ok(results.every((r) => r.counted), `all counted: ${JSON.stringify(results)}`);
      assert.equal((await rawOf(id)).cardSteps, 3);
      assert.deepEqual((await cardsOf(id)).map((c) => c.issueKey).sort(), ["step:1", "step:2", "step:3"]);
    });

    await scenario("h", "a config edit after a card is issued leaves the issued card deepEqual (the roll is frozen in the snapshot)", async () => {
      await Customer.deleteMany({});
      const id = await anchored();
      await advance(id, orderAt(after(T0, 3)));
      const [issued] = await cardsOf(id);
      assert.ok(issued, "landmark: a card was issued");
      const edited = structuredClone(BLOB);
      edited.levels[0].slots[1].scratchDays = 30;
      edited.levels[0].slots[1].options = [{ kind: "bill-flat", id: "zz", weight: 1, min: 1, max: 2 }];
      settings = await writeSettings(edited);
      assert.deepEqual(await advance(id, orderAt(after(T0, 4))), { counted: true, cardIssued: true });
      const cards = await cardsOf(id);
      assert.equal(cards.length, 2);
      assert.deepEqual(cards.find((c) => c.issueKey === "step:1"), issued, "the first card is untouched by the edit and the next step");
      assert.equal(cards.find((c) => c.issueKey === "step:2")?.optionId, "zz", "landmark: the NEW step used the edited config");
      settings = await writeSettings(BLOB);
    });

    await scenario("i", "level boundary: step 3 = level 1 / step 3, step 4 = level 2 / step 1 (1-based level on the card)", async () => {
      await Customer.deleteMany({});
      const last = await anchored(L1_SIZE - 1);
      await advance(last, orderAt(after(T0, 3)));
      const c3 = (await cardsOf(last))[0];
      assert.deepEqual([c3.issueKey, c3.level, c3.step, c3.source], ["step:3", 1, 3, "level"]);
      const first = await anchored(L1_SIZE);
      await advance(first, orderAt(after(T0, 3)));
      const c4 = (await cardsOf(first))[0];
      assert.deepEqual([c4.issueKey, c4.level, c4.step, c4.source], ["step:4", 2, 1, "level"]);
    });

    await scenario("j", "after the last step the last level repeats (F5): step 6 and step 102 land on level 2 / step 1 again", async () => {
      await Customer.deleteMany({});
      const six = await anchored(L1_SIZE + L2_SIZE);
      await advance(six, orderAt(after(T0, 3)));
      const c6 = (await cardsOf(six))[0];
      assert.deepEqual([c6.issueKey, c6.level, c6.step], ["step:6", 2, 1]);
      const far = await anchored(FAR_STEP);
      await advance(far, orderAt(after(T0, 3)));
      const c102 = (await cardsOf(far))[0];
      assert.deepEqual([c102.issueKey, c102.level, c102.step], ["step:102", 2, 1]);
      assert.equal((await rawOf(far)).cardSteps, FAR_STEP + 1);
    });

    await scenario("k", "minBill: below the owner's minimum -> below-min-bill and nothing written; == minBill counts", async () => {
      await Customer.deleteMany({});
      settings = await writeSettings({ ...BLOB, minBill: HUNDRED });
      const id = await anchored();
      const before = await rawOf(id);
      assert.deepEqual(await advance(id, orderAt(after(T0, 3), HUNDRED - 1)), { counted: false, reason: "below-min-bill" });
      assert.deepEqual(await rawOf(id), before);
      assert.deepEqual(await advance(id, orderAt(after(T0, 4), HUNDRED)), { counted: true, cardIssued: true });
      settings = await writeSettings(BLOB);
    });

    await scenario("l", "Pay Now through the REAL runCreateFollowUps counts (Completed); an open tab (Pending) does not; the settle later counts it, once", async () => {
      await Customer.deleteMany({});
      const pay = await anchored();
      const cid = idOf(pay);
      const payOrder = orderAt(after(T0, 3));
      const base = { settings, numbering: {}, customerId: cid, promoTrace: null, promoSpent: null };
      const landed = (o: typeof payOrder, status: string) => ({ _id: cid, orderId: o.orderId, status, createdAt: o.createdAt, total: o.total });
      await runCreateFollowUps({ ...base, landed: landed(payOrder, "Completed"), ledger: { payment: "Cash", total: 250, paidAmount: 250, status: "Completed" } }, CREATE_FOLLOW_UP_DEPS);
      let raw = await rawOf(pay);
      assert.equal(raw.cardSteps, 1, "Pay Now counted");
      assert.equal(raw.visits, 1, "landmark: the REAL ledger write ran in the same wave");
      assert.equal((await cardsOf(pay)).length, 1);

      const tab = await anchored();
      const tabId = idOf(tab);
      const tabOrder = orderAt(after(T0, 4));
      await runCreateFollowUps(
        { ...base, customerId: tabId, landed: landed(tabOrder, "Pending"), ledger: { payment: "Unpaid", total: 250, paidAmount: 0, status: "Pending" } },
        CREATE_FOLLOW_UP_DEPS,
      );
      assert.ok(!("cardSteps" in (await rawOf(tab))), "an open tab counts nothing on create");
      // The settle: the REAL runSettleFollowUps, twice (a replay) - one step.
      const old: SettledTab = { orderId: tabOrder.orderId, customerId: tabId, payment: "Unpaid", total: 250, paidAmount: 0, status: "Pending", createdAt: tabOrder.createdAt };
      const updated: SettledTab = { ...old, payment: "Cash", paidAmount: 250, status: "Completed" };
      const first = await runSettleFollowUps(old, updated, settings, SETTLE_FOLLOW_UP_DEPS);
      assert.equal(first.customersTouched, true);
      raw = await rawOf(tab);
      assert.equal(raw.cardSteps, 1, "the settle counted the tab");
      assert.equal(raw.visits, 1, "landmark: the REAL ledger reconcile ran too");
      await runSettleFollowUps(old, updated, settings, SETTLE_FOLLOW_UP_DEPS);
      assert.equal((await rawOf(tab)).cardSteps, 1, "a replayed settle counts nothing more");
      assert.deepEqual((await rawOf(tab)).cardStepOrders, [tabOrder.orderId]);
    });

    await scenario("m", "cancel keeps the step (F4): the cancel route's ledger reversal leaves cardSteps, the marker and the card", async () => {
      await Customer.deleteMany({});
      const id = await anchored();
      const order = orderAt(after(T0, 3));
      await Customer.updateOne({ _id: id }, { $inc: { visits: 1, totalSpend: 250 } });
      await advance(id, order);
      const done = { customerId: idOf(id), payment: "Cash" as const, total: 250, paidAmount: 250, status: "Completed" as const };
      const touched = await reconcileLedger(done, { ...done, status: "Cancelled" });
      assert.equal(touched.size, 1, "landmark: the cancel's reversal really ran");
      const raw = await rawOf(id);
      assert.equal(raw.visits, 0, "the sale was reversed");
      assert.equal(raw.cardSteps, 1, "but the ladder step stays");
      assert.deepEqual(raw.cardStepOrders, [order.orderId]);
      assert.equal((await cardsOf(id)).length, 1, "and so does the card");
      assert.deepEqual(await advance(id, order), { counted: false, reason: "already-counted" }, "the cancelled bill can never count again");
    });

    await scenario("n", "stamp switch (F1): levels chosen -> levels-on and nothing stamped; levels off -> stamped; an unreadable chosen blob still blocks stamps", async () => {
      await Customer.deleteMany({});
      const loyalty = { loyaltyEnabled: true };
      const on = await writeSettings(BLOB, loyalty);
      const id = await newCustomer();
      assert.deepEqual(await grantStampForSettledOrder(on, idOf(id), "S-1", 500), { granted: false, reason: "levels-on" });
      assert.ok(!("stamps" in (await rawOf(id))), "no stamp written");
      const unreadable = await writeSettings({ v: 99, enabled: true, levels: "garbage" }, loyalty);
      assert.deepEqual(await grantStampForSettledOrder(unreadable, idOf(id), "S-2", 500), { granted: false, reason: "levels-on" }, "the owner's mode, read raw");
      for (const blob of [undefined, { ...BLOB, enabled: false }]) {
        const off = await writeSettings(blob, loyalty);
        const other = await newCustomer();
        assert.deepEqual(await grantStampForSettledOrder(off, idOf(other), "S-3", 500), { granted: true }, blob === undefined ? "no blob" : "enabled:false");
        assert.equal((await rawOf(other)).stamps, 1);
      }
      settings = await writeSettings(BLOB);
    });

    await scenario("o", "an env block (SCRATCH_CARDS_BLOCKED=true) or a 33 GSTIN -> levels-off and nothing written", async () => {
      await Customer.deleteMany({});
      const id = await anchored();
      const before = await rawOf(id);
      const blocked = { ...DEPS, env: { ...CLEAN_ENV, [SCRATCH_BLOCK_ENV_VAR]: "true" } as unknown as NodeJS.ProcessEnv };
      assert.deepEqual(await advanceRewardProgress(settings, idOf(id), orderAt(after(T0, 3)), blocked), { counted: false, reason: "levels-off" });
      const tn = await writeSettings(BLOB, { gstNumber: "33ABCDE1234F1Z5" });
      assert.deepEqual(await advanceRewardProgress(tn, idOf(id), orderAt(after(T0, 3)), DEPS), { counted: false, reason: "levels-off" });
      assert.deepEqual(await rawOf(id), before, "the document is byte-for-byte unchanged");
      assert.deepEqual(await advance(id, orderAt(after(T0, 3))), { counted: true, cardIssued: true }, "landmark: the unblocked path counts");
    });

    await scenario("p", "cardStepOrders / rewardCards stay hidden from a plain read after a step, and the progress read never carries pinHash", async () => {
      await Customer.deleteMany({});
      const id = await anchored(undefined, { pinHash: "secret", pinSetAt: T0 });
      await advance(id, orderAt(after(T0, 3)));
      const plain = (await Customer.findById(id).lean()) as unknown as Rec;
      assert.ok(plain && plain.cardSteps === 1, "landmark: the read found the stepped customer");
      assert.ok(!("rewardCards" in plain) && !("cardStepOrders" in plain), "neither array rides a plain read");
      const raw = await rawOf(id);
      assert.ok(Array.isArray(raw.rewardCards) && Array.isArray(raw.cardStepOrders), "landmark: both really are stored");
      const progressRead = (await REWARD_PROGRESS_DEPS.readProgress(idOf(id))) as Rec;
      assert.ok(progressRead && progressRead.cardSteps === 1, "landmark: the progress read returned the row");
      assert.deepEqual(Object.keys(progressRead).sort(), ["_id", "cardSteps", "pinSetAt", "rewardsAnchorAt"], "exactly the projected fields");
      assert.ok(!("pinHash" in progressRead), "the credential never rides the progress read");
    });
  } finally {
    // The name was checked against SCRATCH_PREFIX above; re-checked on the live connection before the drop.
    if (mongoose.connection.name.startsWith(SCRATCH_PREFIX)) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
