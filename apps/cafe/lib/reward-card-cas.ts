import { REWARD_CARD_USE_KINDS } from "@pos/shared/reward-card-use";
import type { RedeemedReward, RewardScope } from "@pos/shared/reward-redemption";

// CB-7 S5 (§2.6) — the PURE builders for spending a revealed scratch card on a bill: the claim CAS, its release, the
// Order snapshot fields, and the zero-match gate. No Mongoose / model import here (the IO is lib/reward-card-claim.ts),
// so the exact filter and update shapes are pinned by plain deep-equals.
//
// Claiming and releasing NEVER touch rewardAt / rewardStamps: a card order stores both ABSENT, so no rung-keyed reader
// (stamp claim, return, the one-reward fence on rewardAt) ever runs for it.

// The guard: this diner's row, holding THIS card, revealed, not past its use-by, and of a SPENDABLE kind. `$gte` pairs
// with the engine's strict `>` expiry (cardStateAt): the deadline instant itself is still usable. The kind allowlist
// keeps a points lot (spent through §2.7) and a "none" card unclaimable even when they are revealed.
export function cardClaimFilter(customerId: string, cardId: string, now: Date): Record<string, unknown> {
  return {
    _id: customerId,
    rewardCards: {
      $elemMatch: { id: cardId, status: "revealed", validUntil: { $gte: now }, kind: { $in: [...REWARD_CARD_USE_KINDS] } },
    },
  };
}

// Used now: keepUntil follows the engine's "used → usedAt" rule, and the orderId is the key a release must match.
export function cardClaimUpdate(orderId: string, now: Date): Record<string, unknown> {
  return {
    $set: {
      "rewardCards.$.status": "used",
      "rewardCards.$.usedAt": now,
      "rewardCards.$.keepUntil": now,
      "rewardCards.$.orderId": orderId,
    },
  };
}

// The orderId term is load-bearing: a release may only undo a claim THIS order made, never a card some other order used.
export function cardReleaseFilter(customerId: string, cardId: string, orderId: string): Record<string, unknown> {
  return {
    _id: customerId,
    rewardCards: { $elemMatch: { id: cardId, status: "used", orderId } },
  };
}

// Back to revealed, status-based (no one-way marker) so a retry can claim it again. `validUntil` is immutable once
// revealed, so the caller passes the stored one: keepUntil returns to it. No extension — a card released after its
// deadline is simply expired again.
export function cardReleaseUpdate(validUntil: Date): Record<string, unknown> {
  return {
    $set: { "rewardCards.$.status": "revealed", "rewardCards.$.keepUntil": validUntil },
    $unset: { "rewardCards.$.usedAt": "", "rewardCards.$.orderId": "" },
  };
}

// A bill line as the zero-match gate reads it (a Mongoose ObjectId id or a plain string both work).
export interface CardScopeItem {
  productId?: { toString(): string } | string;
  reward?: boolean;
}

// Would a SCOPED card discount anything on these lines? A diner must never burn a card for ₹0 (s91), so a scoped card
// with no eligible line (a non-reward line whose product is in scope) is refused before it is claimed.
export function scopeMatchesItems(scope: Pick<RewardScope, "productIds">, items: readonly CardScopeItem[]): boolean {
  const ids = new Set(scope.productIds);
  return items.some((i) => i.reward !== true && i.productId !== undefined && ids.has(String(i.productId)));
}

/**
 * The Order `$set` fragment for a card reward. Omit-empty (an unscoped card writes no scope keys, an uncapped one no
 * cap), and NEVER `rewardAt` / `rewardStamps` — the card id is the order's only link to the card.
 */
export function cardSnapshotFields(reward: RedeemedReward): Record<string, unknown> {
  return {
    rewardKind: reward.kind,
    rewardValue: reward.value,
    rewardItem: reward.item,
    ...(reward.itemProductId === undefined ? {} : { rewardItemProductId: reward.itemProductId }),
    ...(reward.qty === undefined ? {} : { rewardQty: reward.qty }),
    ...(reward.cardId === undefined ? {} : { rewardCardId: reward.cardId }),
    ...(reward.scope === undefined
      ? {}
      : {
          rewardScopeProductIds: reward.scope.productIds,
          ...(reward.scope.maxUnits === undefined ? {} : { rewardScopeMaxUnits: reward.scope.maxUnits }),
          ...(reward.scope.label === "" ? {} : { rewardScopeLabel: reward.scope.label }),
        }),
    ...(reward.capRupees === undefined ? {} : { rewardCapRupees: reward.capRupees }),
  };
}
