// The Reports screens' data contract (owner's page-by-page programme, screen 4 —
// batch 1: Sales summary · Payments & cash tally · Customer dues). Built by
// lib/reports/*-build.ts, served by GET /api/reports/{sales,dues}, read by
// hooks/use-reports.ts, asserted number-by-number by scripts/verify-reports-live.ts.
// Money is RUPEES (the v1 Order model), exactly like the Dashboard it must agree
// with: Net sales = Σ total of Completed orders; an order belongs to the IST day
// of its createdAt; dues payments are money for OLD bills, never folded into a
// day's sales.
import type { MoneyBreakdown } from "@pos/shared/types";
import type { DashboardKpis, DashboardRange, DashboardSeriesMode, DashboardSeriesPoint } from "@/types/dashboard";

/**
 * Where a set of bills' money went, the moment they were settled. Exact per bill
 * (lib/reports/received.ts), so the four parts always add up to the bills' net:
 *   cash + online + other + credit === Σ total
 * `other` is money taken on a bill whose mode says nothing about cash vs online
 * (a Split bill without its parts, a part-paid Due) — shown only when non-zero,
 * never silently dropped. `credit` is what the customer still owes on those bills.
 */
export interface ReceivedSplit {
  cash: number;
  online: number;
  other: number;
  credit: number;
}

/** Dues payments received (money for OLD bills), by the mode they came in. */
export interface DuesReceived {
  cash: number;
  online: number;
  other: number; // a legacy receipt stored with a non-cash/online mode
}

/** One IST day of the range — every day is present, zero days included. */
export interface SalesDayRow extends ReceivedSplit {
  date: string; // IST day key
  orders: number; // Completed orders
  net: number; // Σ total (MONEY_NET_LABEL)
  money: MoneyBreakdown; // gross − discount − reward + gst + charges === net
  dues: DuesReceived;
}

/** A bill's settlement mode, as rung up. `received` is Σ paidAmount; `billed` Σ total. */
export interface PaymentModeRow {
  mode: string; // a SETTLEMENT_PAY_MODES value, or whatever a legacy row stored
  orders: number;
  billed: number;
  received: number;
}

export interface SalesReport {
  range: DashboardRange;
  compare: DashboardRange & { label: string }; // "vs previous 7 days" / "vs Tue, 22 Sep"
  /** Same rule as the Dashboard: a range ending today is compared up to the same time of day. */
  kpis: { current: DashboardKpis; previous: DashboardKpis };
  mode: DashboardSeriesMode; // the chart buckets by hour for one day, by day otherwise
  series: DashboardSeriesPoint[]; // lib/dashboard/fold.ts buildSeries — the Dashboard's own chart rule
  money: MoneyBreakdown; // the range's bill breakdown
  received: ReceivedSplit; // Σ of days
  dues: DuesReceived; // Σ of days
  payments: PaymentModeRow[]; // by bill mode, largest billed first; modes with no bills omitted
  split: { orders: number; cash: number; online: number }; // Split bills and their parts (already inside received)
  days: SalesDayRow[]; // oldest first
}

export interface OutstandingDueRow {
  customerId: string;
  name: string;
  mobile: string;
  totalDue: number;
}

export interface DuesReceiptRow {
  id: string;
  at: string; // ISO timestamp
  customerId: string;
  customerName: string; // "" when the customer record is gone
  amount: number;
  mode: string;
  receivedBy: string;
}

export interface DuesReport {
  range: DashboardRange;
  /** LIVE, not ranged: every customer who owes right now (totals are over ALL of them). */
  outstanding: { total: number; customers: number; rows: OutstandingDueRow[]; truncated: boolean };
  /** Dues payments received in the range (soft-deleted receipts excluded). */
  collected: DuesReceived & { total: number; count: number; rows: DuesReceiptRow[]; truncated: boolean };
  /** New credit given in the range: Σ (total − paidAmount) over its Completed bills. */
  creditGiven: { total: number; orders: number };
}

// ── Batch 2 — Items & categories · Cancel & discounts · GST ──────────────────
// Batch 2 types live in types/reports-b2.ts (split to keep each file small);
// re-exported here so every reader keeps one import path.
export type * from "@/types/reports-b2";

// ── Batch 3 — Order types & busy hours ──────────────────────────────────────
export type * from "@/types/reports-b3";
