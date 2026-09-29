// Reports' sales pipelines — pure builders (no model import, mirrors
// lib/dashboard/pipelines.ts), so the unit tests and
// scripts/verify-reports-live.ts run the EXACT stages the route runs. Rules
// shared with the rest of the product, never re-derived: an order belongs to
// the IST day of its createdAt (windows from dashboard/range.ts); only
// Completed orders are sales; received/dues money follows lib/reports/received.ts.
import type { PipelineStage } from "mongoose";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { MONEY_BREAKDOWN_GROUP } from "@/lib/money-breakdown";
import { inWindow, seriesKeyExpr } from "@/lib/dashboard/pipelines";
import { ACTIVE_DUE_PAYMENT } from "@/lib/due-payment";
import { CASH_EXPR, ONLINE_EXPR, OTHER_EXPR, CREDIT_EXPR } from "@/lib/reports/received";
import type { TimeWindow } from "@/lib/dashboard/range";
import type { DashboardSeriesMode } from "@/types/dashboard";

const COMPLETED = { status: "Completed" } as const;

/** IST calendar-day key of createdAt, "YYYY-MM-DD" — the days $group's _id. */
const IST_DAY_KEY_EXPR = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: CAFE_TIMEZONE } };

const SALES_TOTALS = {
  orders: { $sum: 1 },
  sales: { $sum: "$total" },
  collected: { $sum: "$paidAmount" },
};

export interface SalesDayGroupRow {
  _id: string; // IST day key
  orders: number;
  net: number;
  gross: number;
  discount: number;
  reward: number;
  gst: number;
  charges: number;
  cash: number;
  online: number;
  other: number;
  credit: number;
}
export interface SalesSeriesRow {
  _id: string | number;
  sales: number;
  orders: number;
}
export interface SalesTotalsRow {
  orders: number;
  sales: number;
  collected: number;
}
export interface SalesModeRow {
  _id: string; // payment mode as stored
  orders: number;
  billed: number;
  received: number;
  splitCash: number;
  splitOnline: number;
}
export interface SalesFacet {
  days: SalesDayGroupRow[];
  series: SalesSeriesRow[];
  totals: SalesTotalsRow[];
  modes: SalesModeRow[];
}
export interface DuesByDayRow {
  _id: { day: string; mode: string };
  amount: number;
}

/** Everything the Sales report needs over one window, in ONE facet scan. */
export function salesFacet(window: TimeWindow, mode: DashboardSeriesMode): PipelineStage[] {
  return [
    { $match: { ...inWindow(window), ...COMPLETED } },
    {
      $facet: {
        days: [
          {
            $group: {
              _id: IST_DAY_KEY_EXPR,
              orders: { $sum: 1 },
              net: { $sum: "$total" },
              ...MONEY_BREAKDOWN_GROUP,
              cash: { $sum: CASH_EXPR },
              online: { $sum: ONLINE_EXPR },
              other: { $sum: OTHER_EXPR },
              credit: { $sum: CREDIT_EXPR },
            },
          },
        ],
        series: [{ $group: { _id: seriesKeyExpr(mode), sales: { $sum: "$total" }, orders: { $sum: 1 } } }],
        totals: [{ $group: { _id: null, ...SALES_TOTALS } }],
        modes: [
          {
            $group: {
              _id: "$payment",
              orders: { $sum: 1 },
              billed: { $sum: "$total" },
              received: { $sum: "$paidAmount" },
              splitCash: { $sum: { $ifNull: ["$splitCash", 0] } },
              splitOnline: { $sum: { $ifNull: ["$splitOnline", 0] } },
            },
          },
        ],
      },
    },
  ];
}

/** Dues payments received per (IST day of createdAt, mode) over the window. */
export function duesByDayPipeline(window: TimeWindow): PipelineStage[] {
  return [
    { $match: { ...inWindow(window), ...ACTIVE_DUE_PAYMENT } },
    { $group: { _id: { day: IST_DAY_KEY_EXPR, mode: "$mode" }, amount: { $sum: "$amount" } } },
  ];
}
