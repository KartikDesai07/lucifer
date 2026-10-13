// CB-7 S6 (§2.7) — spending reward POINTS on a bill (1 point = ₹1): the contract the cafe server (spend, return,
// re-price), the staff POS and the diner cart share. PURE, client-safe: no DB, no Node APIs, no Mongoose.
// The lot plan (which lots a spend took from) lives on Customer.pointsSpends — the single record a return reads.

import { LOYALTY_STAMP_ORDERS_MAX } from "./public-diner";
import { CARD_REWARD_AT } from "./reward-card-use";
import { REWARD_CARDS_KEEP, REWARD_POINTS_MAX } from "./reward-levels";
import type { RedeemedReward } from "./reward-redemption";

// How many spend records one Customer keeps: the same horizon as the stamp idempotency markers (a record only has to
// outlive a duplicate-apply / late-return window).
export const POINTS_SPENDS_KEEP = LOYALTY_STAMP_ORDERS_MAX;

// The most points one bill can ever spend: every lot at its ceiling, across every card the Customer can hold.
export const POINTS_SPEND_MAX = REWARD_POINTS_MAX * REWARD_CARDS_KEEP;

// One spend: which bill, when, and exactly what it took from which lot. `returnedAt` is set when the bill is
// cancelled and the points go back.
export interface PointsSpendRecord {
  orderId: string;
  at: Date;
  lots: { id: string; take: number }[];
  returnedAt?: Date;
}

/**
 * The most points a bill can take: whole points only, never more than the balance or the bill's subtotal, never
 * negative. The server spends EXACTLY what the client asked for or refuses — this is the ceiling the UI offers.
 */
export function maxPointsSpend(balance: number, subtotal: number): number {
  return Math.max(0, Math.min(Math.floor(balance), Math.floor(subtotal)));
}

/** The redemption snapshot of a points spend: n rupees off the bill, priced as a flat reward, costing n points. */
export function pointsRedeemedReward(n: number): RedeemedReward {
  return { at: CARD_REWARD_AT, kind: "flat", value: n, item: "", points: n };
}

// Plain-English copy (product copy; owner O1: the bill itself says "Reward", the same as a scratch card).
export const POINTS_NOT_ENOUGH = "Not enough points for that";
export const POINTS_OVER_BILL = "Points can't be more than the bill";
export const POINTS_CHANGED = "Your points changed — try again";
export const POINTS_AT_PAYMENT = "Points are used when the bill is paid";
export const POINTS_NEED_CUSTOMER = "Add a customer to use points";
export const POINTS_REWARD_EXCLUSIVE = "Use points or another reward on one order, not both";
export const POINTS_EXPIRE_RULE = "Points not used by their date expire";
