import type { DiscountKind } from "@/lib/constants";
import type { MoneyBreakdown } from "@/types";

// D10 — where the money came from and where it went, folded over COMPLETED
// orders. The ONE home for the rule; both the day summary (JS fold over the
// orders it already holds) and the date-range report (a Mongo $group over the
// same fields) execute it, and scripts/verify-money-breakdown-live.ts proves
// the two agree on real documents.
//
// Units are RUPEES: both routes read the v1 `Order` model (`total: Number`),
// not the paise ledger — never multiply by 100 here.
//
// Per order (computeOrderTotals writes total = subtotal - discount + gstAmount
// + charge, with every reward line skipped from subtotal):
//   gross    = subtotal + rewardLines      (the bill at menu price, before anything)
//   discount = discount unless discountKind is "reward"   (manual + GST-equivalent)
//   reward   = rewardLines + (discountKind "reward" ? discount : 0)
//              - an item reward is worth its free line (price stays real on
//                the line, discount is 0); a flat/percent reward is worth the
//                discount the server derived for it (no reward line exists)
//   gst      = gstAmount   (tax ADDED on top in exclusive mode; 0 inclusive)
//   charges  = chargeAmount (the table's extra charge, outside tax and discount)
// Identity, exact because rewardLines cancels:
//   gross - discount - reward + gst + charges === total

const REWARD_DISCOUNT_KIND: DiscountKind = "reward";

export interface MoneyLineItemView {
  price: number;
  qty: number;
  reward?: boolean;
}

export interface MoneyOrderView {
  subtotal: number;
  discount?: number;
  discountKind?: DiscountKind;
  gstAmount?: number;
  chargeAmount?: number;
  items: ReadonlyArray<MoneyLineItemView>;
}

export const EMPTY_MONEY_BREAKDOWN: MoneyBreakdown = {
  gross: 0,
  discount: 0,
  reward: 0,
  gst: 0,
  charges: 0,
};

export const MONEY_BREAKDOWN_KEYS = Object.keys(EMPTY_MONEY_BREAKDOWN) as ReadonlyArray<
  keyof MoneyBreakdown
>;

// A reward line was served, not sold: it counts toward qty, never revenue.
export function lineRevenue(item: MoneyLineItemView): number {
  return item.reward ? 0 : item.price * item.qty;
}

export function rewardLinesValue(items: ReadonlyArray<MoneyLineItemView>): number {
  return items.reduce((sum, item) => sum + (item.reward ? item.price * item.qty : 0), 0);
}

export function orderMoneyContribution(order: MoneyOrderView): MoneyBreakdown {
  const rewardLines = rewardLinesValue(order.items);
  const discount = order.discount ?? 0;
  const isRewardKind = order.discountKind === REWARD_DISCOUNT_KIND;
  return {
    gross: order.subtotal + rewardLines,
    discount: isRewardKind ? 0 : discount,
    reward: rewardLines + (isRewardKind ? discount : 0),
    gst: order.gstAmount ?? 0,
    charges: order.chargeAmount ?? 0,
  };
}

export function foldMoneyBreakdown(orders: ReadonlyArray<MoneyOrderView>): MoneyBreakdown {
  const acc: MoneyBreakdown = { ...EMPTY_MONEY_BREAKDOWN };
  for (const order of orders) {
    const part = orderMoneyContribution(order);
    for (const key of MONEY_BREAKDOWN_KEYS) acc[key] += part[key];
  }
  return acc;
}

// The $group row comes back partial when a range has no orders; every key
// lands as a number so the DTO never carries undefined.
export function pickMoneyBreakdown(
  row: Partial<Record<keyof MoneyBreakdown, number>> | null | undefined,
): MoneyBreakdown {
  const out: MoneyBreakdown = { ...EMPTY_MONEY_BREAKDOWN };
  for (const key of MONEY_BREAKDOWN_KEYS) out[key] = row?.[key] ?? 0;
  return out;
}

// Projection paths the fold reads — appended to the summary route's select()
// so the aggregate can never silently see undefined fields.
export const MONEY_BREAKDOWN_SELECT =
  "subtotal discount discountKind gstAmount chargeAmount items.reward";

// ── Pipeline twins (reports route) ──────────────────────────────────────────
// Field-for-field the same rule as orderMoneyContribution, as $group
// accumulators over un-unwound Order documents.
const REWARD_LINES_EXPR = {
  $reduce: {
    input: { $ifNull: ["$items", []] },
    initialValue: 0,
    in: {
      $add: [
        "$$value",
        {
          $cond: [
            { $eq: ["$$this.reward", true] },
            { $multiply: ["$$this.price", "$$this.qty"] },
            0,
          ],
        },
      ],
    },
  },
};
const IS_REWARD_KIND_EXPR = { $eq: ["$discountKind", REWARD_DISCOUNT_KIND] };
const DISCOUNT_OR_ZERO_EXPR = { $ifNull: ["$discount", 0] };

export const MONEY_BREAKDOWN_GROUP: Record<keyof MoneyBreakdown, { $sum: unknown }> = {
  gross: { $sum: { $add: [{ $ifNull: ["$subtotal", 0] }, REWARD_LINES_EXPR] } },
  discount: { $sum: { $cond: [IS_REWARD_KIND_EXPR, 0, DISCOUNT_OR_ZERO_EXPR] } },
  reward: {
    $sum: { $add: [REWARD_LINES_EXPR, { $cond: [IS_REWARD_KIND_EXPR, DISCOUNT_OR_ZERO_EXPR, 0] }] },
  },
  gst: { $sum: { $ifNull: ["$gstAmount", 0] } },
  charges: { $sum: { $ifNull: ["$chargeAmount", 0] } },
};

// lineRevenue's twin for a pipeline AFTER `{ $unwind: "$items" }`.
export const ITEM_REVENUE_EXPR = {
  $cond: [{ $eq: ["$items.reward", true] }, 0, { $multiply: ["$items.price", "$items.qty"] }],
};

// ── Presentation (one label table for the card, the EOD slip and the CSV) ───
export type MoneyLineSign = "" | "-" | "+";

export interface MoneyLine {
  key: keyof MoneyBreakdown;
  label: string;
  sign: MoneyLineSign;
}

// "GST added", never "collected": gstAmount is only the tax added ON TOP in
// exclusive mode; inclusive-mode tax sits inside gross and net, so a
// "collected" wording would read as "no tax" on every inclusive bill.
export const MONEY_BREAKDOWN_LINES: ReadonlyArray<MoneyLine> = [
  { key: "gross", label: "Gross bill", sign: "" },
  { key: "discount", label: "Discounts", sign: "-" },
  { key: "reward", label: "Rewards given", sign: "-" },
  { key: "gst", label: "GST added", sign: "+" },
  { key: "charges", label: "Additional charges", sign: "+" },
];

export const MONEY_NET_LABEL = "Net sales";
