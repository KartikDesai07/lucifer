import { Types } from "mongoose";
import { computeOrderTotals, type GstConfig } from "@/lib/receipt";
import type { MoneyFixtureItem, MoneyFixtureOrder } from "@/lib/money-breakdown-fixtures";
import { CARD_REWARD_AT } from "@pos/shared/reward-card-use";
import type { RedeemedReward } from "@pos/shared/reward-redemption";

// CB-7 S5 — the scoped scratch-card order of the D10 money leg (scripts/verify-money-breakdown-live.ts), in its own file
// because money-breakdown-fixtures.ts is at the 300-line cap. The money fields are the REAL output of computeOrderTotals
// (never hand-typed, so a fixture can never encode an impossible bill); `expected` is computed BY HAND below, so the fold
// is checked against arithmetic that does not run through the code under test.
//
// The bill: Cold Coffee Regular 120 + Large 180 + Masala Tea 100 + Cake 100 = 500. The card is "20% off Cold Coffee"
// (a product-percent card): scoped to the coffee, one unit, the DEAREST one (owner s91, O1) -> 20% of 180 = 36.
// GST exclusive 5% on subtotal - discount = 464 -> 23.2 -> 23. total = 464 + 23 = 487.
// Buckets (money-breakdown.ts): gross = subtotal + 0 reward lines = 500; discount = 0 (the kind is "reward", so the
// amount is the REWARD bucket's); reward = 36; gst = 23; charges = 0. Identity: 500 - 0 - 36 + 23 + 0 = 487.

export const MONEY_CARD_PERCENT = 20;
export const MONEY_CARD_DISCOUNT = 36;
export const MONEY_CARD_GST = 23;
export const MONEY_CARD_TOTAL = 487;

const EXCLUSIVE_5: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
const COFFEE_ID = new Types.ObjectId();
const CARD_ID = "0a1b2c3d4e5f";
const COFFEE_LABEL = "Cold Coffee";

function line(name: string, price: number, productId: Types.ObjectId = new Types.ObjectId()): MoneyFixtureItem {
  return { productId, name, price, qty: 1, modifiers: [], instructions: "", kotRound: 1 };
}

// The reward the card snapshot rebuilds to (what rewardFromOrderSnapshot returns for the stored fields below).
const CARD_REWARD: RedeemedReward = {
  at: CARD_REWARD_AT,
  kind: "percent",
  value: MONEY_CARD_PERCENT,
  item: "",
  cardId: CARD_ID,
  scope: { productIds: [String(COFFEE_ID)], maxUnits: 1, label: COFFEE_LABEL },
};

// The card fields the Order doc stores (omit-empty; NEVER rewardAt / rewardStamps).
export interface MoneyCardOrderFields {
  rewardCardId: string;
  rewardKind: "percent";
  rewardValue: number;
  rewardItem: string;
  rewardScopeProductIds: string[];
  rewardScopeMaxUnits: number;
  rewardScopeLabel: string;
}
export interface MoneyCardFixtureOrder extends MoneyFixtureOrder {
  rewardCardFields: MoneyCardOrderFields;
}

const ITEMS: MoneyFixtureItem[] = [
  line(COFFEE_LABEL, 120, COFFEE_ID),
  line(COFFEE_LABEL, 180, COFFEE_ID),
  line("Card Tea", 100),
  line("Card Cake", 100),
];

const totals = computeOrderTotals({
  items: ITEMS.map((i) => ({ price: i.price, qty: i.qty, productId: i.productId })),
  discount: 0,
  discountKind: "reward",
  charge: 0,
  cfg: EXCLUSIVE_5,
  reward: CARD_REWARD,
});

export const MONEY_CARD_FIXTURE_ORDER: MoneyCardFixtureOrder = {
  label: "scoped scratch card: 20% off Cold Coffee (dearest unit), exclusive 5% GST",
  customerName: "Fixture - scoped card order",
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
  expected: { gross: 500, discount: 0, reward: MONEY_CARD_DISCOUNT, gst: MONEY_CARD_GST, charges: 0 },
  rewardCardFields: {
    rewardCardId: CARD_ID,
    rewardKind: "percent",
    rewardValue: MONEY_CARD_PERCENT,
    rewardItem: "",
    rewardScopeProductIds: [String(COFFEE_ID)],
    rewardScopeMaxUnits: 1,
    rewardScopeLabel: COFFEE_LABEL,
  },
};

// The same bill with a plain MANUAL discount of the same rupees: the card must price tax exactly like it (one pipeline).
export const MONEY_CARD_MANUAL_TWIN = computeOrderTotals({
  items: ITEMS.map((i) => ({ price: i.price, qty: i.qty })),
  discount: MONEY_CARD_DISCOUNT,
  discountKind: undefined,
  charge: 0,
  cfg: EXCLUSIVE_5,
});
