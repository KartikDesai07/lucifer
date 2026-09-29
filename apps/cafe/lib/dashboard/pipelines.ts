// Dashboard aggregation pipelines — pure builders (no model import), so the
// unit tests and scripts/verify-dashboard-live.ts run the exact stages the
// route runs. Rules shared with the rest of the product, never re-derived:
//   · an order belongs to the IST day of its createdAt (windows from range.ts);
//   · only Completed orders are sales; a Cancelled one is a "leak";
//   · a reward line is qty, never revenue (ITEM_REVENUE_EXPR / MONEY_BREAKDOWN_GROUP,
//     the same twins the reports route runs, proven by verify:money:live).
import type { PipelineStage } from "mongoose";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { SELF_ORDER_SOURCE } from "@pos/shared/public";
import { ITEM_REVENUE_EXPR, MONEY_BREAKDOWN_GROUP } from "@/lib/money-breakdown";
import type { DashboardChannel, DashboardSeriesMode } from "@/types/dashboard";
import type { TimeWindow } from "@/lib/dashboard/range";

export const COMPLETED = { status: "Completed" } as const;
const CANCELLED = { status: "Cancelled" } as const;
const REWARD_DISCOUNT_KIND = "reward";

export const inWindow = (w: TimeWindow) => ({ createdAt: { $gte: w.start, $lte: w.end } });

/**
 * Where an order came from. Precedence matters and is mirrored by channelOf():
 * a diner's QR order (source) first, then a takeaway (parcel), then a table,
 * and a walk-in at the counter is what is left.
 */
export const CHANNEL_EXPR = {
  $switch: {
    branches: [
      { case: { $eq: ["$source", SELF_ORDER_SOURCE] }, then: "qr" },
      { case: { $eq: ["$parcel", true] }, then: "takeaway" },
      { case: { $gt: [{ $strLenCP: { $ifNull: ["$tableNo", ""] } }, 0] }, then: "dine-in" },
    ],
    default: "counter",
  },
};

/** JS twin of CHANNEL_EXPR (the live leg asserts the two agree on real documents). */
export function channelOf(order: { source?: string; parcel?: boolean; tableNo?: string }): DashboardChannel {
  if (order.source === SELF_ORDER_SOURCE) return "qr";
  if (order.parcel === true) return "takeaway";
  if ((order.tableNo ?? "").length > 0) return "dine-in";
  return "counter";
}

/** The name AS SOLD ("items" path) — "Sp. Coco (Large)" — byte-for-byte the reports route's topProducts key. */
export function itemLabelExpr(path: "items" | "voids") {
  return {
    $cond: [
      { $gt: [{ $strLenCP: { $ifNull: [`$${path}.variation`, ""] } }, 0] },
      { $concat: [`$${path}.name`, " (", `$${path}.variation`, ")"] },
      `$${path}.name`,
    ],
  };
}

export const ITEM_LABEL_EXPR = itemLabelExpr("items");

/** A manual or GST-equivalent discount (a reward is counted as a reward, not a discount). */
export const DISCOUNTED_ORDER_EXPR = {
  $and: [{ $gt: [{ $ifNull: ["$discount", 0] }, 0] }, { $ne: ["$discountKind", REWARD_DISCOUNT_KIND] }],
};

/** A flat/percent reward (discountKind) or a free-dish reward line. */
export const REWARDED_ORDER_EXPR = {
  $or: [
    { $eq: ["$discountKind", REWARD_DISCOUNT_KIND] },
    { $in: [true, { $ifNull: ["$items.reward", []] }] },
  ],
};

export const VOID_VALUE_EXPR = {
  $cond: [{ $eq: ["$voids.reward", true] }, 0, { $multiply: ["$voids.price", "$voids.qty"] }],
};

export function seriesKeyExpr(mode: DashboardSeriesMode) {
  return mode === "hour"
    ? { $hour: { date: "$createdAt", timezone: CAFE_TIMEZONE } }
    : { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: CAFE_TIMEZONE } };
}

export const SALES_TOTALS = {
  orders: { $sum: 1 },
  sales: { $sum: "$total" },
  collected: { $sum: "$paidAmount" },
};

export interface TotalsRow {
  orders: number;
  sales: number;
  collected: number;
}
export type PerfTotalsRow = TotalsRow & {
  gross: number;
  discount: number;
  reward: number;
  gst: number;
  charges: number;
  discountedOrders: number;
  rewardedOrders: number;
};
export interface AmountRow {
  _id: string;
  amount: number;
  count: number;
}
export interface ItemRow {
  _id: { productId: unknown; label: string };
  qty: number;
  revenue: number;
}
export interface SeriesRow {
  _id: number | string;
  sales: number;
  orders: number;
}
export interface PerformanceFacet {
  totals: PerfTotalsRow[];
  payments: AmountRow[];
  channels: AmountRow[];
  items: ItemRow[];
  series: SeriesRow[];
  cancelled: Array<{ count: number; value: number }>;
  voids: Array<{ lines: number; qty: number; value: number }>;
}
export interface CompareFacet {
  totals: TotalsRow[];
  series: SeriesRow[];
}
export interface HeatRow {
  _id: { dow: number; hour: number }; // dow = ISO weekday, 1 = Monday … 7 = Sunday
  orders: number;
}
export interface ProductQtyRow {
  _id: unknown; // the productId
  qty: number;
}

/** Everything the range's own widgets need, in ONE index-backed scan of the window. */
export function performanceFacet(window: TimeWindow, mode: DashboardSeriesMode): PipelineStage[] {
  return [
    { $match: inWindow(window) },
    {
      $facet: {
        totals: [
          { $match: COMPLETED },
          {
            $group: {
              _id: null,
              ...SALES_TOTALS,
              ...MONEY_BREAKDOWN_GROUP,
              discountedOrders: { $sum: { $cond: [DISCOUNTED_ORDER_EXPR, 1, 0] } },
              rewardedOrders: { $sum: { $cond: [REWARDED_ORDER_EXPR, 1, 0] } },
            },
          },
        ],
        payments: [
          { $match: COMPLETED },
          { $group: { _id: "$payment", amount: { $sum: "$paidAmount" }, count: { $sum: 1 } } },
        ],
        channels: [
          { $match: COMPLETED },
          { $group: { _id: CHANNEL_EXPR, amount: { $sum: "$total" }, count: { $sum: 1 } } },
        ],
        items: [
          { $match: COMPLETED },
          { $unwind: "$items" },
          {
            $group: {
              _id: { productId: "$items.productId", label: ITEM_LABEL_EXPR },
              qty: { $sum: "$items.qty" },
              revenue: { $sum: ITEM_REVENUE_EXPR },
            },
          },
        ],
        series: [
          { $match: COMPLETED },
          { $group: { _id: seriesKeyExpr(mode), sales: { $sum: "$total" }, orders: { $sum: 1 } } },
        ],
        cancelled: [
          { $match: CANCELLED },
          { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$total" } } },
        ],
        // Every void on an order of this window, whatever the order became —
        // the dish was made and taken back either way.
        voids: [
          { $unwind: "$voids" },
          { $group: { _id: null, lines: { $sum: 1 }, qty: { $sum: "$voids.qty" }, value: { $sum: VOID_VALUE_EXPR } } },
        ],
      },
    },
  ];
}

/**
 * The comparison period: its chart series over WHOLE days, its KPI totals only
 * up to `clippedEnd` (the same elapsed time as the live range).
 */
export function compareFacet(span: TimeWindow, clippedEnd: Date, mode: DashboardSeriesMode): PipelineStage[] {
  return [
    { $match: { ...inWindow(span), ...COMPLETED } },
    {
      $facet: {
        totals: [{ $match: { createdAt: { $lte: clippedEnd } } }, { $group: { _id: null, ...SALES_TOTALS } }],
        series: [{ $group: { _id: seriesKeyExpr(mode), sales: { $sum: "$total" }, orders: { $sum: 1 } } }],
      },
    },
  ];
}

/** Completed orders per (ISO weekday, IST hour) over the insight window. */
export function heatPipeline(window: TimeWindow): PipelineStage[] {
  return [
    { $match: { ...inWindow(window), ...COMPLETED } },
    {
      $group: {
        _id: {
          dow: { $isoDayOfWeek: { date: "$createdAt", timezone: CAFE_TIMEZONE } },
          hour: { $hour: { date: "$createdAt", timezone: CAFE_TIMEZONE } },
        },
        orders: { $sum: 1 },
      },
    },
  ];
}

/** Units served per product over the insight window (slow movers). */
export function productQtyPipeline(window: TimeWindow): PipelineStage[] {
  return [
    { $match: { ...inWindow(window), ...COMPLETED } },
    { $unwind: "$items" },
    { $group: { _id: "$items.productId", qty: { $sum: "$items.qty" } } },
  ];
}
