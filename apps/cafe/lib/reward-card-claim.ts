import {
  CARD_BILL_TOO_SMALL,
  CARD_CATEGORY_TOO_BIG,
  CARD_ITEM_NOT_AT_SETTLE,
  CARD_NOTHING_TO_DISCOUNT,
  CARD_NOT_USABLE,
  REWARD_SCOPE_PRODUCTS_MAX,
  cardMinBillMet,
  cardRedeemedReward,
  cardUsableAt,
} from "@pos/shared/reward-card-use";
import type { RewardCardSnapshot } from "@pos/shared/reward-levels";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import { Customer } from "@/models/Customer";
import { Product } from "@/models/Product";
import type { ISettings } from "@/models/Settings";
import { dinerAccountsOn } from "@/lib/diner-route-guard";
import {
  cardClaimFilter,
  cardClaimUpdate,
  cardReleaseFilter,
  cardReleaseUpdate,
  cardSnapshotFields,
  scopeMatchesItems,
  type CardScopeItem,
} from "@/lib/reward-card-cas";
import { resolveRewardItemLine, type ResolveRewardItemResult } from "@/lib/reward-item-line";
import { rewardClaimMessage, rewardItemLineMessage, type ResolvedRewardOrderItem } from "@/lib/reward-claim";
import { readCardOf } from "@/lib/reward-cards-read";

// CB-7 S5 (§2.6) — the IO half of spending a revealed scratch card on a bill: resolve (read-only), claim, release.
// The pure shapes are lib/reward-card-cas.ts. SERVER-ONLY (Customer + Product models; registered in
// client-graph-guard.test.ts).
//
// GATE (plan §2.11, predicate 3): a card that is ALREADY revealed stays usable while scratch is blocked or the levels
// are switched off — the chance happened at the reveal. So this file asks only `dinerAccountsOn` plus the card's own
// state, and must NEVER call rewardLevelsEarning / scratchCardsBlockedFor (source-pinned).

// The seam the tests fake: the three database reads/writes. `now` is passed in by the caller (one clock reading per
// request), so there is no ambient clock here.
export interface RewardCardClaimDeps {
  readCard(customerId: string, cardId: string): Promise<RewardCardSnapshot | null>;
  // At most `limit` product ids of one category (the caller asks MAX + 1 to detect "too many").
  categoryProductIds(categoryId: string, limit: number): Promise<string[]>;
  itemLine(reward: RedeemedReward): Promise<ResolveRewardItemResult>;
  updateCard(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<{ matchedCount: number }>;
}

export const REWARD_CARD_CLAIM_DEPS: RewardCardClaimDeps = {
  readCard: readCardOf,
  categoryProductIds: async (categoryId, limit) => {
    const rows = await Product.find({ categoryId }).select("_id").limit(limit).lean();
    return rows.map((r) => String(r._id));
  },
  itemLine: (reward) => resolveRewardItemLine(reward, undefined),
  updateCard: async (filter, update) => {
    const res = await Customer.updateOne(filter, update);
    return { matchedCount: res.matchedCount };
  },
};

// Re-exported so a route wires the whole card lifecycle from ONE import (the builder itself is pure, in the cas file).
export { cardSnapshotFields };

export interface ResolveCardClaimInput {
  settings: ISettings | null;
  customerId: string | undefined;
  cardId: string;
  // The bill BEFORE any reward, in RUPEES (the card's minBill gate reads it).
  billTotal: number;
  // The lines the reward would discount (a scoped card with no eligible line is refused, never burned for ₹0).
  items: readonly CardScopeItem[];
  // The settle path refuses a free-item card: the dish has to reach the kitchen while the order is being taken.
  refuseItemKind: boolean;
  // The round the free dish line is stamped with (1 for a new order, the tab's next round for an add-round).
  kotRound: number;
  now: Date;
}

export type CardClaimResolution =
  | { ok: true; reward: RedeemedReward; line?: ResolvedRewardOrderItem }
  | { ok: false; message: string };

const refuse = (message: string): { ok: false; message: string } => ({ ok: false, message });

/**
 * Resolve a card claim WITHOUT spending it: is the card usable, worth what, and does this bill benefit. Gates in order:
 * diner accounts on, a customer, the card (usable at `now`, bill meets its minimum), free-item not at settle, a
 * category card's product ids (resolved ONCE here; too many dishes is REFUSED, never silently capped), the zero-match
 * gate, then a free-item card's dish line. Errors from the reads PROPAGATE (the caller's 500). Nothing is written.
 */
export async function resolveCardClaim(
  input: ResolveCardClaimInput,
  deps: RewardCardClaimDeps = REWARD_CARD_CLAIM_DEPS,
): Promise<CardClaimResolution> {
  if (!dinerAccountsOn(input.settings)) return refuse(CARD_NOT_USABLE);
  if (!input.customerId) return refuse(rewardClaimMessage("no-customer"));

  const card = await deps.readCard(input.customerId, input.cardId);
  if (!card || !cardUsableAt(card, input.now)) return refuse(CARD_NOT_USABLE);
  if (!cardMinBillMet(card, input.billTotal)) return refuse(CARD_BILL_TOO_SMALL);
  if (input.refuseItemKind && card.kind === "free-item") return refuse(CARD_ITEM_NOT_AT_SETTLE);

  let categoryIds: string[] | undefined;
  if ((card.kind === "category-percent" || card.kind === "category-flat") && card.categoryId) {
    categoryIds = await deps.categoryProductIds(card.categoryId, REWARD_SCOPE_PRODUCTS_MAX + 1);
    if (categoryIds.length > REWARD_SCOPE_PRODUCTS_MAX) return refuse(CARD_CATEGORY_TOO_BIG);
  }

  const reward = cardRedeemedReward(card, categoryIds);
  if (!reward) return refuse(CARD_NOT_USABLE);
  if (reward.scope && !scopeMatchesItems(reward.scope, input.items)) return refuse(CARD_NOTHING_TO_DISCOUNT);

  if (reward.kind !== "item") return { ok: true, reward };
  const resolved = await deps.itemLine(reward);
  if (!resolved.ok) return refuse(rewardItemLineMessage(resolved.reason));
  // A comped dish carries no modifiers / free text (same as the stamp path's resolveRewardClaimAndLine).
  return { ok: true, reward, line: { ...resolved.line, modifiers: [], instructions: "", kotRound: input.kotRound } };
}

/** Spend the card for `orderId`: ONE guarded write. The CAS result MUST be checked — false = it was not spendable. */
export async function claimRewardCard(
  customerId: string,
  cardId: string,
  orderId: string,
  now: Date,
  deps: RewardCardClaimDeps = REWARD_CARD_CLAIM_DEPS,
): Promise<boolean> {
  const res = await deps.updateCard(cardClaimFilter(customerId, cardId, now), cardClaimUpdate(orderId, now));
  return res.matchedCount > 0;
}

/**
 * Give the card back, but only if THIS order still holds it. The stored validUntil (immutable once revealed) is read
 * first; a card that is gone (evicted by the wallet's $slice) is a no-op `false`. May throw: the caller decides
 * (cancel swallows; the create / add-round release paths mirror the stamp returnRewardStamps call sites).
 */
export async function releaseRewardCard(
  customerId: string,
  cardId: string,
  orderId: string,
  deps: RewardCardClaimDeps = REWARD_CARD_CLAIM_DEPS,
): Promise<boolean> {
  const card = await deps.readCard(customerId, cardId);
  if (!card?.validUntil) return false;
  const res = await deps.updateCard(cardReleaseFilter(customerId, cardId, orderId), cardReleaseUpdate(card.validUntil));
  return res.matchedCount > 0;
}
