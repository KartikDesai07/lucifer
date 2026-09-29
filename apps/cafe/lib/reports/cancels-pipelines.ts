// Cancel & discounts pipelines — pure builders (no model import). The
// "leak" totals facet is byte-for-byte the Dashboard's performanceFacet
// (lib/dashboard/pipelines.ts) so the two screens can never disagree; the
// row-level facets (cancelled/removed/discount/reward bills, by staff, by
// reason) are new to this report.
import type { PipelineStage } from "mongoose";
import {
  DISCOUNTED_ORDER_EXPR,
  REWARDED_ORDER_EXPR,
  VOID_VALUE_EXPR,
  inWindow,
  itemLabelExpr,
  seriesKeyExpr,
} from "@/lib/dashboard/pipelines";
import { DISCOUNT_DOC_EXPR, MONEY_BREAKDOWN_GROUP, REWARD_DOC_EXPR } from "@/lib/money-breakdown";
import type { TimeWindow } from "@/lib/dashboard/range";
import type { DashboardSeriesMode } from "@/types/dashboard";

const COMPLETED = { status: "Completed" } as const;
const CANCELLED = { status: "Cancelled" } as const;
const GST_DISCOUNT_KIND = "gst";

/** case-insensitive, surrounding-space-insensitive grouping key for a reason. */
const REASON_KEY_EXPR = (path: string) => ({ $toLower: { $trim: { input: `$${path}` } } });
const TRIMMED_EXPR = (path: string) => ({ $trim: { input: { $ifNull: [`$${path}`, ""] } } });

export interface LeakTotalsRow {
  discountedOrders: number;
  rewardedOrders: number;
  discount: number;
  reward: number;
}
export interface LeakCancelledRow {
  count: number;
  value: number;
}
export interface LeakVoidsRow {
  lines: number;
  qty: number;
  value: number;
}
export interface LeakSeriesRow {
  _id: string | number;
  amount: number;
}
export interface CancelledBillFacetRow {
  _id: unknown;
  orderId: string;
  billNumber?: number;
  day: string;
  cancelledAt?: Date;
  createdAt: Date;
  total: number;
  paidAmount: number;
  cancelledBy?: string;
  cancelReason?: string;
  customerName: string;
  tableNo?: string;
}
export interface RemovedItemFacetRow {
  orderId: string;
  day: string;
  at: Date;
  item: string;
  qty: number;
  value: number;
  voidedBy?: string;
  reason: string;
}
export interface DiscountFacetRow {
  orderId: string;
  billNumber?: number;
  day: string;
  createdAt: Date;
  amount: number;
  billTotal: number;
  by: string;
  customerName: string;
  discountKind?: string;
}
export interface StaffCancelledRow {
  _id: string;
  count: number;
  value: number;
}
export interface StaffRemovedRow {
  _id: string;
  lines: number;
  value: number;
}
export interface StaffDiscountRow {
  _id: string;
  orders: number;
  amount: number;
}
export interface ReasonFacetRow {
  _id: string;
  reason: string;
  count: number;
  value: number;
}
export interface LeakFacet {
  totals: LeakTotalsRow[];
  cancelled: LeakCancelledRow[];
  voids: LeakVoidsRow[];
  givenSeries: LeakSeriesRow[];
  cancelledSeries: LeakSeriesRow[];
  voidSeries: LeakSeriesRow[];
  cancelledRows: CancelledBillFacetRow[];
  removedRows: RemovedItemFacetRow[];
  discountRows: DiscountFacetRow[];
  rewardRows: DiscountFacetRow[];
  staffCancelled: StaffCancelledRow[];
  staffRemoved: StaffRemovedRow[];
  staffDiscounts: StaffDiscountRow[];
  cancelReasons: ReasonFacetRow[];
  removeReasons: ReasonFacetRow[];
}
export interface LeakCompareFacet {
  totals: LeakTotalsRow[];
  cancelled: LeakCancelledRow[];
  voids: LeakVoidsRow[];
}

// ── Shared facet-array builders (leakFacet and leakCompareTotals reuse them,
// so the two can never drift on what "totals"/"cancelled"/"voids" mean) ──────

// Typed as `unknown[]` and cast to PipelineStage[]/FacetPipelineStage[] at
// each use site: mongoose's $facet sub-pipelines and top-level pipelines are
// structurally identical but nominally distinct types, and these arrays are
// deliberately reused in BOTH positions (leakFacet's $facet and
// leakCompareTotals' $facet) — a single PipelineStage[] annotation would
// reject one of the two call sites.
const totalsFacetStages = [
  { $match: COMPLETED },
  {
    $group: {
      _id: null,
      discountedOrders: { $sum: { $cond: [DISCOUNTED_ORDER_EXPR, 1, 0] } },
      rewardedOrders: { $sum: { $cond: [REWARDED_ORDER_EXPR, 1, 0] } },
      discount: MONEY_BREAKDOWN_GROUP.discount,
      reward: MONEY_BREAKDOWN_GROUP.reward,
    },
  },
];
const cancelledFacetStages = [
  { $match: CANCELLED },
  { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$total" } } },
];
const voidsFacetStages = [
  { $unwind: "$voids" },
  { $group: { _id: null, lines: { $sum: 1 }, qty: { $sum: "$voids.qty" }, value: { $sum: VOID_VALUE_EXPR } } },
];

/** Everything the Cancel & discounts report needs over one window, in ONE facet scan. */
export function leakFacet(window: TimeWindow, mode: DashboardSeriesMode, rowLimit: number): PipelineStage[] {
  const key = seriesKeyExpr(mode);
  return [
    { $match: inWindow(window) },
    {
      $facet: {
        totals: totalsFacetStages,
        cancelled: cancelledFacetStages,
        voids: voidsFacetStages,
        givenSeries: [
          { $match: COMPLETED },
          { $group: { _id: key, amount: { $sum: { $add: [DISCOUNT_DOC_EXPR, REWARD_DOC_EXPR] } } } },
        ],
        cancelledSeries: [{ $match: CANCELLED }, { $group: { _id: key, amount: { $sum: "$total" } } }],
        voidSeries: [{ $unwind: "$voids" }, { $group: { _id: key, amount: { $sum: VOID_VALUE_EXPR } } }],
        cancelledRows: [
          { $match: CANCELLED },
          { $sort: { cancelledAt: -1, createdAt: -1, _id: -1 } },
          { $limit: rowLimit },
          {
            $project: {
              orderId: 1,
              billNumber: 1,
              day: seriesKeyExpr("day"),
              cancelledAt: 1,
              createdAt: 1,
              total: 1,
              paidAmount: 1,
              cancelledBy: 1,
              cancelReason: 1,
              customerName: 1,
              tableNo: 1,
            },
          },
        ],
        removedRows: [
          { $unwind: "$voids" },
          { $sort: { "voids.at": -1, _id: -1 } },
          { $limit: rowLimit },
          {
            $project: {
              orderId: 1,
              day: seriesKeyExpr("day"),
              at: "$voids.at",
              item: itemLabelExpr("voids"),
              qty: "$voids.qty",
              value: VOID_VALUE_EXPR,
              voidedBy: "$voids.voidedBy",
              reason: "$voids.reason",
            },
          },
        ],
        discountRows: [
          { $match: { ...COMPLETED, $expr: DISCOUNTED_ORDER_EXPR } },
          { $sort: { createdAt: -1, _id: -1 } },
          { $limit: rowLimit },
          {
            $project: {
              orderId: 1,
              billNumber: 1,
              day: seriesKeyExpr("day"),
              createdAt: 1,
              amount: DISCOUNT_DOC_EXPR,
              billTotal: "$total",
              by: "$receiver",
              customerName: 1,
              discountKind: 1,
            },
          },
        ],
        rewardRows: [
          { $match: { ...COMPLETED, $expr: REWARDED_ORDER_EXPR } },
          { $sort: { createdAt: -1, _id: -1 } },
          { $limit: rowLimit },
          {
            $project: {
              orderId: 1,
              billNumber: 1,
              day: seriesKeyExpr("day"),
              createdAt: 1,
              amount: REWARD_DOC_EXPR,
              billTotal: "$total",
              by: "$receiver",
              customerName: 1,
            },
          },
        ],
        staffCancelled: [
          { $match: CANCELLED },
          { $group: { _id: TRIMMED_EXPR("cancelledBy"), count: { $sum: 1 }, value: { $sum: "$total" } } },
        ],
        staffRemoved: [
          { $unwind: "$voids" },
          { $group: { _id: TRIMMED_EXPR("voids.voidedBy"), lines: { $sum: 1 }, value: { $sum: VOID_VALUE_EXPR } } },
        ],
        staffDiscounts: [
          { $match: { ...COMPLETED, $expr: DISCOUNTED_ORDER_EXPR } },
          { $group: { _id: TRIMMED_EXPR("receiver"), orders: { $sum: 1 }, amount: { $sum: DISCOUNT_DOC_EXPR } } },
        ],
        cancelReasons: [
          { $match: CANCELLED },
          { $sort: { createdAt: 1, _id: 1 } },
          {
            $group: {
              _id: REASON_KEY_EXPR("cancelReason"),
              reason: { $first: TRIMMED_EXPR("cancelReason") },
              count: { $sum: 1 },
              value: { $sum: "$total" },
            },
          },
        ],
        removeReasons: [
          { $unwind: "$voids" },
          { $sort: { "voids.at": 1 } },
          {
            $group: {
              _id: REASON_KEY_EXPR("voids.reason"),
              reason: { $first: TRIMMED_EXPR("voids.reason") },
              count: { $sum: 1 },
              value: { $sum: VOID_VALUE_EXPR },
            },
          },
        ],
      },
    },
  ];
}

/** The comparison period's leak totals only (no row-level facets — the previous KPI half). */
export function leakCompareTotals(window: TimeWindow): PipelineStage[] {
  return [
    { $match: inWindow(window) },
    { $facet: { totals: totalsFacetStages, cancelled: cancelledFacetStages, voids: voidsFacetStages } },
  ];
}

// Referenced by the fold to tell a "gst"-preset discount from a manual one.
export const DISCOUNT_KIND_GST = GST_DISCOUNT_KIND;
