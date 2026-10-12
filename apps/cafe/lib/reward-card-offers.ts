import {
  CARD_BILL_TOO_SMALL,
  CARD_NOTHING_TO_DISCOUNT,
  CARD_NOT_USABLE,
  cardMinBillMet,
  staffCardReward,
  type StaffRewardCard,
} from "@pos/shared/reward-card-use";
import { scopeMatchesItems, type CardScopeItem } from "@/lib/reward-card-cas";
import type { RewardBaseLine } from "@/lib/reward-discount";

// CB-7 S5 — the STAFF POS's client-side verdict on each of a diner's cards for the CURRENT bill. Pure and
// React-free, a PREVIEW of resolveCardClaim (lib/reward-card-claim.ts) in the same gate order — usable now, bill meets
// the card's minimum, a scoped card has something to discount — so the counter never offers a card the server then
// refuses. The server stays the only place a card is spent. (Value-imports only pure modules: no Mongoose, no models.)

// A cart line as BOTH the preview (price x qty over the eligible lines) and the zero-match gate read it.
export type CardBillLine = RewardBaseLine & CardScopeItem;

export interface CardOffer {
  card: StaffRewardCard;
  usable: boolean;
  /** Plain-English reason, present iff !usable. */
  reason?: string;
}

/**
 * `billTotal` is the bill BEFORE any reward (the same figure the stamp rungs gate on); `lines` the cart lines (a
 * scoped card needs their product ids); `nowMs` the clock reading for the use-by check.
 */
export function cardOffers(
  cards: readonly StaffRewardCard[],
  billTotal: number,
  lines: readonly CardBillLine[],
  nowMs: number,
): CardOffer[] {
  // A non-finite total reads as 0, so a corrupt number can never make every minimum look met.
  const bill = Number.isFinite(billTotal) ? billTotal : 0;
  return cards.map((card) => {
    if (card.validUntil < nowMs) return { card, usable: false, reason: CARD_NOT_USABLE };
    if (!cardMinBillMet(card, bill)) return { card, usable: false, reason: CARD_BILL_TOO_SMALL };
    const reward = staffCardReward(card);
    if (!reward) return { card, usable: false, reason: CARD_NOT_USABLE };
    if (reward.scope && !scopeMatchesItems(reward.scope, lines)) {
      return { card, usable: false, reason: CARD_NOTHING_TO_DISCOUNT };
    }
    return { card, usable: true };
  });
}
