import { Types } from "mongoose";
import { computeOrderTotals, type GstConfig } from "@/lib/receipt";
import type { MoneyFixtureItem, MoneyFixtureOrder } from "@/lib/money-breakdown-fixtures";
import { pointsRedeemedReward } from "@pos/shared/reward-points";

// CB-7 S6 - the points order of the D10 money leg (scripts/verify-money-breakdown-live.ts), in its own file because
// money-breakdown-fixtures.ts is at the 300-line cap. The money fields are the REAL output of computeOrderTotals (never
// hand-typed, so a fixture can never encode an impossible bill); `expected` is computed BY HAND below, so the fold is
// checked against arithmetic that does not run through the code under test.
//
// The bill: Masala Tea 100 + Cake 100 + Brownie 150 + Muffin 150 = 500. The customer spends 40 POINTS (1 point = Rs 1,
// off the food total, stored as a "reward"-kind flat discount of 40). GST exclusive 5% on subtotal - discount = 460 -> 23
// exactly (no rounding in play). total = 460 + 23 = 483.
// Buckets (money-breakdown.ts): gross = subtotal + 0 reward lines = 500; discount = 0 (the kind is "reward", so the amount
// is the REWARD bucket's); reward = 40; gst = 23; charges = 0. Identity: 500 - 0 - 40 + 23 + 0 = 483.

export const MONEY_POINTS_SPENT = 40;
export const MONEY_POINTS_GST = 23;
export const MONEY_POINTS_TOTAL = 483;

const EXCLUSIVE_5: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };

function line(name: string, price: number): MoneyFixtureItem {
  return { productId: new Types.ObjectId(), name, price, qty: 1, modifiers: [], instructions: "", kotRound: 1 };
}

// The only reward field a points order stores (omit-empty; NEVER rewardAt / rewardStamps / a card id - the lot plan lives
// on the customer's spend record, the order keeps just the cost).
export interface MoneyPointsOrderFields {
  rewardPoints: number;
}
export interface MoneyPointsFixtureOrder extends MoneyFixtureOrder {
  rewardFields: MoneyPointsOrderFields;
}

const ITEMS: MoneyFixtureItem[] = [line("Points Tea", 100), line("Points Cake", 100), line("Points Brownie", 150), line("Points Muffin", 150)];

const totals = computeOrderTotals({
  items: ITEMS.map((i) => ({ price: i.price, qty: i.qty, productId: i.productId })),
  discount: 0,
  discountKind: "reward",
  charge: 0,
  cfg: EXCLUSIVE_5,
  reward: pointsRedeemedReward(MONEY_POINTS_SPENT),
});

export const MONEY_POINTS_FIXTURE_ORDER: MoneyPointsFixtureOrder = {
  label: "40 points spent on a Rs 500 bill, exclusive 5% GST",
  customerName: "Fixture - points order",
  items: ITEMS,
  subtotal: totals.subtotal,
  discount: totals.discount,
  discountKind: "reward",
  gstAmount: totals.gstAmount,
  gstRate: EXCLUSIVE_5.gstRate,
  gstMode: EXCLUSIVE_5.gstMode,
  total: totals.total,
  paidAmount: totals.total,
  payment: "Cash",
  status: "Completed",
  receiver: "Fixture Verifier",
  expected: { gross: 500, discount: 0, reward: MONEY_POINTS_SPENT, gst: MONEY_POINTS_GST, charges: 0 },
  rewardFields: { rewardPoints: MONEY_POINTS_SPENT },
};

// The same bill with a plain MANUAL discount of the same rupees: points must price tax exactly like it (one pipeline).
export const MONEY_POINTS_MANUAL_TWIN = computeOrderTotals({
  items: ITEMS.map((i) => ({ price: i.price, qty: i.qty })),
  discount: MONEY_POINTS_SPENT,
  discountKind: undefined,
  charge: 0,
  cfg: EXCLUSIVE_5,
});
