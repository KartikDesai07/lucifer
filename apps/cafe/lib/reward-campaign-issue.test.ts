import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";

import type { ISettings } from "@/models/Settings";
import {
  issueCampaignCards,
  type CampaignRow,
  type IssueWallet,
  type RewardCampaignIssueDeps,
} from "@/lib/reward-campaign-issue";
import {
  ACTIVE_CAMPAIGNS_LIMIT,
  RELEASE_UPDATE,
  RESERVE_UPDATE,
  activeCampaignsFilter,
  pushFilter,
  pushUpdate,
  reserveFilter,
} from "@/lib/reward-campaign-issue-plan";
import { CAMPAIGNS_ACTIVE_MAX, campaignIssueKey } from "@pos/shared/reward-campaigns";
import { REWARD_CARDS_KEEP, SCRATCH_BLOCK_ENV_VAR, type RewardLevelsConfig } from "@pos/shared/reward-levels";

// CB-7 S6 session 3: the festival-card issue step over FAKE deps. Every dep call lands in one ordered log, so the tests can
// say "no reserve", "exactly one release" and "no compensation after a throw" as plain assertions. The filters and updates
// the real deps run are pinned shape by shape against the pure plan.

const CUSTOMER_ID = "64b7f0c2a1b2c3d4e5f60718";
const CAMP_A = "64b7f0c2a1b2c3d4e5f60a01";
const CAMP_B = "64b7f0c2a1b2c3d4e5f60a02";
const CARD_ID = "0123456789ab";
const NOW = new Date("2026-10-12T06:00:00.000Z");
const ANCHOR = new Date("2026-10-01T10:00:00.000Z");
const BOX = { scratchDays: 7, useDays: 14, options: [{ kind: "none", id: "a", weight: 1 }] };
const LEVELS: RewardLevelsConfig = {
  v: 1,
  enabled: true,
  levels: [{ size: 3, slots: [{ step: 3, scratchDays: 7, useDays: 14, options: [{ kind: "none", id: "a", weight: 1 }] }] }],
};
const settingsOf = (o: Record<string, unknown>): ISettings => o as unknown as ISettings;
const envOf = (o: Record<string, string>): NodeJS.ProcessEnv => o as unknown as NodeJS.ProcessEnv;
const ON = settingsOf({ dinerAccountsEnabled: true, rewardLevels: LEVELS, gstNumber: "27ABCDE1234F1Z5" });
const OFF = settingsOf({ dinerAccountsEnabled: true, rewardLevels: { ...LEVELS, enabled: false }, gstNumber: "27ABCDE1234F1Z5" });

const row = (id: string, name: string, box: unknown = BOX): CampaignRow => ({ _id: new Types.ObjectId(id), name, box });
const ANCHORED: IssueWallet = { rewardsAnchorAt: ANCHOR };

interface Script {
  rows?: CampaignRow[];
  reserve?: number[]; // matchedCount per reserve call, in order
  push?: (number | "throw")[]; // matchedCount (or a throw) per push call, in order
}

interface Fake {
  deps: RewardCampaignIssueDeps;
  log: string[]; // "find" | "reserve:<id>" | "push" | "release:<id>"
  pushes: { filter: Record<string, unknown>; update: Record<string, unknown> }[];
}

// A dep that is not scripted (or has run out of answers) THROWS, so an unexpected extra call fails loudly.
function fakeDeps(script: Script, env: NodeJS.ProcessEnv = envOf({})): Fake {
  const log: string[] = [];
  const pushes: Fake["pushes"] = [];
  const reserve = [...(script.reserve ?? [])];
  const push = [...(script.push ?? [])];
  const deps: RewardCampaignIssueDeps = {
    findActive: async () => {
      log.push("find");
      return script.rows ?? [];
    },
    reserve: async (id) => {
      log.push(`reserve:${id}`);
      const next = reserve.shift();
      if (next === undefined) throw new Error("unscripted reserve");
      return { matchedCount: next };
    },
    pushCard: async (filter, update) => {
      log.push("push");
      pushes.push({ filter, update });
      const next = push.shift();
      if (next === undefined) throw new Error("unscripted push");
      if (next === "throw") throw new Error("push failed");
      return { matchedCount: next };
    },
    release: async (id) => {
      log.push(`release:${id}`);
    },
    rng: () => 0,
    newCardId: () => CARD_ID,
    now: () => NOW,
    env,
  };
  return { deps, log, pushes };
}

test("gate: not earning (switched off) -> nothing issued and no campaign read", async () => {
  const fake = fakeDeps({ rows: [row(CAMP_A, "Diwali")] });
  assert.equal(await issueCampaignCards(OFF, CUSTOMER_ID, ANCHORED, fake.deps), 0);
  assert.equal(await issueCampaignCards(null, CUSTOMER_ID, ANCHORED, fake.deps), 0);
  assert.deepEqual(fake.log, []);
});

test("gate: the platform block (env switch) and a Tamil Nadu GSTIN both stop it (fork O4)", async () => {
  const blocked = fakeDeps({ rows: [row(CAMP_A, "Diwali")] }, envOf({ [SCRATCH_BLOCK_ENV_VAR]: "1" }));
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, ANCHORED, blocked.deps), 0);
  const tn = fakeDeps({ rows: [row(CAMP_A, "Diwali")] });
  const tnSettings = settingsOf({ dinerAccountsEnabled: true, rewardLevels: LEVELS, gstNumber: "33ABCDE1234F1Z5" });
  assert.equal(await issueCampaignCards(tnSettings, CUSTOMER_ID, ANCHORED, tn.deps), 0);
  assert.deepEqual([...blocked.log, ...tn.log], []);
  // landmark: the same wallet DOES issue when nothing blocks
  const open = fakeDeps({ rows: [row(CAMP_A, "Diwali")], reserve: [1], push: [1] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, ANCHORED, open.deps), 1);
});

test("programme: no anchor and no PIN -> nothing; a PIN alone (pinSetAt) is enough", async () => {
  const none = fakeDeps({ rows: [row(CAMP_A, "Diwali")] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, {}, none.deps), 0);
  assert.deepEqual(none.log, []);
  const pin = fakeDeps({ rows: [row(CAMP_A, "Diwali")], reserve: [1], push: [1] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, { pinSetAt: ANCHOR }, pin.deps), 1);
});

test("already held: a wallet that holds camp:<id> is skipped before any reserve", async () => {
  const fake = fakeDeps({ rows: [row(CAMP_A, "Diwali")] });
  const wallet: IssueWallet = {
    ...ANCHORED,
    rewardCards: [
      { issueKey: campaignIssueKey(CAMP_A), keepUntil: NOW },
      { issueKey: "step:3", keepUntil: NOW },
    ],
  };
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, wallet, fake.deps), 0);
  assert.deepEqual(fake.log, ["find"]);
});

// Review lens A LOW-1: the push sorts by keepUntil and keeps the last REWARD_CARDS_KEEP, so a wallet already full of cards
// that all end at or after the new card would slice it off in the SAME update - the push still "matches", so without this
// check every load would spend one card of the budget and deliver nothing.
test("full wallet: REWARD_CARDS_KEEP cards ending at or after the new card -> skipped before any reserve", async () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const later = new Date(NOW.getTime() + 30 * dayMs); // BOX gives 7 days to scratch, so these all outlive the new card
  const earlier = new Date(NOW.getTime() + dayMs);
  const full = Array.from({ length: REWARD_CARDS_KEEP }, (_, i) => ({ issueKey: `step:${String(i + 1)}`, keepUntil: later }));

  const fake = fakeDeps({ rows: [row(CAMP_A, "Diwali")] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, { ...ANCHORED, rewardCards: full }, fake.deps), 0);
  assert.deepEqual(fake.log, ["find"]);

  // Landmarks: one card fewer, or one full-wallet card that ends EARLIER (the slice drops that one), still issues.
  const room = fakeDeps({ rows: [row(CAMP_A, "Diwali")], reserve: [1], push: [1] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, { ...ANCHORED, rewardCards: full.slice(1) }, room.deps), 1);
  const older = [...full.slice(1), { issueKey: "step:99", keepUntil: earlier }];
  const drop = fakeDeps({ rows: [row(CAMP_A, "Diwali")], reserve: [1], push: [1] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, { ...ANCHORED, rewardCards: older }, drop.deps), 1);
});

// Fix-round review LOW: a card pushed earlier in the SAME load counts toward the full wallet, else two campaigns on a wallet one
// short of full would both reserve and push, and the slice would drop one of the two (a spent budget, no card).
test("full wallet within one load: the card just pushed counts, so a second campaign that would be sliced off is skipped", async () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const later = new Date(NOW.getTime() + 30 * dayMs);
  const almost = Array.from({ length: REWARD_CARDS_KEEP - 1 }, (_, i) => ({ issueKey: `step:${String(i + 1)}`, keepUntil: later }));
  const fake = fakeDeps({ rows: [row(CAMP_A, "Diwali"), row(CAMP_B, "Pongal")], reserve: [1], push: [1] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, { ...ANCHORED, rewardCards: almost }, fake.deps), 1);
  assert.deepEqual(fake.log, ["find", `reserve:${CAMP_A}`, "push"]);
  // Landmark: with room for both, both issue.
  const room = fakeDeps({ rows: [row(CAMP_A, "Diwali"), row(CAMP_B, "Pongal")], reserve: [1, 1], push: [1, 1] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, { ...ANCHORED, rewardCards: almost.slice(1) }, room.deps), 2);
});

test("unreadable box: the campaign is skipped (no reserve, no throw) and the next one still issues", async () => {
  const fake = fakeDeps({ rows: [row(CAMP_A, "Broken", { junk: true }), row(CAMP_B, "Pongal")], reserve: [1], push: [1] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, ANCHORED, fake.deps), 1);
  assert.deepEqual(fake.log, ["find", `reserve:${CAMP_B}`, "push"]);
});

test("reserve miss (budget gone or ended): no push and nothing to give back", async () => {
  const fake = fakeDeps({ rows: [row(CAMP_A, "Diwali")], reserve: [0] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, ANCHORED, fake.deps), 0);
  assert.deepEqual(fake.log, ["find", `reserve:${CAMP_A}`]);
});

test("push miss: exactly ONE $inc -1 goes back, and the count is 0", async () => {
  const fake = fakeDeps({ rows: [row(CAMP_A, "Diwali")], reserve: [1], push: [0] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, ANCHORED, fake.deps), 0);
  assert.deepEqual(fake.log, ["find", `reserve:${CAMP_A}`, "push", `release:${CAMP_A}`]);
});

test("push throw: NO compensation, the function still resolves (the wallet must still load)", async () => {
  const fake = fakeDeps({ rows: [row(CAMP_A, "Diwali"), row(CAMP_B, "Pongal")], reserve: [1], push: ["throw"] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, ANCHORED, fake.deps), 0);
  assert.deepEqual(fake.log, ["find", `reserve:${CAMP_A}`, "push"]);
});

test("a throw after a pushed card still counts the card that landed", async () => {
  const fake = fakeDeps({ rows: [row(CAMP_A, "Diwali"), row(CAMP_B, "Pongal")], reserve: [1, 1], push: [1, "throw"] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, ANCHORED, fake.deps), 1);
  assert.equal(fake.log.some((entry) => entry.startsWith("release:")), false);
});

test("two campaigns -> two cards, one per issueKey, each reserved before its own push", async () => {
  const fake = fakeDeps({ rows: [row(CAMP_A, "Diwali"), row(CAMP_B, "Pongal")], reserve: [1, 1], push: [1, 1] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, ANCHORED, fake.deps), 2);
  assert.deepEqual(fake.log, ["find", `reserve:${CAMP_A}`, "push", `reserve:${CAMP_B}`, "push"]);
  assert.deepEqual(fake.pushes.map((p) => p.filter["rewardCards.issueKey"]), [
    { $ne: campaignIssueKey(CAMP_A) },
    { $ne: campaignIssueKey(CAMP_B) },
  ]);
});

test("budget race: two callers, one budget - the second caller's reserve misses and it pushes nothing", async () => {
  const first = fakeDeps({ rows: [row(CAMP_A, "Diwali")], reserve: [1], push: [1] });
  const second = fakeDeps({ rows: [row(CAMP_A, "Diwali")], reserve: [0] });
  assert.equal(await issueCampaignCards(ON, CUSTOMER_ID, ANCHORED, first.deps), 1);
  assert.equal(await issueCampaignCards(ON, "64b7f0c2a1b2c3d4e5f60719", ANCHORED, second.deps), 0);
  assert.equal(second.pushes.length, 0);
});

test("the card pushed: campaign source, issueKey, campaignId, title, no level/step, status ready, issued at the one clock reading", async () => {
  const fake = fakeDeps({ rows: [row(CAMP_A, "Diwali treat")], reserve: [1], push: [1] });
  await issueCampaignCards(ON, CUSTOMER_ID, ANCHORED, fake.deps);
  const update = fake.pushes[0].update as ReturnType<typeof pushUpdate>;
  const each = (update.$push as { rewardCards: { $each: Record<string, unknown>[] } }).rewardCards.$each;
  assert.equal(each.length, 1);
  const card = each[0];
  assert.equal(card.id, CARD_ID);
  assert.equal(card.issueKey, campaignIssueKey(CAMP_A));
  assert.equal(card.source, "campaign");
  assert.equal(card.campaignId, CAMP_A);
  assert.equal(card.title, "Diwali treat");
  assert.equal(card.status, "ready");
  assert.equal("level" in card, false);
  assert.equal("step" in card, false);
  assert.equal((card.issuedAt as Date).getTime(), NOW.getTime());
  assert.deepEqual(fake.pushes[0].update, pushUpdate(card as never));
});

// ── The exact shapes the real deps run ─────────────────────────────────────────────────────────────────────────────
test("shape: the active-campaign filter covers the window (inclusive) and everyone OR this picked diner", () => {
  assert.deepEqual(activeCampaignsFilter(CUSTOMER_ID, NOW), {
    startsAt: { $lte: NOW },
    endsAt: { $gte: NOW },
    $or: [{ audience: "everyone" }, { customerIds: new Types.ObjectId(CUSTOMER_ID) }],
  });
  assert.equal(ACTIVE_CAMPAIGNS_LIMIT, CAMPAIGNS_ACTIVE_MAX);
});

test("shape: the reservation re-checks the window and the budget in ONE guarded $inc", () => {
  assert.deepEqual(reserveFilter(CAMP_A, NOW), {
    _id: CAMP_A,
    startsAt: { $lte: NOW },
    endsAt: { $gte: NOW },
    $or: [{ maxCards: { $exists: false } }, { $expr: { $lt: ["$issued", "$maxCards"] } }],
  });
  assert.deepEqual(RESERVE_UPDATE, { $inc: { issued: 1 } });
  assert.deepEqual(RELEASE_UPDATE, { $inc: { issued: -1 } });
});

test("shape: the push is guarded on issueKey and on anchor-or-PIN, sorted by keepUntil and capped", () => {
  const key = campaignIssueKey(CAMP_A);
  assert.deepEqual(pushFilter(CUSTOMER_ID, key), {
    _id: CUSTOMER_ID,
    "rewardCards.issueKey": { $ne: key },
    $or: [{ rewardsAnchorAt: { $exists: true } }, { pinHash: { $exists: true } }],
  });
  const stub = { id: CARD_ID } as never;
  assert.deepEqual(pushUpdate(stub), {
    $push: { rewardCards: { $each: [stub], $sort: { keepUntil: 1 }, $slice: -REWARD_CARDS_KEEP } },
  });
});
