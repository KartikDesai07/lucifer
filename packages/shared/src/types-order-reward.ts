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
}
