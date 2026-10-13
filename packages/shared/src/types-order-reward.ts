import type { LoyaltyRewardKind } from "./public-diner";

// The CB-5B reward-snapshot fields of Order, split out of types.ts (S5a,
// behaviour-preserving move) so that file stops growing. Order extends it.
export interface OrderRewardFields {
  // CB-5B reward redemption snapshot — WHICH milestone was claimed, stored so
  // a re-tuned ladder can never re-price an already-issued redemption (mirrors
  // the GST snapshot fields below). Present only when discountKind === "reward".
  rewardAt?: number; // the milestone rung claimed (stamps)
  rewardKind?: LoyaltyRewardKind;
  rewardValue?: number;
  rewardItem?: string; // "" legal when rewardKind is not "item"
  rewardStamps?: number; // stamps DEBITED — the cost, stored, never re-derived
  // CB-7 S5 (§2.6) — a scratch card used on this bill. rewardAt + rewardStamps stay ABSENT on a card order; its
  // money rides rewardKind/rewardValue/rewardItem above, these carry the rest.
  rewardCardId?: string;
  rewardScopeProductIds?: string[]; // the dishes it discounts, resolved ONCE at claim
  rewardScopeMaxUnits?: number; // a product card: how many units (one)
  rewardScopeLabel?: string; // the product / category name, display only
  rewardCapRupees?: number; // "up to ₹X"
  // CB-7 S6 (§2.7) — the points SPENT on this bill = its discount (1 point = ₹1); the lot plan lives on Customer.pointsSpends.
  rewardPoints?: number;
  // s86 P2 — the promo code this bill opened with. Omit-empty, never $unset: its presence refuses every reward
  // claim on the bill (one reward per bill).
  promoCode?: string;
}
