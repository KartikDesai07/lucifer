/**
 * CB-7 S6 session 3 live leg - festival cards, DB-truth the DB-free tests cannot give: the REAL readDinerCards and
 * issueCampaignCards with their real Mongoose ports (only the environment is injected and every call COUNTED), the
 * admin routes' real handlers (POST create, PATCH end-now) and the real scratch lib, against a real mongod.
 *   c1 happy path, c2 three-diner race on maxCards 1, c3 same-diner twin GETs (the loser's reservation goes back),
 *   c4 ended / upcoming, c5 blocked (env, GST 33, levels off), c6 picked audience, c7 not enrolled, c8 forced push miss
 *   compensation, c9 End now through the real PATCH handler, c10 strict-schema round trip + index, c11 scratch.
 *
 *   npm run verify:reward-campaigns:live          (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reward_campaigns npm run verify:reward-campaigns:live
 *
 * Settings is written straight (the levels launch lock bypassed). SAFETY: refuses any database whose name does not carry
 * the scratch prefix and drops THIS script's own scratch database in `finally`. (console output is intentional - ops CLI.)
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import { RewardCampaign } from "@/models/RewardCampaign";
import { readDinerCards } from "@/lib/reward-cards-read";
import { issueCampaignCards } from "@/lib/reward-campaign-issue";
import { scratchRewardCard, REWARD_SCRATCH_DEPS } from "@/lib/reward-card-scratch";
import { cafeDateString } from "@pos/shared/utils";
import { CAMPAIGN_ALREADY_ENDED, CAMPAIGN_NOT_FOUND, campaignIssueKey } from "@pos/shared/reward-campaigns";
import { BLOB, CLEAN_ENV, writeSettings } from "./reward-progress-live-kit";
import { TN_GSTIN, idOf } from "./reward-cards-live-kit";
import { installStubs } from "./reward-card-use-live-kit";
import {
  BOX, countedIssue, dbIndexes, enrolled, heldOf, hoursFrom, issuedOf, loadCampaignApi, newCampaign, notEnrolled,
  readBarrier, startGate, walletDeps, type Rec,
} from "./reward-campaigns-live-kit";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reward_campaigns`;
const GST_OK = "29ABCDE1234F1Z5"; // Karnataka: not a blocked state
const TICK_MS = 5;

let passed = 0;
let failed = 0;
async function scenario(id: string, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await Customer.deleteMany({});
    await RewardCampaign.deleteMany({});
    await fn();
    passed += 1;
    console.log(`  PASS ${id}. ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${id}. ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" - the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }
  process.env.MONGODB_URI = uri;
  delete process.env.TENANT_ID;
  delete process.env.SCRATCH_CARDS_BLOCKED;
  installStubs();
  await connectDB();
  await Promise.allSettled(Object.values(mongoose.models).map((model) => model.init()));
  console.log(`\nreward campaigns (festival cards) - live against ${dbName}\n`);

  try {
    const api = await loadCampaignApi();
    const settings = await writeSettings(BLOB, { gstNumber: GST_OK });
    const read = (id: mongoose.Types.ObjectId, issue = countedIssue(), over = {}) => readDinerCards(settings, idOf(id), walletDeps(issue, CLEAN_ENV, over));

    await scenario("c1", "an everyone campaign gives an enrolled diner ONE card (source campaign, title, camp:<id>); issued 1; a second read adds nothing", async () => {
      const camp = await newCampaign();
      const diner = await enrolled();
      const first = countedIssue();
      const data = await read(diner, first);
      assert.equal(data?.cards.length, 1, "one card on the wallet the very load returns");
      assert.equal(data?.cards[0].source, "campaign");
      assert.equal((data?.cards[0] as unknown as Rec).title, "Diwali treat");
      const held = await heldOf(diner);
      assert.equal(held.length, 1);
      assert.equal(held[0].issueKey, campaignIssueKey(idOf(camp)));
      assert.equal(held[0].issueKey, `camp:${idOf(camp)}`);
      assert.equal(held[0].source, "campaign");
      assert.equal(await issuedOf(camp), 1);
      const second = countedIssue();
      assert.equal((await read(diner, second))?.cards.length, 1);
      assert.equal(second.calls.reserve, 0, "a held key is skipped before any reserve");
      assert.equal(await issuedOf(camp), 1);
      assert.equal((await heldOf(diner)).length, 1);
    });

    await scenario("c2", "maxCards 1, three DIFFERENT enrolled diners read at once: exactly one card across the three, issued 1", async () => {
      const camp = await newCampaign({ maxCards: 1 });
      const diners = [await enrolled(), await enrolled(), await enrolled()];
      const gate = startGate();
      const issue = countedIssue();
      const racers = diners.map(async (d) => {
        await gate.wait;
        return read(d, issue);
      });
      gate.go();
      await Promise.all(racers);
      const counts = await Promise.all(diners.map(async (d) => (await heldOf(d)).length));
      assert.equal(counts.reduce((a, b) => a + b, 0), 1, `cards per diner ${JSON.stringify(counts)}`);
      assert.equal(await issuedOf(camp), 1);
      assert.equal(issue.calls.push, 1, "only the budget winner pushed (the other two never reserved)");
    });

    await scenario("c3", "two parallel GETs of the SAME diner (both pre-read first): one card, issued 1 after the loser's compensation", async () => {
      const camp = await newCampaign();
      const diner = await enrolled();
      const issue = countedIssue();
      const barrier = readBarrier(2);
      const results = await Promise.all([read(diner, issue, { readWallet: barrier }), read(diner, issue, { readWallet: barrier })]);
      assert.deepEqual([...issue.calls.pushMatched].sort(), [0, 1], "contention really happened: one push matched, one missed");
      assert.equal(issue.calls.reserve, 2, "both reserved before either pushed");
      assert.equal(issue.calls.release, 1, "the loser gave its reservation back exactly once");
      assert.equal((await heldOf(diner)).length, 1);
      assert.equal(await issuedOf(camp), 1);
      console.log(`       responses carried ${JSON.stringify(results.map((r) => r?.cards.length))} cards (the loser's pre-read wallet is stale; the diner holds 1)`);
      assert.ok(results.some((r) => r?.cards.length === 1), "the winner's response shows the card");
    });

    await scenario("c4", "an ended campaign and an upcoming one give nothing; issued stays 0", async () => {
      const now = new Date();
      const ended = await newCampaign({ startsAt: hoursFrom(now, -48), endsAt: hoursFrom(now, -1) });
      const upcoming = await newCampaign({ startsAt: hoursFrom(now, 1), endsAt: hoursFrom(now, 48) });
      const diner = await enrolled();
      const issue = countedIssue();
      assert.equal((await read(diner, issue))?.cards.length, 0);
      assert.equal(issue.calls.find, 1, "landmark: the issue step really ran");
      assert.equal(issue.calls.reserve, 0);
      assert.equal(await issuedOf(ended), 0);
      assert.equal(await issuedOf(upcoming), 0);
      assert.equal((await heldOf(diner)).length, 0);
    });

    await scenario("c5", "blocked (env flag 1, GST state 33, levels off): no card and NO campaign read or write; unblocked control gives one", async () => {
      const camp = await newCampaign();
      const diner = await enrolled();
      const silent = async (what: string, s: typeof settings, env: NodeJS.ProcessEnv) => {
        const issue = countedIssue(env);
        const data = await readDinerCards(s, idOf(diner), walletDeps(issue, env));
        assert.equal(data?.cards.length, 0, what);
        assert.deepEqual(issue.calls, { find: 0, reserve: 0, push: 0, pushMatched: [], release: 0 }, `${what}: no campaign call`);
      };
      await silent("env SCRATCH_CARDS_BLOCKED=1", settings, { SCRATCH_CARDS_BLOCKED: "1" } as unknown as NodeJS.ProcessEnv);
      await silent("GST state 33", await writeSettings(BLOB, { gstNumber: TN_GSTIN }), CLEAN_ENV);
      await silent("levels disabled", await writeSettings({ ...BLOB, enabled: false }, { gstNumber: GST_OK }), CLEAN_ENV);
      assert.equal(await issuedOf(camp), 0);
      assert.equal((await heldOf(diner)).length, 0);
      const open = await writeSettings(BLOB, { gstNumber: GST_OK });
      assert.equal((await readDinerCards(open, idOf(diner), walletDeps(countedIssue())))?.cards.length, 1, "landmark: unblocked gives the card");
    });

    await scenario("c6", "picked audience: the picked diner A gets a card, the enrolled diner B gets none", async () => {
      const a = await enrolled();
      const b = await enrolled();
      const camp = await newCampaign({ audience: "picked", customerIds: [a] });
      assert.equal((await read(a))?.cards.length, 1);
      assert.equal((await read(b))?.cards.length, 0);
      assert.equal((await heldOf(b)).length, 0);
      assert.equal(await issuedOf(camp), 1);
    });

    await scenario("c7", "a not-enrolled diner gets no card and issued never moves (no reserve); a PIN-only diner does get one", async () => {
      const camp = await newCampaign();
      const ghost = await notEnrolled();
      const issue = countedIssue();
      assert.equal((await read(ghost, issue))?.cards.length, 0);
      assert.deepEqual([issue.calls.find, issue.calls.reserve, issue.calls.push, issue.calls.release], [0, 0, 0, 0]);
      assert.equal(await issuedOf(camp), 0);
      const pin = await notEnrolled();
      await Customer.collection.updateOne({ _id: pin }, { $set: { pinHash: "scratch-hash", pinSetAt: new Date() } });
      assert.equal((await read(pin))?.cards.length, 1, "landmark: a PIN holder is in the programme");
      assert.equal(await issuedOf(camp), 1);
    });

    await scenario("c8", "a forced push miss (the key lands after the pre-read) returns issued to its prior value exactly", async () => {
      const camp = await newCampaign({ maxCards: 10, issued: 5 });
      const diner = await enrolled();
      const key = campaignIssueKey(idOf(camp));
      const staleWallet = { rewardsAnchorAt: new Date(), rewardCards: [] };
      const counted = countedIssue(CLEAN_ENV, {
        // Between the pre-read and the push, a twin writes the card: the push filter must refuse.
        pushCard: async (filter, update) => {
          await Customer.collection.updateOne({ _id: diner }, { $push: { rewardCards: { id: "twin", issueKey: key, source: "campaign" } } as never });
          return (await import("@/lib/reward-campaign-issue")).REWARD_CAMPAIGN_ISSUE_DEPS.pushCard(filter, update);
        },
      });
      assert.equal(await issueCampaignCards(settings, idOf(diner), staleWallet, counted.deps), 0, "nothing was pushed");
      assert.deepEqual(counted.calls.pushMatched, [0], "landmark: the push really missed");
      assert.equal(counted.calls.release, 1);
      assert.equal(await issuedOf(camp), 5, "issued is back to 5, exactly");
      assert.equal((await heldOf(diner)).length, 1, "only the twin's card is held");
    });

    await scenario("c9", "End now through the REAL PATCH handler: endsAt <= now, a later read gives nothing, a second end is 409 already ended", async () => {
      const camp = await newCampaign();
      const id = idOf(camp);
      const before = Date.now();
      const res = await api.end(id);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const dto = (res.body.data as Rec).campaign as Rec;
      assert.equal(dto.endedEarly, true);
      assert.ok((dto.endsAt as number) <= Date.now() && (dto.endsAt as number) >= before, "endsAt is the end instant");
      const raw = (await RewardCampaign.collection.findOne({ _id: camp })) as Rec;
      assert.ok((raw.endsAt as Date).getTime() <= Date.now() && raw.endedAt instanceof Date);
      await sleep(TICK_MS);
      const diner = await enrolled();
      assert.equal((await read(diner))?.cards.length, 0);
      assert.equal(await issuedOf(camp), 0);
      const again = await api.end(id);
      assert.equal(again.status, 409);
      assert.equal(again.body.error, CAMPAIGN_ALREADY_ENDED);
      const ghost = await api.end("0123456789abcdef01234567");
      assert.deepEqual([ghost.status, ghost.body.error], [404, CAMPAIGN_NOT_FOUND]);
    });

    await scenario("c10", "strict-schema round trip through the real POST: customerIds only for picked, maxCards only when set, box as written; {endsAt:1} index, no TTL", async () => {
      const today = cafeDateString(new Date());
      const diner = await enrolled();
      const picked = await api.post({ name: "Picked", audience: "picked", customerIds: [idOf(diner)], maxCards: 7, startDay: today, endDay: today, box: BOX });
      const every = await api.post({ name: "Everyone", audience: "everyone", startDay: today, endDay: today, box: BOX });
      assert.deepEqual([picked.status, every.status], [201, 201], JSON.stringify([picked.body, every.body]));
      const rawOf = async (res: typeof picked) => (await RewardCampaign.collection.findOne({ _id: new mongoose.Types.ObjectId(((res.body.data as Rec).campaign as Rec).id as string) })) as Rec;
      const [p, e] = [await rawOf(picked), await rawOf(every)];
      assert.deepEqual((p.customerIds as mongoose.Types.ObjectId[]).map(String), [idOf(diner)]);
      assert.equal(p.maxCards, 7);
      assert.equal("customerIds" in e, false, "everyone stores no id array");
      assert.equal("maxCards" in e, false, "no budget stores no maxCards");
      assert.equal(e.issued, 0);
      assert.deepEqual(p.box, BOX, "box as written");
      assert.deepEqual(e.box, BOX);
      await RewardCampaign.init();
      const indexes = await dbIndexes();
      assert.ok(indexes.some((i) => JSON.stringify(i.key) === JSON.stringify({ endsAt: 1 })), `landmark: the endsAt index exists: ${JSON.stringify(indexes.map((i) => i.key))}`);
      assert.ok(indexes.every((i) => i.expireAfterSeconds === undefined), "no TTL index");
    });

    await scenario("c11", "the real scratch reveals a campaign card and the revealed DTO keeps the title", async () => {
      await newCampaign({ name: "Holi surprise" });
      const diner = await enrolled();
      const wallet = await read(diner);
      const ready = wallet?.cards[0];
      assert.ok(ready && ready.source === "campaign", "landmark: the card was issued");
      const out = await scratchRewardCard(settings, idOf(diner), ready.id, { ...REWARD_SCRATCH_DEPS, env: CLEAN_ENV });
      assert.ok(out.ok, JSON.stringify(out));
      assert.equal(out.card.status, "revealed");
      assert.equal((out.card as unknown as Rec).title, "Holi surprise");
      assert.equal(out.card.source, "campaign");
      const stored = (await heldOf(diner))[0];
      assert.equal(stored.status, "revealed");
      assert.equal(stored.title, "Holi surprise");
    });
  } finally {
    await Promise.allSettled(Object.values(mongoose.models).map((model) => model.init()));
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
