import {
  LOYALTY_MIN_BILL_DEFAULT,
  LOYALTY_REWARD_KIND_DEFAULT,
  LOYALTY_REWARD_VALUE_DEFAULT,
  LOYALTY_STAMPS_DEFAULT,
  rewardsAvailable,
  stampsRemaining,
  type LoyaltyRewardKind,
} from "@pos/shared/public-diner";
import {
  ladderOf,
  ladderProgress,
  LOYALTY_UNIT_LABEL_DEFAULT,
  type LoyaltyLadder,
  type ResolvedMilestone,
} from "@pos/shared/loyalty-rules";
import type { ISettings } from "@/models/Settings";

// CB-4 / CB-5A S3 — the stamp-card rules, resolved from Settings ONCE and then
// read as a plain value object. Pure: no DB, no React, so the earn/redeem
// paths and the diner-facing read all reason about the same numbers.
//
// CB-5A adds the milestone-ladder ALONGSIDE the
// original 5 flat fields — never replacing them. When `settings.loyaltyRules`
// is absent, this derives a LEGACY one-milestone ladder from the flat fields
// (see resolveLoyaltyConfig below): with exactly one milestone,
// `ladder.cycleLength === stampsPerReward`, so `ladderProgress`'s
// modulo/floor math is arithmetically identical to the original
// `stampsRemaining`/`rewardsAvailable` calls. That equivalence is why every
// pre-CB-5A pin in diner-loyalty.test.ts still passes unchanged.

export interface LoyaltyConfig {
  stampsPerReward: number;
  // RUPEES. The earn site compares this against the v1 `models/Order.ts` total,
  // which is a plain rupee Number — the Int32 PAISE shape lives on
  // `models/order.ledger.ts` and the settle path never reads it. Do NOT
  // "convert" this to paise: doing so makes every bill (or no bill) qualify.
  // When P5's Customer v:2 paise migration lands, this flips WITH it.
  minBill: number;
  rewardKind: LoyaltyRewardKind;
  rewardValue: number;
  rewardItem: string;
  ladder: LoyaltyLadder;
  unitLabel: string;
}

// "Absent means the documented default" resolved in exactly ONE place (the
// discipline printConfigOf and resolveAppearance already model), so a cafe
// whose Settings doc predates CB-4 (or CB-5A) reads identically to one that
// saved the defaults explicitly.
export function resolveLoyaltyConfig(settings: ISettings | null): LoyaltyConfig {
  const rules = settings?.loyaltyRules;

  if (rules === null || typeof rules !== "object") {
    // No loyaltyRules doc at all: derive a ONE-MILESTONE ladder from the flat
    // fields rather than an empty one. An empty ladder has cycleLength 0 (see
    // ladderProgress), which would zero out every legacy diner's progress —
    // this branch exists so that never happens.
    const ladder = ladderOf([
      {
        at: settings?.loyaltyStampsPerReward ?? LOYALTY_STAMPS_DEFAULT,
        kind: settings?.loyaltyRewardKind ?? LOYALTY_REWARD_KIND_DEFAULT,
        value: settings?.loyaltyRewardValue ?? LOYALTY_REWARD_VALUE_DEFAULT,
        item: settings?.loyaltyRewardItem ?? "",
        // Deliberately NO per-milestone minBill here — the global
        // `loyaltyMinBill` below governs accrual for the legacy shape.
      },
    ]);
    return {
      stampsPerReward: settings?.loyaltyStampsPerReward ?? LOYALTY_STAMPS_DEFAULT,
      minBill: settings?.loyaltyMinBill ?? LOYALTY_MIN_BILL_DEFAULT,
      rewardKind: settings?.loyaltyRewardKind ?? LOYALTY_REWARD_KIND_DEFAULT,
      rewardValue: settings?.loyaltyRewardValue ?? LOYALTY_REWARD_VALUE_DEFAULT,
      rewardItem: settings?.loyaltyRewardItem ?? "",
      ladder,
      unitLabel: LOYALTY_UNIT_LABEL_DEFAULT,
    };
  }

  // loyaltyRules is present: it WINS over the flat fields for the
  // ladder-derived values. `|| ` (not `??`) is deliberate here ONLY:
  // cycleLength 0 means "no ladder configured at all" (an empty milestones
  // array), never a configured 0 — a ladder can't legitimately cycle every 0
  // stamps, so falling back to the flat/default stampsPerReward is correct.
  //
  // FIX D — TOTAL against a present-but-PARTIAL stored doc (hand-edited/ops-
  // written; the only write path, updateSettingsSchema, requires every key,
  // but this function has no such guarantee). Sibling lib/loyalty-rules-form.ts
  // treats the same stored value as Partial<> — mirror its defensive reads.
  const ladder = ladderOf(rules.milestones ?? []);
  const stampsPerReward = ladder.cycleLength || (settings?.loyaltyStampsPerReward ?? LOYALTY_STAMPS_DEFAULT);
  const lastMilestone = ladder.milestones[ladder.milestones.length - 1];

  return {
    stampsPerReward,
    // KEEPS reading the flat field even when loyaltyRules is present:
    // minBill is a GLOBAL accrual gate, not part of the ladder contract.
    // `??`, never `||` — a configured 0 ("stamp every bill") must survive.
    minBill: settings?.loyaltyMinBill ?? LOYALTY_MIN_BILL_DEFAULT,
    rewardKind: lastMilestone?.kind ?? settings?.loyaltyRewardKind ?? LOYALTY_REWARD_KIND_DEFAULT,
    rewardValue: lastMilestone?.value ?? settings?.loyaltyRewardValue ?? LOYALTY_REWARD_VALUE_DEFAULT,
    rewardItem: lastMilestone?.item ?? settings?.loyaltyRewardItem ?? "",
    ladder,
    unitLabel: rules.unitLabel ?? LOYALTY_UNIT_LABEL_DEFAULT,
  };
}

// Whether ONE settled bill earns a stamp. Deliberately `>=`: an owner who sets
// "minimum bill 100" means a Rs 100 bill qualifies, and an off-by-one here is
// invisible until a diner argues about it at the counter.
//
// UNCHANGED by CB-5A on purpose: a per-milestone `minBill` (ResolvedMilestone)
// is stored config consumed at CB-5B REDEMPTION time (which reward a diner
// can claim), never at ACCRUAL time (whether a bill earns a stamp at all).
// Gating accrual on it would change what a live diner earns today — the one
// thing this slice must not do.
export function billEarnsStamp(billTotal: number, config: LoyaltyConfig): boolean {
  return billTotal >= config.minBill;
}

export interface DinerStampCard {
  stamps: number;
  stampsPerReward: number;
  // Stamps still needed to complete the CURRENT card.
  toNextReward: number;
  // Whole rewards the diner can claim right now.
  rewardsReady: number;
  lifetime: number;
  reward: { kind: LoyaltyRewardKind; value: number; item: string };
  ladder: readonly ResolvedMilestone[];
  cyclePosition: number;
  reachedThisCycle: number;
  unitLabel: string;
}

// What the diner's Rewards tab renders. Derived on READ rather than stored, so
// an owner retuning stampsPerReward never has to migrate anyone's card — but
// note the counters themselves (stamps/stampsLifetime) ARE stored, so a
// retune can never rewrite what someone has already earned.
export function dinerStampCard(
  stamps: number,
  lifetime: number,
  config: LoyaltyConfig,
): DinerStampCard {
  // toNextReward/rewardsReady keep calling the ORIGINAL CB-4 helpers rather
  // than being re-derived from ladderProgress — that is how the pre-CB-5A
  // pins on this shape stay green even though a ladder now exists alongside.
  const progress = ladderProgress(stamps, config.ladder);

  // FIX C — an owner who deletes every milestone row (ladder.milestones.length
  // === 0) must never have this claim a reward off the stale flat fields:
  // stampsPerReward still falls back to the flat/default value even with an
  // empty ladder (see resolveLoyaltyConfig's `||` fallback above), so
  // stampsRemaining/rewardsAvailable would otherwise promise a reward the
  // owner explicitly deleted.
  const ladderEmpty = config.ladder.milestones.length === 0;

  return {
    stamps,
    stampsPerReward: config.stampsPerReward,
    toNextReward: ladderEmpty ? 0 : stampsRemaining(stamps, config.stampsPerReward),
    rewardsReady: ladderEmpty ? 0 : rewardsAvailable(stamps, config.stampsPerReward),
    lifetime,
    reward: { kind: config.rewardKind, value: config.rewardValue, item: config.rewardItem },
    ladder: config.ladder.milestones,
    cyclePosition: progress.cyclePosition,
    reachedThisCycle: progress.reachedThisCycle,
    unitLabel: config.unitLabel,
  };
}
