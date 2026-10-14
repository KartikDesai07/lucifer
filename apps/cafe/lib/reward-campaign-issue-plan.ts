import { Types } from "mongoose";
import { CAMPAIGNS_ACTIVE_MAX } from "@pos/shared/reward-campaigns";
import { REWARD_CARDS_KEEP, type RewardCardSnapshot } from "@pos/shared/reward-levels";

// CB-7 S6 session 3 (plan section 2.8) - the PURE half of the festival-card issue step: the exact filters and updates the
// IO half (lib/reward-campaign-issue.ts) runs. Kept apart so the tests can deepEqual every shape. SERVER-ONLY (builds
// ObjectIds from mongoose; registered in client-graph-guard.test.ts).

// The campaigns this diner may get a card from RIGHT NOW: inside the window (inclusive, the same instants
// campaignStatusAt uses), either every diner or this one picked.
export function activeCampaignsFilter(customerId: string, now: Date): Record<string, unknown> {
  return {
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    $or: [{ audience: "everyone" }, { customerIds: new Types.ObjectId(customerId) }],
  };
}
export const ACTIVE_CAMPAIGNS_SORT = { startsAt: 1 } as const;
export const ACTIVE_CAMPAIGNS_LIMIT = CAMPAIGNS_ACTIVE_MAX;
// What the issue step needs of a campaign row (never the picked-id array).
export const ACTIVE_CAMPAIGNS_SELECT = "name box";

// Reserve ONE card of the budget: the window re-checked atomically (an "End now" between the find and here loses) and
// the budget guard - no maxCards, or fewer issued than maxCards. matchedCount 0 = the budget is gone or it ended.
export function reserveFilter(campaignId: string, now: Date): Record<string, unknown> {
  return {
    _id: campaignId,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    $or: [{ maxCards: { $exists: false } }, { $expr: { $lt: ["$issued", "$maxCards"] } }],
  };
}
export const RESERVE_UPDATE = { $inc: { issued: 1 } } as const;
// The reservation given back when the push provably matched nothing (exactly one decrement per unpushed reservation).
export const RELEASE_UPDATE = { $inc: { issued: -1 } } as const;

// The push guard: the card is not already held (one per diner per campaign) and the diner is still in the programme
// (anchored, or holds a PIN).
export function pushFilter(customerId: string, issueKey: string): Record<string, unknown> {
  return {
    _id: customerId,
    "rewardCards.issueKey": { $ne: issueKey },
    $or: [{ rewardsAnchorAt: { $exists: true } }, { pinHash: { $exists: true } }],
  };
}

// Capped like every other card write: $sort by keepUntil, keep the last REWARD_CARDS_KEEP (the soonest-expiring fall off).
export function pushUpdate(card: RewardCardSnapshot): Record<string, unknown> {
  return { $push: { rewardCards: { $each: [card], $sort: { keepUntil: 1 }, $slice: -REWARD_CARDS_KEEP } } };
}

// Review lens A LOW-1: the push above keeps the REWARD_CARDS_KEEP cards that end LAST, so when the wallet already holds that
// many cards ending at or after the new one (ties counted: the $sort order among equal keys is not guaranteed), the slice
// drops the new card in the same update while the push still "matches". The issue step skips such a campaign BEFORE the
// reserve, so the budget is never spent on a card that cannot land.
export function wouldBeSlicedOff(cards: readonly Pick<RewardCardSnapshot, "keepUntil">[], keepUntil: Date): boolean {
  return cards.filter((card) => card.keepUntil.getTime() >= keepUntil.getTime()).length >= REWARD_CARDS_KEEP;
}
