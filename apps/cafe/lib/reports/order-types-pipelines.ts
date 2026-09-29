// Order types & busy hours pipelines — pure builders (no model import),
// mirroring lib/reports/items-pipelines.ts's own idiom. The order-type
// grouping/heat expressions reuse the Dashboard's own CHANNEL_EXPR/
// heatPipeline expressions (lib/dashboard/pipelines.ts) so this report and
// the Dashboard's channels/heat widgets can never disagree for the same range.
import type { PipelineStage } from "mongoose";
import { CAFE_TIMEZONE } from "@/lib/constants";
import {
  CHANNEL_EXPR,
  COMPLETED,
  SALES_TOTALS,
  inWindow,
  seriesKeyExpr,
  type AmountRow,
  type TotalsRow,
} from "@/lib/dashboard/pipelines";
import type { TimeWindow } from "@/lib/dashboard/range";
import type { DashboardChannel } from "@/types/dashboard";

export interface HourTypeRow {
  _id: { hour: number; type: DashboardChannel };
  orders: number;
  sales: number;
}
export interface OrderTypesFacet {
  totals: TotalsRow[];
  types: AmountRow[];
  hours: HourTypeRow[];
}
export interface HeatTypeRow {
  _id: { dow: number; hour: number; type: DashboardChannel };
  orders: number;
}
export interface HourDayRow {
  _id: string;
  orders: number;
  sales: number;
}

/** The range's own KPIs, order-type mix, and per-(hour,type) sales — one scan. */
export function orderTypesFacet(window: TimeWindow): PipelineStage[] {
  return [
    { $match: { ...inWindow(window), ...COMPLETED } },
    {
      $facet: {
        totals: [{ $group: { _id: null, ...SALES_TOTALS } }],
        types: [{ $group: { _id: CHANNEL_EXPR, amount: { $sum: "$total" }, count: { $sum: 1 } } }],
        hours: [
          {
            $group: {
              _id: { hour: seriesKeyExpr("hour"), type: CHANNEL_EXPR },
              orders: { $sum: 1 },
              sales: { $sum: "$total" },
            },
          },
        ],
      },
    },
  ];
}

/** The comparison period's KPI totals only — the compare half of kpis. */
export function orderTypesCompareTotals(window: TimeWindow): PipelineStage[] {
  return [{ $match: { ...inWindow(window), ...COMPLETED } }, { $group: { _id: null, ...SALES_TOTALS } }];
}

/** Completed orders per (ISO weekday, IST hour, order type) over the insight window. */
export function heatByTypePipeline(window: TimeWindow): PipelineStage[] {
  return [
    { $match: { ...inWindow(window), ...COMPLETED } },
    {
      $group: {
        _id: {
          dow: { $isoDayOfWeek: { date: "$createdAt", timezone: CAFE_TIMEZONE } },
          hour: { $hour: { date: "$createdAt", timezone: CAFE_TIMEZONE } },
          type: CHANNEL_EXPR,
        },
        orders: { $sum: 1 },
      },
    },
  ];
}

/** One hour's day-by-day drill-down, optionally narrowed to one order type. */
export function hourDetailPipeline(window: TimeWindow, hour: number, type: DashboardChannel | null): PipelineStage[] {
  return [
    { $match: { ...inWindow(window), ...COMPLETED } },
    {
      $match: {
        $expr: {
          $and: [{ $eq: [seriesKeyExpr("hour"), hour] }, ...(type ? [{ $eq: [CHANNEL_EXPR, type] }] : [])],
        },
      },
    },
    { $group: { _id: seriesKeyExpr("day"), orders: { $sum: 1 }, sales: { $sum: "$total" } } },
  ];
}
