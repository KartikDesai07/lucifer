/**
 * CB-7 S4 live leg - proves the DB-truth the DB-free tests cannot, for "a diner scratches a card exactly once":
 *   the REAL scratchRewardCard and readDinerCards with their DEFAULT ports (only the clock / env are injected) and the
 *   REAL hitRateLimit against Mongo. The blob is written straight into Settings (enabled:true) - the WRITE gate's
 *   launch lock is bypassed on purpose. Cards come from the real engine (card() of the S1 kit).
 *
 *   npm run verify:reward-cards:live          (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reward_cards npm run verify:reward-cards:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the scratch prefix, and drops that whole
 * scratch database in `finally`. (console output is intentional - this is an ops CLI script, not app code.)
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import { scratchRewardCard, SCRATCH_CAS_ATTEMPTS, type ScratchResult } from "@/lib/reward-card-scratch";
import { readDinerCards } from "@/lib/reward-cards-read";
import { hitRateLimit } from "@/lib/public-rate-limit";
import { DINER_READY_CARD_KEYS } from "@pos/shared/public-diner-cards";
import { DINER_SCRATCH_RATE_MAX, dinerScratchBucket } from "@pos/shared/public-diner";
import { deadlineFrom } from "@pos/shared/reward-levels-engine";
import { BLOB, T0, after, rawOf, writeSettings } from "./reward-progress-live-kit";
import { card, cardsOf, newCustomer, REF_A } from "./reward-levels-live-kit";
import { BLOCKED_ENV, TN_GSTIN, asRec, idOf, scratchBarrier, scratchDepsAt, walletDepsAt, type Rec } from "./reward-cards-live-kit";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reward_cards`;
const RACERS = 3;
const NOW = after(T0, 60); // every leg's "now": an hour after the cards were issued, well inside the scratch window
const UNKNOWN_ID = "0123456789ab"; // well-formed (12 hex) and held by nobody
const REFUSED: ScratchResult = { ok: false, reason: "refused" };

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

// The scratched card out of a result that must be a success.
function won(result: ScratchResult): Rec {
  assert.ok(result.ok, `expected a scratched card, got ${JSON.stringify(result)}`);
  return asRec(result.card);
}
const only = async (id: mongoose.Types.ObjectId): Promise<Rec> => asRec((await cardsOf(id))[0]);

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" - the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }
  process.env.MONGODB_URI = uri;
  await connectDB();
  await Customer.init();

  try {
    const settings = await writeSettings(BLOB);
    const scratch = (id: mongoose.Types.ObjectId, cardId: string, at: Date = NOW) => scratchRewardCard(settings, idOf(id), cardId, scratchDepsAt(at));
    const wallet = (id: mongoose.Types.ObjectId, at: Date = NOW) => readDinerCards(settings, idOf(id), walletDepsAt(at));

    await scenario("a", "a ready card's wire JSON carries exactly the allowlist keys present on it (level/step optional) and nothing of the outcome - fresh and expired", async () => {
      await Customer.deleteMany({});
      const leaky = card({ productId: REF_A, productName: "Cold coffee", capRupees: 80, minBill: 100 }, T0);
      const campaign = card({ source: "campaign", level: undefined, step: undefined, issueKey: "camp:x" }, T0);
      const id = await newCustomer([leaky, campaign]);
      const raw = JSON.stringify(await rawOf(id));
      assert.ok(raw.includes('"value"') && raw.includes('"optionId"') && raw.includes('"productId"'), "landmark: the STORED row really holds the outcome fields");
      const allowed = DINER_READY_CARD_KEYS as readonly string[];
      for (const at of [NOW, after(T0, 60 * 24 * 30)]) {
        const data = await wallet(id, at);
        assert.equal(data?.cards.length, 2, "landmark: both cards listed");
        for (const dto of data?.cards ?? []) {
          const json = JSON.stringify(dto);
          const keys = Object.keys(JSON.parse(json) as Rec);
          const optional = ["level", "step"];
          const expected = allowed.filter((k) => !optional.includes(k) || (dto.id === leaky.id));
          assert.deepEqual([...keys].sort(), [...expected].sort(), `${dto.id} keys`);
          assert.equal(dto.status, "ready");
          for (const banned of ['"value"', '"optionId"', '"productId"', '"outcome"', '"capRupees"', '"minBill"', '"productName"']) {
            assert.ok(!json.includes(banned), `${dto.id} must not carry ${banned}: ${json}`);
          }
          assert.ok(!keys.includes("kind"), "no top-level kind");
        }
        assert.equal(data?.cards.find((c) => c.id === leaky.id)?.state, at === NOW ? "ready" : "expired", "landmark: the state follows the clock, the shape does not");
      }
    });

    await scenario("b", "a scratch reveals the card; the stored validUntil = deadlineFrom(now, useDays) and keepUntil follows it", async () => {
      await Customer.deleteMany({});
      const c = card({}, T0);
      const id = await newCustomer([c]);
      const res = won(await scratch(id, c.id));
      assert.equal(res.status, "revealed");
      assert.ok(asRec(res.outcome).label, "the outcome comes back");
      const stored = await only(id);
      const want = deadlineFrom(NOW.getTime(), c.useDays);
      assert.equal(stored.status, "revealed");
      assert.deepEqual(stored.revealedAt, NOW);
      assert.deepEqual(stored.validUntil, want);
      assert.deepEqual(stored.keepUntil, want);
      assert.equal(res.validUntil, want.getTime(), "the response says what the database stored");
    });

    await scenario("c", "two scratches in sequence: the outcome deepEquals and the ONE stored revealedAt is the first one's", async () => {
      await Customer.deleteMany({});
      const c = card({}, T0);
      const id = await newCustomer([c]);
      const first = await scratch(id, c.id);
      const afterRow = await rawOf(id);
      const second = await scratch(id, c.id, after(NOW, 5));
      assert.deepEqual(won(second).outcome, won(first).outcome);
      assert.deepEqual(second, first, "the replay answers the stored card, whole");
      assert.deepEqual((await only(id)).revealedAt, NOW, "the replay did not move revealedAt");
      assert.deepEqual(await rawOf(id), afterRow, "and wrote nothing at all");
    });

    await scenario("d", `${RACERS} concurrent scratches (Promise.all) answer one outcome and store one reveal`, async () => {
      await Customer.deleteMany({});
      const c = card({}, T0);
      const id = await newCustomer([c]);
      const nows = Array.from({ length: RACERS }, (_, i) => after(NOW, i));
      const results = await Promise.all(nows.map((at) => scratch(id, c.id, at)));
      const cards = results.map(won);
      for (const got of cards) assert.deepEqual(got, cards[0], "every racer got the same card");
      const stored = await only(id);
      assert.equal(stored.status, "revealed");
      assert.equal(cards[0].revealedAt, (stored.revealedAt as Date).getTime(), "the answers carry the STORED reveal");
      assert.ok(nows.some((at) => at.getTime() === (stored.revealedAt as Date).getTime()), "and it is exactly one racer's clock");
    });

    await scenario("e", `barrier: every racer reads "ready" before ANY write; the CAS losers reclassify to the stored outcome (never busy/refused)`, async () => {
      await Customer.deleteMany({});
      const c = card({}, T0);
      const id = await newCustomer([c]);
      const barrier = scratchBarrier(RACERS);
      const nows = Array.from({ length: RACERS }, (_, i) => after(NOW, i));
      const results = await Promise.all(nows.map((at) => scratchRewardCard(settings, idOf(id), c.id, barrier.deps(at))));
      const expectedOrder = [...Array(RACERS).fill("read-arrived"), ...Array(RACERS).fill("reveal")];
      assert.deepEqual(barrier.events, expectedOrder, "contention really happened: all reads landed before any write");
      assert.deepEqual([...barrier.matched].sort(), [0, 0, 1], "exactly one CAS matched; two lost");
      assert.equal(barrier.reads(), RACERS + (RACERS - 1), "each loser re-read once");
      assert.ok(SCRATCH_CAS_ATTEMPTS >= 2, "landmark: the budget allows the re-read");
      assert.ok(results.every((r) => r.ok), `none busy/refused: ${JSON.stringify(results)}`);
      const stored = await only(id);
      for (const got of results.map(won)) {
        assert.equal(got.revealedAt, (stored.revealedAt as Date).getTime(), "winner and losers all answer the stored reveal");
        assert.deepEqual(got.outcome, won(results[0]).outcome);
      }
    });

    await scenario("f", "an expired ready card is refused and the document is byte-for-byte unchanged", async () => {
      await Customer.deleteMany({});
      const c = card({}, T0);
      const id = await newCustomer([c]);
      const before = await rawOf(id);
      assert.deepEqual(await scratch(id, c.id, after(c.scratchBy, 1)), REFUSED);
      assert.deepEqual(await rawOf(id), before);
      assert.equal((await only(id)).status, "ready", "landmark: still ready (and so still unrevealed)");
    });

    await scenario("g", "another diner's card id and an unknown well-formed id answer the SAME refusal as an expired card; the owner's card is untouched", async () => {
      await Customer.deleteMany({});
      const c = card({}, T0);
      const owner = await newCustomer([c]);
      const other = await newCustomer([card({}, T0)]);
      const expired = await scratch(owner, c.id, after(c.scratchBy, 1));
      const before = await rawOf(owner);
      assert.deepEqual(expired, REFUSED, "landmark: the expired refusal");
      assert.deepEqual(await scratch(other, c.id), expired, "someone else's card id");
      assert.deepEqual(await scratch(other, UNKNOWN_ID), expired, "an unknown id");
      assert.deepEqual(await rawOf(owner), before, "the owner's row did not move");
      assert.equal((await only(owner)).status, "ready");
      assert.equal(won(await scratch(owner, c.id)).status, "revealed", "landmark: the owner still can scratch it");
    });

    await scenario("h", "a scratch at exactly scratchBy succeeds ($gte); one millisecond later is refused", async () => {
      await Customer.deleteMany({});
      const [a, b] = [card({}, T0), card({}, T0)];
      const id = await newCustomer([a, b]);
      assert.equal(won(await scratch(id, a.id, a.scratchBy)).status, "revealed");
      assert.deepEqual((await cardsOf(id)).find((x) => x.id === a.id)?.revealedAt, a.scratchBy);
      assert.deepEqual(await scratch(id, b.id, new Date(b.scratchBy.getTime() + 1)), REFUSED);
    });

    await scenario("i", "kind none: the scratch makes it used at once - usedAt = keepUntil = revealedAt, no validUntil", async () => {
      await Customer.deleteMany({});
      const c = card({ kind: "none", value: 0, label: "Better luck next time" }, T0);
      const id = await newCustomer([c]);
      const res = won(await scratch(id, c.id));
      assert.equal(res.status, "used");
      const stored = await only(id);
      assert.equal(stored.status, "used");
      assert.deepEqual([stored.usedAt, stored.keepUntil], [NOW, NOW]);
      assert.deepEqual(stored.revealedAt, NOW);
      assert.ok(!("validUntil" in stored), "nothing to use later");
    });

    await scenario("j", "points: the reveal sets pointsSpent 0 and the wallet's pointsBalance = the card's value (0 before)", async () => {
      await Customer.deleteMany({});
      const c = card({}, T0, "points");
      const id = await newCustomer([c]);
      assert.equal((await wallet(id))?.pointsBalance, 0, "ready points are not spendable");
      assert.equal(won(await scratch(id, c.id)).status, "revealed");
      const stored = await only(id);
      assert.equal(stored.pointsSpent, 0);
      assert.ok(c.value > 0 && stored.value === c.value, "landmark: a real points value");
      assert.equal((await wallet(id))?.pointsBalance, c.value);
    });

    await scenario("k", "env SCRATCH_CARDS_BLOCKED=true and a 33 GSTIN each answer paused; the card is still ready in the DB and scratches once unblocked", async () => {
      await Customer.deleteMany({});
      const c = card({}, T0);
      const id = await newCustomer([c]);
      const before = await rawOf(id);
      const paused: ScratchResult = { ok: false, reason: "paused" };
      assert.deepEqual(await scratchRewardCard(settings, idOf(id), c.id, scratchDepsAt(NOW, BLOCKED_ENV)), paused, "env flag");
      const tn = await writeSettings(BLOB, { gstNumber: TN_GSTIN });
      assert.deepEqual(await scratchRewardCard(tn, idOf(id), c.id, scratchDepsAt(NOW)), paused, "GSTIN 33");
      assert.deepEqual(await rawOf(id), before, "nothing written");
      assert.equal((await only(id)).status, "ready");
      const clean = await writeSettings(BLOB);
      assert.equal(won(await scratchRewardCard(clean, idOf(id), c.id, scratchDepsAt(NOW))).status, "revealed", "landmark: the unblocked path scratches");
    });

    await scenario("l", "a blob with enabled:false answers paused; the wallet still lists the previously revealed card with its outcome", async () => {
      await Customer.deleteMany({});
      const [done, pending] = [card({}, T0), card({}, T0)];
      const id = await newCustomer([done, pending]);
      const on = await writeSettings(BLOB);
      const revealed = won(await scratchRewardCard(on, idOf(id), done.id, scratchDepsAt(NOW)));
      const off = await writeSettings({ ...BLOB, enabled: false });
      assert.deepEqual(await scratchRewardCard(off, idOf(id), pending.id, scratchDepsAt(NOW)), { ok: false, reason: "paused" });
      assert.equal((await cardsOf(id)).find((x) => x.id === pending.id)?.status, "ready", "the pending card did not move");
      const data = await readDinerCards(off, idOf(id), walletDepsAt(NOW));
      assert.equal(data?.earning, false, "landmark: the cafe is not earning");
      assert.deepEqual(data?.cards.find((x) => x.id === done.id), revealed, "the revealed card is listed with its outcome");
      assert.ok(data?.cards.some((x) => x.id === pending.id), "and so is the ready one");
      await writeSettings(BLOB);
    });

    await scenario("m", `real hitRateLimit: ${DINER_SCRATCH_RATE_MAX} hits on one token's bucket pass, the next is refused; another token is unaffected`, async () => {
      const [tokenA, tokenB] = [dinerScratchBucket("live-token-a"), dinerScratchBucket("live-token-b")];
      const nowMs = T0.getTime();
      for (let i = 1; i <= DINER_SCRATCH_RATE_MAX; i++) {
        assert.equal((await hitRateLimit(tokenA, DINER_SCRATCH_RATE_MAX, nowMs)).allowed, true, `hit ${i}`);
      }
      const over = await hitRateLimit(tokenA, DINER_SCRATCH_RATE_MAX, nowMs);
      assert.equal(over.allowed, false, "the next hit is refused");
      assert.ok(over.retryAfterSec >= 1);
      assert.equal((await hitRateLimit(tokenB, DINER_SCRATCH_RATE_MAX, nowMs)).allowed, true, "another token has its own bucket");
    });

    await scenario("n", "select:false still hides rewardCards on a plain Customer.findById().lean() while the row really stores them", async () => {
      await Customer.deleteMany({});
      const id = await newCustomer([card({}, T0)], { cardSteps: 2 });
      const plain = asRec(await Customer.findById(id).lean());
      assert.equal(plain.cardSteps, 2, "landmark: the read found the row");
      assert.ok(!("rewardCards" in plain));
      assert.ok(Array.isArray((await rawOf(id)).rewardCards), "landmark: the array is stored");
    });

    await scenario("o", `the "cardSteps +rewardCards" projection returns exactly _id, cardSteps and rewardCards`, async () => {
      await Customer.deleteMany({});
      const id = await newCustomer([card({}, T0)], { cardSteps: 2, name: "Scratch Diner" });
      const row = asRec(await Customer.findById(id).select("cardSteps +rewardCards").lean());
      const keys = Object.keys(row).sort();
      console.log(`       projection key set: ${JSON.stringify(keys)}`);
      assert.deepEqual(keys, ["_id", "cardSteps", "rewardCards"]);
      assert.equal(row.cardSteps, 2);
      assert.equal((row.rewardCards as unknown[]).length, 1);
    });

    await scenario("p", "blocked: the wallet answers earning false with progress and ladder null but still lists the cards; unblocked the same diner has both", async () => {
      await Customer.deleteMany({});
      const id = await newCustomer([card({}, T0)], { cardSteps: 1 });
      const open = await readDinerCards(settings, idOf(id), walletDepsAt(NOW));
      assert.equal(open?.earning, true, "landmark: unblocked earns");
      assert.ok(open?.progress && open.ladder && open.ladder.length > 0, "landmark: progress and ladder exist");
      const blocked = await readDinerCards(settings, idOf(id), walletDepsAt(NOW, BLOCKED_ENV));
      assert.equal(blocked?.earning, false);
      assert.equal(blocked?.progress, null);
      assert.equal(blocked?.ladder, null);
      assert.equal(blocked?.cards.length, 1, "the held card still shows");
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
