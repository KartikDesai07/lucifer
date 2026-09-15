import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LOYALTY_MIN_BILL_DEFAULT,
  LOYALTY_REWARD_KIND_DEFAULT,
  LOYALTY_REWARD_VALUE_DEFAULT,
  LOYALTY_STAMPS_DEFAULT,
} from "@pos/shared/public-diner";
import { billEarnsStamp, dinerStampCard, resolveLoyaltyConfig } from "@/lib/diner-loyalty";
import type { ISettings } from "@/models/Settings";
import type { LoyaltyMilestoneInput, LoyaltyRulesInput } from "@pos/shared/schemas/settings-loyalty.schema";
import { LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";

// CB-4 — the stamp-card rules. DB-free: resolveLoyaltyConfig takes a settings
// shape, so the whole ruleset is unit-testable without Mongo.

// A settings stand-in. Cast once here rather than in every test — ISettings is
// a Mongoose Document type and these tests only ever read the CB-4 fields.
function settings(over: Partial<ISettings> = {}): ISettings {
  return over as ISettings;
}

// CB-5A S3 — a loyaltyRules fixture builder. `milestones` is the only knob
// most of these tests need; the rest default to "feature not opted into".
function loyaltyRules(milestones: LoyaltyMilestoneInput[], over: Partial<LoyaltyRulesInput> = {}): LoyaltyRulesInput {
  return {
    v: LOYALTY_RULES_SCHEMA_VERSION,
    unitLabel: "stamp",
    milestones,
    ...over,
  };
}

function milestone(at: number, over: Partial<LoyaltyMilestoneInput> = {}): LoyaltyMilestoneInput {
  return { at, kind: "flat", value: 50, item: "", ...over };
}

test("resolveLoyaltyConfig falls back to the documented defaults for a pre-CB-4 Settings doc (every key absent)", () => {
  // This is the real shape of every existing cafe's document — none of them
  // carry these keys, and a null settings read must behave the same way.
  const config = resolveLoyaltyConfig(settings());
  assert.equal(config.stampsPerReward, LOYALTY_STAMPS_DEFAULT);
  assert.equal(config.minBill, LOYALTY_MIN_BILL_DEFAULT);
  assert.equal(config.rewardKind, LOYALTY_REWARD_KIND_DEFAULT);
  assert.equal(config.rewardValue, LOYALTY_REWARD_VALUE_DEFAULT);
  assert.equal(config.rewardItem, "");
});

test("resolveLoyaltyConfig(null) is identical to an empty settings doc — a failed read must never look like a configured cafe", () => {
  assert.deepEqual(resolveLoyaltyConfig(null), resolveLoyaltyConfig(settings()));
});

test("resolveLoyaltyConfig honours every configured value", () => {
  const config = resolveLoyaltyConfig(
    settings({
      loyaltyStampsPerReward: 5,
      loyaltyMinBill: 250,
      loyaltyRewardKind: "percent",
      loyaltyRewardValue: 15,
      loyaltyRewardItem: "Cold coffee",
    }),
  );
  assert.equal(config.stampsPerReward, 5);
  assert.equal(config.minBill, 250);
  assert.equal(config.rewardKind, "percent");
  assert.equal(config.rewardValue, 15);
  assert.equal(config.rewardItem, "Cold coffee");
});

test("resolveLoyaltyConfig keeps a configured 0 minimum bill — 0 means 'stamp every bill', NOT 'unset'", () => {
  // A `||` fallback instead of `??` would silently turn this into 100.
  assert.equal(resolveLoyaltyConfig(settings({ loyaltyMinBill: 0 })).minBill, 0);
});

test("billEarnsStamp is INCLUSIVE at the minimum — a bill exactly equal to the minimum earns a stamp", () => {
  // An owner who sets "minimum 100" means a Rs 100 bill qualifies. An
  // off-by-one here is invisible until a diner argues about it at the counter.
  const config = resolveLoyaltyConfig(settings({ loyaltyMinBill: 100 }));
  assert.equal(billEarnsStamp(100, config), true);
  assert.equal(billEarnsStamp(99, config), false);
  assert.equal(billEarnsStamp(101, config), true);
});

test("billEarnsStamp compares RUPEES to RUPEES — a Rs 150 bill against a Rs 100 minimum qualifies with no x100 conversion", () => {
  // GUARD AGAINST A REAL 100x BUG: the settle route reads models/Order.ts,
  // whose `total` is a plain rupee Number. The Int32 PAISE shape lives on
  // models/order.ledger.ts and that path never touches it. If anyone ever
  // "fixes" the unit by multiplying, this fails — as it should.
  const config = resolveLoyaltyConfig(settings({ loyaltyMinBill: 100 }));
  assert.equal(billEarnsStamp(150, config), true, "150 rupees >= 100 rupees");
  assert.equal(billEarnsStamp(50, config), false, "50 rupees < 100 rupees");
});

test("dinerStampCard shows progress within the CURRENT card, not the lifetime total", () => {
  const config = resolveLoyaltyConfig(settings({ loyaltyStampsPerReward: 8 }));
  // 18 stamps on an 8-card = 2 completed cards and 2 into the third.
  const card = dinerStampCard(18, 18, config);
  assert.equal(card.rewardsReady, 2);
  assert.equal(card.toNextReward, 6, "6 more stamps completes the third card");
});

test("dinerStampCard reports a freshly completed card as a ready reward", () => {
  const config = resolveLoyaltyConfig(settings({ loyaltyStampsPerReward: 8 }));
  const card = dinerStampCard(8, 8, config);
  assert.equal(card.rewardsReady, 1);
  assert.equal(card.toNextReward, 8, "a completed card starts the next one fresh");
});

test("dinerStampCard on a brand-new diner is all zeros, never NaN", () => {
  const config = resolveLoyaltyConfig(settings());
  const card = dinerStampCard(0, 0, config);
  assert.equal(card.stamps, 0);
  assert.equal(card.rewardsReady, 0);
  assert.equal(card.toNextReward, LOYALTY_STAMPS_DEFAULT);
  assert.equal(Number.isNaN(card.toNextReward), false);
});

test("dinerStampCard carries the reward's kind/value/item through for the diner-facing copy", () => {
  const config = resolveLoyaltyConfig(
    settings({ loyaltyRewardKind: "item", loyaltyRewardItem: "Any regular coffee" }),
  );
  const card = dinerStampCard(3, 3, config);
  assert.equal(card.reward.kind, "item");
  assert.equal(card.reward.item, "Any regular coffee");
});

// ── CB-5A S3 — the milestone-ladder extension ───────────────────────────────

test("resolveLoyaltyConfig derives a single-milestone ladder from the flat fields when loyaltyRules is absent", () => {
  const config = resolveLoyaltyConfig(settings({ loyaltyStampsPerReward: 8 }));
  assert.equal(config.ladder.cycleLength, 8);
  assert.equal(config.ladder.milestones.length, 1);
  assert.equal(config.ladder.milestones[0]?.at, 8);
});

test("EQUIVALENCE PIN — a flat-fields cafe and an equivalent explicit one-milestone loyaltyRules produce byte-identical stamp cards", () => {
  // This is the proof the whole migration rests on: a live cafe with no
  // loyaltyRules doc must read EXACTLY like one that "opted in" to a ladder
  // shaped like its own flat settings.
  const flatSettings = settings({
    loyaltyStampsPerReward: 18,
    loyaltyMinBill: 100,
    loyaltyRewardKind: "flat",
    loyaltyRewardValue: 50,
    loyaltyRewardItem: "",
  });
  const rulesSettings = settings({
    loyaltyMinBill: 100,
    loyaltyRules: loyaltyRules([milestone(18, { kind: "flat", value: 50, item: "" })]),
  });
  const flatCard = dinerStampCard(18, 18, resolveLoyaltyConfig(flatSettings));
  const rulesCard = dinerStampCard(18, 18, resolveLoyaltyConfig(rulesSettings));
  assert.deepEqual(flatCard, rulesCard);
});

test("ladderProgress via dinerStampCard: an explicit [5,8,10] ladder at 7 stamps reports cyclePosition 7, reachedThisCycle 1, nextAt 8, toNext 1", () => {
  const config = resolveLoyaltyConfig(
    settings({ loyaltyRules: loyaltyRules([milestone(5), milestone(8), milestone(10)]) }),
  );
  const at7 = dinerStampCard(7, 7, config);
  assert.equal(at7.cyclePosition, 7);
  assert.equal(at7.reachedThisCycle, 1);
  // toNextReward/rewardsReady stay CB-4's own metric (cycleLength=10, the
  // LAST milestone's `at`) — the ladder's own nextAt/toNext are a SEPARATE
  // pair of numbers, checked here via the ladder milestones directly.
  const upcoming = config.ladder.milestones.find((m) => m.at > at7.cyclePosition);
  assert.equal(upcoming?.at, 8, "nextAt");
  assert.equal((upcoming?.at ?? 0) - at7.cyclePosition, 1, "toNext");
});

test("ladderProgress via dinerStampCard: stamps land exactly on a milestone (10) reset cyclePosition to 0 for a completed cycle", () => {
  const config = resolveLoyaltyConfig(
    settings({ loyaltyRules: loyaltyRules([milestone(5), milestone(8), milestone(10)]) }),
  );
  const card = dinerStampCard(10, 10, config);
  assert.equal(card.cyclePosition, 0);
});

test("ladderProgress via dinerStampCard: 23 stamps on a cycleLength-10 ladder completes 2 cycles with 3 left over", () => {
  const config = resolveLoyaltyConfig(
    settings({ loyaltyRules: loyaltyRules([milestone(5), milestone(8), milestone(10)]) }),
  );
  const card = dinerStampCard(23, 23, config);
  assert.equal(card.cyclePosition, 3);
});

test("0 milestones (an explicitly empty ladder) produces zeros everywhere, never NaN", () => {
  const config = resolveLoyaltyConfig(settings({ loyaltyRules: loyaltyRules([]) }));
  assert.equal(config.ladder.cycleLength, 0);
  const card = dinerStampCard(5, 5, config);
  assert.equal(card.cyclePosition, 0);
  assert.equal(card.reachedThisCycle, 0);
  assert.equal(Number.isNaN(card.cyclePosition), false);
  assert.equal(Number.isNaN(card.reachedThisCycle), false);
});

test("when loyaltyRules is present, minBill STILL comes from the flat loyaltyMinBill field, not from the ladder", () => {
  const config = resolveLoyaltyConfig(
    settings({ loyaltyMinBill: 250, loyaltyRules: loyaltyRules([milestone(8)]) }),
  );
  assert.equal(config.minBill, 250);
});

test("a configured loyaltyMinBill: 0 survives even when loyaltyRules is present — the `??` guard applies on both resolution paths", () => {
  const config = resolveLoyaltyConfig(
    settings({ loyaltyMinBill: 0, loyaltyRules: loyaltyRules([milestone(8)]) }),
  );
  assert.equal(config.minBill, 0);
});

// ── CB-5A FIX D — resolveLoyaltyConfig must be TOTAL against a present but
// partially-shaped stored loyaltyRules (hand-edited/ops-written doc). The
// only write path (updateSettingsSchema) requires every key, and the settle
// route fences this behind a try/catch — but GET /api/public/diner/me calls
// it unguarded, so a partial doc must never throw here.
test("PIN: resolveLoyaltyConfig does not throw on a present-but-PARTIAL loyaltyRules (missing milestones, unitLabel)", () => {
  const partialRules = { v: 1 } as unknown as LoyaltyRulesInput;
  assert.doesNotThrow(() => {
    const config = resolveLoyaltyConfig(settings({ loyaltyRules: partialRules }));
    assert.equal(typeof config.unitLabel, "string");
  });
});

test("PIN: loyaltyStampsPerReward: 0 stays TOTAL — no NaN from dinerStampCard/billEarnsStamp/ladder math", () => {
  const config = resolveLoyaltyConfig(settings({ loyaltyStampsPerReward: 0 }));
  const card = dinerStampCard(0, 0, config);
  assert.equal(Number.isNaN(card.toNextReward), false);
  assert.equal(Number.isNaN(card.rewardsReady), false);
  assert.equal(Number.isNaN(card.cyclePosition), false);
});

test("a per-milestone minBill does NOT affect billEarnsStamp — that field is CB-5B redemption config, not an accrual gate", () => {
  const config = resolveLoyaltyConfig(
    settings({
      loyaltyMinBill: 100,
      loyaltyRules: loyaltyRules([milestone(8, { minBill: 5000 })]),
    }),
  );
  // The milestone's own minBill (5000) would fail this bill if it gated
  // accrual; only the flat loyaltyMinBill (100) may do that.
  assert.equal(billEarnsStamp(150, config), true, "150 >= the flat 100 minBill, ignoring the milestone's 5000");
});

// ── CB-5A FIX C — an empty ladder must never promise a reward ──────────────
// An owner who deletes every milestone row (Zod allows milestones: []) still
// has stale flat fields on the doc. Without an explicit guard, ladderProgress
// on a 0-cycleLength ladder makes rewardsAvailable/stampsRemaining (which key
// off config.stampsPerReward, itself falling back to the flat field) claim a
// reward the owner never configured. A diner must never reach the counter
// holding a promise the cafe deleted.
test("PIN: dinerStampCard with an EMPTY ladder never claims a ready or upcoming reward, even with stale flat fields still on the doc", () => {
  const config = resolveLoyaltyConfig(
    settings({
      loyaltyStampsPerReward: 8,
      loyaltyRewardKind: "flat",
      loyaltyRewardValue: 50,
      loyaltyRules: loyaltyRules([]),
    }),
  );
  assert.equal(config.ladder.milestones.length, 0, "sanity: the ladder really is empty");
  const at5 = dinerStampCard(5, 5, config);
  assert.equal(at5.rewardsReady, 0, "an empty ladder must never say a reward is ready");
  assert.equal(at5.toNextReward, 0, "an empty ladder must never promise a next reward at some count");

  const at8 = dinerStampCard(8, 8, config);
  assert.equal(at8.rewardsReady, 0, "hitting the stale stampsPerReward count must still not claim a reward");
  assert.equal(at8.toNextReward, 0);
});
