import { LOYALTY_REWARD_KINDS, type LoyaltyRewardKind } from "@pos/shared/public-diner";

// CB-5B reward snapshot fields split out of Order.ts (S5a, behaviour-preserving
// move): the interface fragment IOrder extends, and the schema paths the order
// schema spreads in. Same paths, same omit-empty discipline, same order.
export interface IOrderRewardFields {
  // CB-5B — the reward reprint snapshot, present only when discountKind ===
  // "reward". The years-later reprint contract (same reasoning as the GST
  // snapshot below): a re-pricing writer rebuilds `reward` from THESE five
  // fields, never from the live milestone ladder, so an owner editing the
  // ladder mid-service cannot re-price an already-open tab. NO `default:` on
  // any of them (the discountKind omit-empty discipline) — see the schema
  // for why `rewardItem` also must not be `required: true`.
  rewardAt?: number; // WHICH rung was claimed (the milestone's stamp count)
  rewardKind?: LoyaltyRewardKind;
  rewardValue?: number;
  rewardItem?: string; // "" is legal (flat/percent rewards carry no item name)
  // CB-5B D8/D11 — the free dish, as a REFERENCE plus a count. `rewardItem`
  // above is only its display name; a re-pricing writer resolves the actual
  // Product from THIS id, because a name breaks the moment a dish is renamed,
  // deleted, or duplicated. Absent on flat/percent rewards and on every
  // pre-D8 order, which is exactly how a reader tells "no dish" from "a dish".
  rewardItemProductId?: string;
  rewardQty?: number;
  // stamps DEBITED — the COST this order's redemption spent. Stored, never
  // re-derived: deriving it live from the current ladder would refund the
  // WRONG number on cancel after the owner retunes the milestone's `at`.
  rewardStamps?: number;
}

export const orderRewardPaths = {
    // CB-5B reward snapshot — no `default:` on any path (mirrors
    // discountKind's own omit-empty discipline immediately above). rewardItem
    // is deliberately NOT `required: true`: Mongoose's String `required`
    // rejects "" outright, and the PUT paths run with `runValidators: true`,
    // but "" is a legal item name for a flat/percent reward (no dish attached).
    rewardAt: { type: Number },
    rewardKind: { type: String, enum: [...LOYALTY_REWARD_KINDS] },
    rewardValue: { type: Number },
    rewardItem: { type: String },
    // CB-5B D8/D11 — no `default:` (same omit-empty discipline as the four
    // above). Stored as a plain String, not an ObjectId ref: this is a
    // reprint SNAPSHOT of what was claimed, and it must survive the product
    // being deleted later — a ref would invite a populate() that resurrects
    // a live price onto an already-issued reward.
    rewardItemProductId: { type: String },
    rewardQty: { type: Number },
    rewardStamps: { type: Number },
};
