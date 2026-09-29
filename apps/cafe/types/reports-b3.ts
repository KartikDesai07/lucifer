// Reports batch 3 data contract — Order types & busy hours. Built by
// lib/reports/order-types-build.ts, served by GET /api/reports/order-types
// (+ /detail for one hour's drill-down), read by hooks/use-reports.ts,
// asserted number by number by scripts/verify-reports-b3-live.ts.
// Same ground rules as batches 1-2: money is RUPEES on the v1 Order model; an
// order belongs to the IST day/hour of its createdAt; only Completed orders
// count. The order type is the Dashboard's own CHANNEL_EXPR / channelOf rule
// (QR self-order → takeaway (parcel) → dine-in (table) → counter), and the
// busy-hours grid is the Dashboard's own heat (insightRange window), so the two
// screens can never disagree for the same range.
import type { DashboardChannel, DashboardHeat, DashboardKpis, DashboardRange } from "@/types/dashboard";
import type { ReportCompare } from "@/types/reports-b2";

/** One order type's Completed bills in the range. */
export interface OrderTypeRow {
  key: DashboardChannel;
  label: string; // CHANNEL_LABELS (lib/dashboard/fold.ts)
  orders: number;
  sales: number; // Σ total
  averageOrder: number; // sales / orders (orders is never 0 — a type with no bills is omitted)
  share: number; // sales / Σ sales of every type, 0..1
}

export interface OrderTypeCell {
  orders: number;
  sales: number;
}

/** One IST hour of the day, summed over every day of the range. */
export interface HourRow {
  hour: number; // 0-23, IST
  label: string; // "8 pm" — hourLabel(hour), the chart axis
  span: string; // "8 pm – 9 pm" — tables, the readout and the side panel title
  orders: number;
  sales: number;
  /** EVERY DashboardChannel key present (zeros included) — a type filter is a lookup. */
  byType: Record<DashboardChannel, OrderTypeCell>;
}

export interface OrderTypesReport {
  range: DashboardRange;
  compare: ReportCompare;
  /** The Dashboard's KPI rule (foldKpis; the compare is up to the same time of day). */
  kpis: { current: DashboardKpis; previous: DashboardKpis };
  /** Types with at least one Completed bill, most sales first (foldChannels' own order). */
  types: OrderTypeRow[];
  /**
   * The contiguous span of hours with any order (earliest → latest), empty
   * hours inside the span included (a gap is information); [] when nothing sold.
   */
  hours: HourRow[];
  /** The hour with the most orders (then most sales, then the earliest); null when nothing sold. */
  busiestHour: number | null;
  /**
   * Busy-hours grid over insightRange(range): the range itself when it is 7+
   * days, else the 4 weeks ending on its last day (heat.all.from/to say which).
   * `all` deep-equals the Dashboard's `heat` for the same range; `byType` has
   * EVERY DashboardChannel key (hours [] for a type with no orders).
   */
  heat: { all: DashboardHeat; byType: Record<DashboardChannel, DashboardHeat> };
}

/** One day of the range that had an order in the chosen hour. */
export interface HourDetailDay {
  date: string; // IST day key
  label: string; // "Tue, 22 Sep" — weekdayDayLabel
  orders: number;
  sales: number;
}

/** GET /api/reports/order-types/detail — one hour's day-by-day drill-down. */
export interface HourDetail {
  range: DashboardRange;
  hour: number;
  type: DashboardChannel | null; // null = every order type
  /** Oldest first; days with no order in that hour are omitted. Σ = that hour's row. */
  days: HourDetailDay[];
}
