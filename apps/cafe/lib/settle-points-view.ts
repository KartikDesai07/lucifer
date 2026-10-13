import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";
import { ONE_REWARD_PER_BILL } from "@pos/shared/reward-card-use";
import { POINTS_NEED_CUSTOMER, POINTS_REWARD_EXCLUSIVE, maxPointsSpend } from "@pos/shared/reward-points";
import { hasOrderReward, type OrderRewardState } from "@/lib/order-reward-fence";

// CB-7 S6 (§2.7, slice C) — the payment popup's "Use points" row, as one PURE decision. No React, no fetch: what the
// row may spend and the plain reason when it may not. The hook (hooks/use-settle-points.ts) feeds it the live state.
//
// Owner O3: ONE switch that uses ALL usable points up to the food total — never a typed amount. The server spends
// exactly the number this row showed or refuses (409); it never clamps.

export const POINTS_BLOCK_DISCOUNT = "Remove the discount to use points";
export const POINTS_BLOCK_FROZEN = "Finish sending this bill first, then use points";

export interface PointsRowInput {
  hasCustomer: boolean;
  // The customer's usable points (GET /api/customers/[id]/rewards); undefined while it loads.
  balance: number | undefined;
  // The bill's food total before any discount, the ceiling a spend can take.
  subtotal: number;
  // The resumed tab, if any: a reward it already holds blocks the row (one reward per bill).
  resumed: OrderRewardState | null;
  // A promo code is on the bill (the tab's marker or one typed on the cart).
  promo: boolean;
  // A stamp rung or a scratch card is picked for this bill.
  rewardPending: boolean;
  // A manual rupee/percent discount or the GST preset is on the bill.
  manualDiscount: boolean;
  // A Pay Now send is unconfirmed: its replay must show exactly what it sent.
  frozen: boolean;
}

export interface PointsRowState {
  // May the operator flip the switch right now.
  usable: boolean;
  // The points the switch spends when on: 0 when nothing can be offered. A frozen send keeps its offer (so the replay
  // still shows what it sent) but cannot be toggled.
  amount: number;
  // The plain-English reason the row is blocked; null when it is free, or when there is nothing to show at all.
  reason: string | null;
}

const blocked = (reason: string | null): PointsRowState => ({ usable: false, amount: 0, reason });

export function pointsRowState(i: PointsRowInput): PointsRowState {
  if (!i.hasCustomer) return blocked(POINTS_NEED_CUSTOMER);
  // Someone with no points is never told why they cannot spend them.
  const amount = maxPointsSpend(i.balance ?? 0, i.subtotal);
  if (amount <= 0) return blocked(null);
  if (i.resumed !== null && hasOrderReward(i.resumed)) return blocked(ONE_REWARD_PER_BILL);
  if (i.promo) return blocked(PROMO_BLOCKS_REWARD);
  if (i.rewardPending) return blocked(POINTS_REWARD_EXCLUSIVE);
  if (i.manualDiscount) return blocked(POINTS_BLOCK_DISCOUNT);
  if (i.frozen) return { usable: false, amount, reason: POINTS_BLOCK_FROZEN };
  return { usable: true, amount, reason: null };
}

// A frozen Pay Now (unconfirmed send) replays the request it already built, so the popup and the previews must keep
// the amount that request carried: a balance refetch that lands meanwhile (a failed create still refreshes the
// customer) must not re-price the bill under it. `last` = what the switch carried on the latest un-frozen render;
// `held` = that figure latched at the moment the send froze, kept until it clears.
export interface PointsHold {
  last: number;
  held: number | null;
}
export const NO_POINTS_HOLD: PointsHold = { last: 0, held: null };

/** One render's step. Returns the SAME object when nothing changes (a render-time setState must settle). */
export function stepPointsHold(s: PointsHold, frozen: boolean, live: number): PointsHold {
  if (!frozen) return s.held === null && s.last === live ? s : { last: live, held: null };
  return s.held === null ? { last: s.last, held: s.last } : s;
}

/** The amount the bill carries now: the latch while frozen (even before the step lands), else the live figure. */
export function carriedPoints(s: PointsHold, frozen: boolean, live: number): number {
  return frozen ? (s.held ?? s.last) : live;
}

/** The row as shown: while frozen with points latched it offers those points (not usable, the frozen reason). */
export function rowWithHold(row: PointsRowState, frozen: boolean, carried: number): PointsRowState {
  return frozen && carried > 0 ? { usable: false, amount: carried, reason: POINTS_BLOCK_FROZEN } : row;
}
