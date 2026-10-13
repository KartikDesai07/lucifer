import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";
import { ONE_REWARD_PER_BILL } from "@pos/shared/reward-card-use";

// CB-7 S5 (P2) — the ONE-REWARD-PER-BILL fence every reward-claim writer shares. PURE: no Mongoose, no model import, so
// the exact refusal strings and the CAS filter shape are pinned by plain deep-equals, and a writer cannot grow its own
// private copy of the predicate (three copies is the reciprocal-guard failure this repo has already paid for).
//
// What it protects: a bill carries at most ONE money benefit from the loyalty family. A stamp rung, a scratch card
// and a promo code each REPLACE the bill's discount, and each spends something the diner cannot get back by a re-price
// (stamps, a card, a once-per-customer promo row). Stacking a second one would overwrite the first's money while the
// first's spend stayed burned.

/** The stored fields the fence reads — structural, so a lean Order, a Mongoose doc and an OrderRequest all fit. */
export interface OrderRewardState {
  discountKind?: string;
  rewardAt?: number;
  rewardCardId?: string;
  rewardPoints?: number;
  promoCode?: string;
}

// True when the bill already holds a reward: the kind flag, a stamp rung, a card id, OR spent points. The rewardAt /
// rewardCardId / rewardPoints terms also cover a pre-P4 anomaly row (a reward snapshot whose discountKind was since
// swapped away).
export function hasOrderReward(
  o: Pick<OrderRewardState, "discountKind" | "rewardAt" | "rewardCardId" | "rewardPoints">,
): boolean {
  return (
    o.discountKind === "reward" || o.rewardAt !== undefined || o.rewardCardId !== undefined || o.rewardPoints !== undefined
  );
}

// G1 — can the staff POS arm a NEW reward (stamp rung or card) right now? A claim rides only an order-taking write —
// the create, or an add-round with unsent lines (kotRound 0) — never the settle (D9). A resumed tab with only sent
// lines has no round to carry it: a pick there would reach the settle as a plain manual discount and spend nothing.
export function canCarryClaim(resumedOrder: object | null, lines: readonly { kotRound: number }[]): boolean {
  return resumedOrder === null || lines.some((l) => l.kotRound === 0);
}

/**
 * The plain-English refusal for a request that CLAIMS a reward on this bill, or null when the claim may proceed.
 * A promo marker is checked first (the promo's discount is the bill's money), then an existing reward. Callers answer
 * 409 with the returned string.
 */
export function rewardClaimRefusal(o: OrderRewardState): string | null {
  if (o.promoCode !== undefined) return PROMO_BLOCKS_REWARD;
  return hasOrderReward(o) ? ONE_REWARD_PER_BILL : null;
}

/**
 * The CAS terms a claiming writer spreads INTO its order-write filter (only when THIS request claims). The refusal
 * above is a READ; this is the same rule as a WRITE guard, so a marker or reward that lands between the read and the
 * CAS makes the CAS miss and the writer releases what it claimed. The `customerId` term stops a concurrent PUT from
 * re-pointing the bill at another customer after the claim was priced against this one.
 */
export function rewardClaimOrderFence(o: { customerId?: unknown }): Record<string, unknown> {
  return {
    discountKind: { $ne: "reward" },
    rewardAt: { $exists: false },
    rewardCardId: { $exists: false },
    rewardPoints: { $exists: false },
    promoCode: { $exists: false },
    customerId: o.customerId,
  };
}

/**
 * The Order `$set` / create-doc fragment that marks a bill as carrying a promo. Omit-empty: `{}` when no promo applied.
 *
 * Keyed on "APPLIED", never on the discount amount: a promo can be worth ₹0 in rupees (a free-dish promo's benefit is
 * the LINE), and an unmarked bill would let a card or stamp claim stack on top of it. Callers MUST pass the normalized
 * code only when `promoIsClaimable(discount, code, kind)` (lib/order-request-accept-promo.ts) is true — the same
 * single-homed predicate that decides whether the once-per-customer PromoRedemption row is burned, so "marked" and
 * "redemption claimed" can never disagree. Pass undefined otherwise.
 */
export function promoMarkerFields(appliedCode: string | undefined): { promoCode?: string } {
  return appliedCode === undefined ? {} : { promoCode: appliedCode };
}
