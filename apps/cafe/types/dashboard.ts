// The Dashboard's one data contract (GET /api/dashboard + GET /api/dashboard/live).
// Built by lib/dashboard/build.ts + lib/dashboard/live.ts, read by
// hooks/use-dashboard.ts, asserted number-by-number by
// scripts/verify-dashboard-live.ts. Money is RUPEES — the v1 Order model
// (`total: Number`) the day summary and the reports route already read.
import type { MoneyBreakdown } from "@pos/shared/types";
import type { SettlementPayMode } from "@/lib/constants";

/** Inclusive IST day keys, "YYYY-MM-DD". A one-day range has from === to. */
export interface DashboardRange {
  from: string;
  to: string;
}

/** How the main sales chart buckets: by IST hour for one day, by IST day otherwise. */
export type DashboardSeriesMode = "hour" | "day";

export interface DashboardKpis {
  sales: number; // Σ total, Completed orders (MONEY_NET_LABEL "Net sales")
  orders: number; // Completed orders
  averageOrder: number; // sales / orders, 0 when there are none
  collected: number; // Σ paidAmount, Completed orders (dues payments are separate)
}

/** One bucket of the main chart. `key` is the hour (0-23) or the IST day key. */
export interface DashboardSeriesPoint {
  key: string;
  label: string; // "8 pm" or "29 Sep"
  sales: number;
  orders: number;
  compareLabel: string; // the aligned comparison bucket's label ("8 pm" / "22 Sep")
  compareSales: number;
}

export interface DashboardShareRow {
  key: string;
  label: string;
  amount: number;
  count: number;
  share: number; // amount / Σ amount of the list, 0..1
}

export interface DashboardItemRow {
  label: string; // name as sold ("Sp. Coco (Large)")
  qty: number;
  revenue: number;
}

export interface DashboardSlowItem {
  productId: string;
  name: string;
  qty: number; // units served in the insight window — 0 is the point
  since?: string; // IST day it joined the menu, when that was inside the window (judged on those days only)
}

export type DashboardChannel = "dine-in" | "takeaway" | "qr" | "counter";

export interface DashboardHeat {
  from: string; // the window the heatmap covers (may be wider than the range)
  to: string;
  hours: number[]; // contiguous IST hours shown, earliest → latest ([] = no orders)
  /** avg[weekday][hourIndex] = orders per such weekday in the window; weekday 0 = Monday. */
  avg: number[][];
  max: number;
}

export interface DashboardLeaks {
  cancelled: { count: number; value: number };
  voids: { lines: number; qty: number; value: number }; // value skips reward lines (never revenue)
  discounts: { orders: number; amount: number };
  rewards: { orders: number; amount: number };
}

export interface DashboardData {
  range: DashboardRange;
  mode: DashboardSeriesMode;
  compare: DashboardRange & { label: string };
  kpis: { current: DashboardKpis; previous: DashboardKpis };
  series: DashboardSeriesPoint[];
  payments: Array<DashboardShareRow & { key: SettlementPayMode }>;
  topItems: DashboardItemRow[];
  slowItems: DashboardSlowItem[];
  categories: DashboardShareRow[];
  channels: Array<DashboardShareRow & { key: DashboardChannel }>;
  heat: DashboardHeat;
  leaks: DashboardLeaks;
  money: MoneyBreakdown;
  duesCollected: number; // money taken in the range against PRE-EXISTING dues
}

/** Point-in-time counts for the "Needs attention" strip — never range-bound. */
export interface DashboardLive {
  openTabs: { count: number; value: number };
  pendingRequests: number;
  dues: { total: number; customers: number };
  unavailable: { count: number; names: string[] };
  bookingsToday: number; // today's reservations still Booked (not yet seated)
}
