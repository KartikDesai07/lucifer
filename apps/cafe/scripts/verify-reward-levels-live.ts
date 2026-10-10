/**
 * CB-7 S1 live leg — proves the DB-truth the DB-free tests cannot, for the dormant reward-levels storage:
 *   a-d  the PUT-only Settings.rewardLevels blob through the settings route's REAL code path
 *        (updateSettingsSchema.safeParse -> Settings.findOneAndUpdate with settingsUpdateOf and the route's options);
 *   e    a card subdoc round-trips under Mongoose strict, and select:false keeps it off every plain read;
 *   f-k  the update/filter SHAPES S2/S5/S6 will rely on, run THROUGH THE Customer MODEL (Mongoose casting is the
 *        point; raw-driver semantics were probed separately): positional CAS, the multi-$push + $inc + $min step,
 *        the null-vs-0 filter, the $sort/$slice eviction, the two-lot points spend, the anchor/PIN $or filter;
 *   l    the BSON size of a worst-case Customer (REWARD_CARDS_KEEP cards, 5-entry pools, max-length text).
 *
 *   npm run verify:reward-levels:live            (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reward_levels npm run verify:reward-levels:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the scratch prefix, and drops that whole
 * scratch database in `finally`. Nothing in S1 calls any of this from app code - it probes the shapes S2+ will use.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose, { type Types } from "mongoose";

import { connectDB } from "@/lib/db";
import { Settings } from "@/models/Settings";
import { Customer } from "@/models/Customer";
import { pickSectionValues, settingsSectionBySlug } from "@/lib/settings-sections";
import { newRewardCardId } from "@/lib/reward-rng";
import type { SettingsInput } from "@/schemas";
import { ONE_DAY_MS } from "@pos/shared/public-promo";
import {
  REWARD_CARDS_KEEP,
  REWARD_CARD_STEP_ORDERS_MAX,
  REWARD_LABEL_MAX_LEN,
  REWARD_NAME_MAX_LEN,
  REWARD_TITLE_MAX_LEN,
  type RewardCardSnapshot,
} from "@pos/shared/reward-levels";
import { buildCardSnapshot } from "@pos/shared/reward-levels-engine";
import { BLOB, REF_A, REF_B, card, cardsOf, mustPut, newCustomer, put, rawOf, raw, reset, upd, type Flt, type Rec, type Upd } from "./reward-levels-live-kit";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reward_levels`;
const ROUTE_PATH = path.join(process.cwd(), "app", "api", "settings", "route.ts");
// The route's exact call shape, pinned from its SOURCE so a drift fails this leg (a shortcut call proves nothing).
const ROUTE_NEEDLES = ["settingsUpdateOf(parsed.data)", "new: true", "upsert: true", "setDefaultsOnInsert: true", "runValidators: true"];
const BSON_DOC_MAX_BYTES = 16 * 1024 * 1024;
const BYTES_PER_KB = 1024;
const FIXED_RNG = () => 0;

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

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }
  const routeSrc = readFileSync(ROUTE_PATH, "utf8");
  for (const needle of ROUTE_NEEDLES) {
    assert.ok(routeSrc.includes(needle), `app/api/settings/route.ts no longer contains ${JSON.stringify(needle)} — this leg's call shape has drifted`);
  }
  process.env.MONGODB_URI = uri;
  await connectDB();
  await Customer.init();

  try {
    await scenario("a", "a valid {rewardLevels} (enabled:false, one option of every kind) is stored whole, deepEqual the parsed input", async () => {
      await reset();
      const data = await mustPut({ rewardLevels: BLOB });
      assert.deepEqual(data.rewardLevels, BLOB, "landmark: the gate kept the input as-is");
      assert.deepEqual((await raw()).rewardLevels, data.rewardLevels, "the Mixed field kept every key");
    });

    await scenario("b", "a loyalty-section-shaped save (pickSectionValues) leaves the blob deepEqual", async () => {
      await reset();
      await mustPut({ rewardLevels: BLOB });
      const section = settingsSectionBySlug("loyalty");
      assert.ok(!(section.fields as readonly string[]).includes("rewardLevels"), "landmark: rewardLevels is not a section field");
      const form = { dinerAccountsEnabled: true, loyaltyEnabled: true, loyaltyStampsPerReward: 8, loyaltyMinBill: 100, loyaltyRewardKind: "flat", loyaltyRewardValue: 50, loyaltyRewardItem: "", restaurantName: "Other" } as unknown as SettingsInput;
      const picked = pickSectionValues(form, section);
      assert.ok(!("restaurantName" in picked), "landmark: only the section's own keys were picked");
      await mustPut(picked);
      const doc = await raw();
      assert.equal(doc.loyaltyEnabled, true, "landmark: the section save landed");
      assert.deepEqual(doc.rewardLevels, BLOB);
    });

    await scenario("c", "PUT {rewardLevels:null} removes the key (absent, never a stored null); a template-free body still saves", async () => {
      await reset();
      await mustPut({ rewardLevels: BLOB });
      await mustPut({ rewardLevels: null });
      assert.ok(!("rewardLevels" in (await raw())), "the key is ABSENT on the raw doc");
      assert.equal(await Settings.collection.countDocuments({ rewardLevels: { $exists: false } }), 1);
      await Settings.collection.drop().catch(() => undefined);
      await mustPut({ rewardLevels: null });
      assert.equal(await Settings.collection.countDocuments({ rewardLevels: { $exists: true } }), 0, "a null on an empty cluster upserts a doc without the key");
      assert.equal(await Settings.collection.countDocuments({}), 1, "landmark: the upsert created the singleton");
    });

    await scenario("d", "min > max is refused by the gate, nothing is written and the stored blob is unchanged", async () => {
      await reset();
      await mustPut({ rewardLevels: BLOB });
      const before = await raw();
      const bad = structuredClone(BLOB);
      bad.levels[0].slots[0].options[0] = { kind: "bill-percent", id: "a1", weight: 1, min: 20, max: 10 } as never;
      const r = await put({ rewardLevels: bad, restaurantName: "Should Not Land" });
      assert.ok(!r.ok && r.paths.some((p) => p.endsWith("max")), "refused under ...max");
      assert.deepEqual(await raw(), before, "the stored document is byte-for-byte unchanged");
    });

    await scenario("e", "a card round-trips under strict (+rewardCards, Dates included); plain reads and findByIdAndUpdate carry neither array", async () => {
      await Customer.deleteMany({});
      const c = card();
      const id = await newCustomer();
      await upd({ _id: id }, { $push: { rewardCards: c, cardStepOrders: "A-1" } } as Upd);
      assert.deepEqual(await cardsOf(id), [c], "the card came back field for field");
      assert.ok((await cardsOf(id))[0].issuedAt instanceof Date, "landmark: Dates stayed Dates");
      const plain = (await Customer.findById(id).lean()) as unknown as Rec | null;
      assert.ok(plain && plain.name === "Scratch Diner", "landmark: the read found the customer");
      assert.ok(!("rewardCards" in plain) && !("cardStepOrders" in plain), "a plain lean read has neither array");
      const viaUpdate = (await Customer.findByIdAndUpdate(id, { name: "Renamed" }, { new: true, runValidators: true }).lean()) as unknown as Rec | null;
      assert.ok(viaUpdate && viaUpdate.name === "Renamed", "landmark: the update ran");
      assert.ok(!("rewardCards" in viaUpdate) && !("cardStepOrders" in viaUpdate), "findByIdAndUpdate(new, lean) has neither array");
      const hydrated = (await Customer.findById(id))?.toObject() as unknown as Rec;
      assert.ok(!("rewardCards" in hydrated), "a hydrated toObject() has no cards either");
      assert.deepEqual((await rawOf(id)).cardStepOrders, ["A-1"], "landmark: the marker really is stored");
    });

    await scenario("f", "$elemMatch + rewardCards.$ CAS flips exactly one card; a repeat and an expired card match 0", async () => {
      await Customer.deleteMany({});
      const now = new Date();
      const old = new Date(now.getTime() - 30 * ONE_DAY_MS);
      const [c1, c2, c3] = [card(), card(), card()];
      const expired = card({}, old);
      assert.ok(expired.scratchBy.getTime() < now.getTime(), "landmark: the expired card is really past its scratch deadline");
      const id = await newCustomer([c1, c2, c3, expired]);
      const flip = (cardId: string) =>
        upd(
          { _id: id, rewardCards: { $elemMatch: { id: cardId, status: "ready", scratchBy: { $gte: now } } } },
          { $set: { "rewardCards.$.status": "revealed", "rewardCards.$.revealedAt": now, "rewardCards.$.validUntil": new Date(now.getTime() + ONE_DAY_MS) } },
        );
      const first = await flip(c2.id);
      assert.deepEqual([first.matchedCount, first.modifiedCount], [1, 1]);
      const after = await cardsOf(id);
      assert.deepEqual(after.map((c) => c.status), ["ready", "revealed", "ready", "ready"], "exactly the second card flipped");
      assert.ok(after[1].revealedAt instanceof Date && after[1].validUntil instanceof Date, "the positional $set cast its Dates");
      assert.equal((await flip(c2.id)).matchedCount, 0, "a repeat matches nothing");
      assert.equal((await flip(expired.id)).matchedCount, 0, "an expired card matches nothing");
      assert.equal((await cardsOf(id))[3].status, "ready", "and the expired card was not touched");
    });

    await scenario("g", "ONE update with $inc + $min + two $push (sort/slice) lands; $min sets a missing anchor and never moves it later", async () => {
      await Customer.deleteMany({});
      const id = await newCustomer();
      const t1 = new Date("2026-10-01T05:00:00.000Z");
      const step = (anchor: Date, c: RewardCardSnapshot, order: string) =>
        upd({ _id: id }, {
          $inc: { cardSteps: 1 },
          $min: { rewardsAnchorAt: anchor },
          $push: {
            cardStepOrders: { $each: [order], $slice: -REWARD_CARD_STEP_ORDERS_MAX },
            rewardCards: { $each: [c], $sort: { keepUntil: 1 }, $slice: -REWARD_CARDS_KEEP },
          },
        } as Upd);
      const r1 = await step(t1, card(), "A-1");
      assert.deepEqual([r1.matchedCount, r1.modifiedCount], [1, 1], "no path conflict");
      const r = await rawOf(id);
      assert.equal(r.cardSteps, 1);
      assert.deepEqual(r.rewardsAnchorAt, t1, "$min on a MISSING field set it");
      assert.deepEqual(r.cardStepOrders, ["A-1"]);
      assert.equal((await cardsOf(id)).length, 1);
      await step(new Date("2026-10-05T05:00:00.000Z"), card(), "A-2");
      const r2 = await rawOf(id);
      assert.equal(r2.cardSteps, 2);
      assert.deepEqual(r2.rewardsAnchorAt, t1, "$min with a LATER date kept the older anchor");
      assert.deepEqual(r2.cardStepOrders, ["A-1", "A-2"]);
      assert.equal((await cardsOf(id)).length, 2);
    });

    await scenario("h", "cardSteps:{$in:[null,0]} matches a customer without the field (and one at 0), not one at 1", async () => {
      await Customer.deleteMany({});
      const none = await newCustomer();
      const zero = await newCustomer(undefined, { cardSteps: 0 });
      const one = await newCustomer(undefined, { cardSteps: 1 });
      assert.ok(!("cardSteps" in (await rawOf(none))), "landmark: the field is really absent");
      const hit = async (id: Types.ObjectId) => Customer.countDocuments({ _id: id, cardSteps: { $in: [null, 0] } } as Flt);
      assert.deepEqual([await hit(none), await hit(zero), await hit(one)], [1, 1, 0]);
    });

    await scenario("i", "at REWARD_CARDS_KEEP cards one more drops the earliest-ending (an ended) card, never a later-ending live one", async () => {
      await Customer.deleteMany({});
      const now = new Date();
      const at = (days: number) => new Date(now.getTime() + days * ONE_DAY_MS);
      const ended = card({ status: "used", keepUntil: at(-5) });
      const live = Array.from({ length: REWARD_CARDS_KEEP - 1 }, (_, i) => card({ keepUntil: at(i + 1) }));
      const id = await newCustomer([ended, ...live]);
      assert.equal((await cardsOf(id)).length, REWARD_CARDS_KEEP, "landmark: the customer starts AT the cap");
      const push = (c: RewardCardSnapshot) => upd({ _id: id }, { $push: { rewardCards: { $each: [c], $sort: { keepUntil: 1 }, $slice: -REWARD_CARDS_KEEP } } } as Upd);
      const fresh = card({ keepUntil: at(100) });
      await push(fresh);
      const ids = new Set((await cardsOf(id)).map((c) => c.id));
      assert.equal(ids.size, REWARD_CARDS_KEEP);
      assert.ok(!ids.has(ended.id), "the ended card was the one dropped");
      assert.ok(live.every((c) => ids.has(c.id)) && ids.has(fresh.id), "every live card and the new one stayed");
      const earliest = card({ keepUntil: at(0.5) });
      await push(earliest);
      const ids2 = new Set((await cardsOf(id)).map((c) => c.id));
      assert.ok(!ids2.has(earliest.id), "a card that ends before every live one is itself the one dropped");
      assert.ok(live.every((c) => ids2.has(c.id)), "and no later-ending live card was evicted for it");
    });

    await scenario("j", "a two-lot points spend lands both $inc in ONE update via arrayFilters; a stale pointsSpent on either lot matches 0", async () => {
      await Customer.deleteMany({});
      const now = new Date();
      const validUntil = new Date(now.getTime() + 5 * ONE_DAY_MS);
      const lot = (pointsSpent: number) => card({ status: "revealed", validUntil, keepUntil: validUntil, pointsSpent }, now, "points");
      const [a, b] = [lot(0), lot(3)];
      const id = await newCustomer([a, b]);
      const guard = (sa: number, sb: number): Flt => ({
        _id: id,
        rewardCards: {
          $all: [
            { $elemMatch: { id: a.id, pointsSpent: sa, status: "revealed", validUntil: { $gte: now } } },
            { $elemMatch: { id: b.id, pointsSpent: sb, status: "revealed", validUntil: { $gte: now } } },
          ],
        },
      });
      const spend = (sa: number, sb: number) =>
        upd(guard(sa, sb), { $inc: { "rewardCards.$[l0].pointsSpent": 5, "rewardCards.$[l1].pointsSpent": 2 } }, { arrayFilters: [{ "l0.id": a.id }, { "l1.id": b.id }] });
      const ok = await spend(0, 3);
      assert.deepEqual([ok.matchedCount, ok.modifiedCount], [1, 1], "one update, one matched doc");
      assert.deepEqual((await cardsOf(id)).map((c) => c.pointsSpent), [5, 5], "both lots moved");
      assert.equal((await spend(0, 5)).matchedCount, 0, "stale first lot -> 0");
      assert.equal((await spend(5, 3)).matchedCount, 0, "stale second lot -> 0");
      assert.deepEqual((await cardsOf(id)).map((c) => c.pointsSpent), [5, 5], "and nothing moved on the misses");
    });

    await scenario("k", "the anchor/pinHash $or filter matches a PIN holder with no anchor and refuses a customer with neither", async () => {
      await Customer.deleteMany({});
      const pin = await newCustomer(undefined, { pinHash: "x" });
      const neither = await newCustomer();
      const withAnchor = await newCustomer(undefined, { rewardsAnchorAt: new Date("2026-09-01T00:00:00.000Z") });
      const now = new Date();
      const claim = (id: Types.ObjectId) => upd({ _id: id, $or: [{ rewardsAnchorAt: { $exists: true } }, { pinHash: { $exists: true } }] } as Flt, { $min: { rewardsAnchorAt: now } });
      assert.equal((await claim(pin)).matchedCount, 1, "a PIN holder without an anchor matches");
      assert.deepEqual((await rawOf(pin)).rewardsAnchorAt, now, "and $min set the anchor");
      assert.equal((await claim(neither)).matchedCount, 0, "a customer with neither is refused");
      assert.ok(!("rewardsAnchorAt" in (await rawOf(neither))), "and nothing was written to it");
      assert.equal((await claim(withAnchor)).matchedCount, 1, "landmark: an anchored customer matches via the first branch");
    });

    await scenario("l", "BSON size of a worst-case Customer (KEEP cards, 5-entry pools, max-length text) is far under 16 MB (size printed)", async () => {
      await Customer.deleteMany({});
      const kinds = ["bill-percent", "bill-flat", "product-percent", "category-percent", "category-flat"] as const;
      const long = (n: number, ch: string) => ch.repeat(n);
      const worst = () => {
        const options = kinds.map((kind, i) => ({ id: `o${i}`, kind, weight: 100, min: 1, max: 99, productId: REF_A, productName: long(REWARD_NAME_MAX_LEN, "p"), categoryId: REF_B, categoryName: long(REWARD_NAME_MAX_LEN, "c"), capRupees: 999_999, minBill: 999_999 }));
        const built = buildCardSnapshot({ id: newRewardCardId(), issueKey: "camp:" + long(24, "f"), source: "campaign", campaignId: long(24, "f"), title: long(REWARD_TITLE_MAX_LEN, "t"), slot: { scratchDays: 365, useDays: 365, options: options as never }, rng: FIXED_RNG, now: new Date() });
        return { ...built, label: long(REWARD_LABEL_MAX_LEN, "l"), categoryId: REF_B, categoryName: long(REWARD_NAME_MAX_LEN, "c"), qty: 99, orderId: "A2-2026-100000", pointsSpent: 10_000, revealedAt: new Date(), validUntil: new Date(), usedAt: new Date(), pool: built.pool.map((e) => ({ ...e, label: long(REWARD_LABEL_MAX_LEN, "x") })) };
      };
      const cards = Array.from({ length: REWARD_CARDS_KEEP }, worst);
      assert.equal(cards[0].pool.length, kinds.length, "landmark: a full 5-entry pool");
      const id = await newCustomer(cards, { name: long(80, "n") });
      assert.equal((await cardsOf(id)).length, REWARD_CARDS_KEEP);
      const bytes = mongoose.mongo.BSON.calculateObjectSize((await rawOf(id)) as never);
      assert.ok(bytes > 0 && bytes < BSON_DOC_MAX_BYTES, `size ${bytes} is under 16 MB`);
      console.log(`       BSON size of a ${REWARD_CARDS_KEEP}-card worst-case Customer: ${bytes} bytes = ${(bytes / BYTES_PER_KB).toFixed(1)} KB (${(bytes / BYTES_PER_KB / REWARD_CARDS_KEEP).toFixed(2)} KB/card)`);
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
