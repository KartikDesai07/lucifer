// Items & categories pipelines — pure builders (no model import), mirroring
// lib/reports/sales-pipelines.ts's own idiom. The item grouping/labels reuse
// the Dashboard's own expressions (ITEM_LABEL_EXPR, ITEM_REVENUE_EXPR,
// VOID_VALUE_EXPR) so this report and the Dashboard's top items/categories
// can never disagree for the same range.
import type { PipelineStage, Types } from "mongoose";
import { ITEM_LABEL_EXPR, VOID_VALUE_EXPR, inWindow, itemLabelExpr } from "@/lib/dashboard/pipelines";
import { ITEM_REVENUE_EXPR, MONEY_BREAKDOWN_GROUP } from "@/lib/money-breakdown";
import { seriesKeyExpr } from "@/lib/dashboard/pipelines";
import type { TimeWindow } from "@/lib/dashboard/range";
import type { DashboardSeriesMode } from "@/types/dashboard";

const COMPLETED = { status: "Completed" } as const;

/** A free reward unit/line — the twin REWARDED_ORDER_EXPR uses per-item, unwound. */
const IS_REWARD_ITEM_EXPR = { $eq: ["$items.reward", true] };
const REWARD_VALUE_EXPR = { $cond: [IS_REWARD_ITEM_EXPR, { $multiply: ["$items.price", "$items.qty"] }, 0] };

export interface ItemsFacetRow {
  _id: { productId: unknown; label: string };
  qty: number;
  freeQty: number;
  revenue: number;
  rewardValue: number;
}
export interface ItemsTotalsRow {
  orders: number;
  sales: number;
  gross: number;
  discount: number;
  reward: number;
  gst: number;
  charges: number;
}
export interface ItemsFacet {
  items: ItemsFacetRow[];
  totals: ItemsTotalsRow[];
}
export interface ItemsCompareTotalsRow {
  qty: number;
  sales: number;
}
export interface ItemSeriesRow {
  _id: string | number;
  qty: number;
  sales: number;
}
export interface ItemVoidsRow {
  qty: number;
  value: number;
}

/** Every item sold in the window, plus the range's own money breakdown — one scan. */
export function itemsFacet(window: TimeWindow): PipelineStage[] {
  return [
    { $match: { ...inWindow(window), ...COMPLETED } },
    {
      $facet: {
        items: [
          { $unwind: "$items" },
          {
            $group: {
              _id: { productId: "$items.productId", label: ITEM_LABEL_EXPR },
              qty: { $sum: "$items.qty" },
              freeQty: { $sum: { $cond: [IS_REWARD_ITEM_EXPR, "$items.qty", 0] } },
              revenue: { $sum: ITEM_REVENUE_EXPR },
              rewardValue: { $sum: REWARD_VALUE_EXPR },
            },
          },
        ],
        totals: [{ $group: { _id: null, orders: { $sum: 1 }, sales: { $sum: "$total" }, ...MONEY_BREAKDOWN_GROUP } }],
      },
    },
  ];
}

/** The comparison period's item qty/sales, one $group — the KPI-previous half. */
export function itemsCompareTotals(window: TimeWindow): PipelineStage[] {
  return [
    { $match: { ...inWindow(window), ...COMPLETED } },
    { $unwind: "$items" },
    { $group: { _id: null, qty: { $sum: "$items.qty" }, sales: { $sum: ITEM_REVENUE_EXPR } } },
  ];
}

/** One item's drill-down series (qty/sales per day or hour), over the window. */
export function itemDetailPipeline(
  window: TimeWindow,
  mode: DashboardSeriesMode,
  productId: Types.ObjectId | null,
  label: string,
): PipelineStage[] {
  const match: Record<string, unknown> = { ...inWindow(window), ...COMPLETED };
  if (productId) match["items.productId"] = productId;
  const stages: PipelineStage[] = [{ $match: match }, { $unwind: "$items" }];
  if (productId) stages.push({ $match: { "items.productId": productId } });
  stages.push({ $match: { $expr: { $eq: [ITEM_LABEL_EXPR, label] } } });
  stages.push({
    $group: { _id: seriesKeyExpr(mode), qty: { $sum: "$items.qty" }, sales: { $sum: ITEM_REVENUE_EXPR } },
  });
  return stages;
}

/** Units of this item taken back on an order of the window — whatever the order became. */
export function itemVoidsPipeline(window: TimeWindow, productId: Types.ObjectId | null, label: string): PipelineStage[] {
  const stages: PipelineStage[] = [{ $match: inWindow(window) }, { $unwind: "$voids" }];
  const match: Record<string, unknown> = { $expr: { $eq: [itemLabelExpr("voids"), label] } };
  if (productId) match["voids.productId"] = productId;
  stages.push({ $match: match });
  stages.push({ $group: { _id: null, qty: { $sum: "$voids.qty" }, value: { $sum: VOID_VALUE_EXPR } } });
  return stages;
}
