// Reports batch 2 data contract — Items & categories · Cancel & discounts ·
// GST. Built by lib/reports/{items,cancels,gst}-build.ts, served by GET
// /api/reports/{items,items/detail,cancels,gst}, read by hooks/use-reports.ts,
// asserted number by number by scripts/verify-reports-b2-live.ts.
// Same ground rules as batch 1 (types/reports.ts): money is RUPEES on the v1
// Order model; an order belongs to the IST day of its createdAt; only Completed
// orders are sales. Numbers that the Dashboard also shows (top items,
// categories, the "leaks" card) are built from the Dashboard's own pipeline
// expressions, so the two screens can never disagree for the same range.
import type { MoneyBreakdown } from "@pos/shared/types";
import type { DashboardRange, DashboardSeriesMode } from "@/types/dashboard";

/** "vs previous 7 days" — compareRange + compareLabel, exactly as batch 1. */
export type ReportCompare = DashboardRange & { label: string };

// ── Items & categories ───────────────────────────────────────────────────────

/** One item AS SOLD ("Cold Coffee (Large)") — the Dashboard's top-items label. */
export interface ItemSalesRow {
  /** Stable drill key: `${productId}|${label}` (productId "" when a line has none). */
  key: string;
  productId: string;
  label: string;
  /**
   * Category name, or UNCATEGORISED_LABEL / REMOVED_ITEMS_LABEL (lib/dashboard/fold.ts).
   * Named categoryName, never `category`: lib/category-readers-pins.test.ts bans
   * bare `.category` reads app-wide (Product carries only categoryId).
   */
  categoryName: string;
  /** The category's id, or the fallback label itself — CategorySalesRow.key. */
  categoryKey: string;
  /** Every unit served, free reward units included. */
  qty: number;
  /** Units given free as a loyalty reward (inside qty, never inside sales). */
  freeQty: number;
  /** Σ price × qty over the PAID lines, before any bill-level discount (ITEM_REVENUE_EXPR). */
  sales: number;
  /** sales / Σ sales of every row, 0..1 (0 when nothing sold). */
  share: number;
}

export interface CategorySalesRow {
  key: string;
  label: string;
  /** Distinct ItemSalesRow count in this category. */
  items: number;
  qty: number;
  sales: number;
  share: number;
}

export interface ItemsKpis {
  qty: number; // units served (free included)
  sales: number; // Σ item sales (paid lines)
}

export interface ItemsReport {
  range: DashboardRange;
  compare: ReportCompare;
  /** Same "same time of day" compare rule as the Dashboard (compareWindow). */
  kpis: { current: ItemsKpis; previous: ItemsKpis };
  /** EVERY item sold in the range — sales desc, then qty desc, then label. */
  items: ItemSalesRow[];
  /** EVERY category (no "Other" folding — this is the full table), sales desc. */
  categories: CategorySalesRow[];
  /** The range's bills, for the "How it adds up" bridge to net sales. */
  money: MoneyBreakdown;
  /** Value of the free reward LINES at menu price (the part of money.reward that is a dish). */
  rewardLines: number;
  /** Σ total of Completed orders — the Sales summary headline. */
  netSales: number;
}

/** One bucket of an item's drill — only buckets where it sold appear. */
export interface ItemDetailPoint {
  key: string; // IST day key (day mode) or the IST hour as a string (hour mode)
  label: string; // "Tue 23 Sep" / "2 pm"
  qty: number;
  sales: number;
}

export interface ItemDetail {
  range: DashboardRange;
  key: string;
  label: string;
  mode: DashboardSeriesMode;
  /** Chronological; buckets with qty 0 omitted. */
  points: ItemDetailPoint[];
  /** Voided (taken back) on this range's orders, whatever the order became. */
  removed: { qty: number; value: number };
}

// ── Cancel & discounts ───────────────────────────────────────────────────────

/** Byte-for-byte the Dashboard's `leaks` card for the same range. */
export interface LeakTotals {
  discounts: { orders: number; amount: number }; // manual + GST discount (money.discount)
  rewards: { orders: number; amount: number }; // money.reward (free lines + reward discounts)
  cancelled: { count: number; value: number }; // Cancelled orders, Σ total
  voids: { lines: number; qty: number; value: number }; // items taken back (VOID_VALUE_EXPR)
}

/** One chart bucket: money given away vs money lost to cancels/voids. */
export interface LeakPoint {
  key: string; // IST day key, or the IST hour as a string
  label: string;
  given: number; // discounts + rewards (Completed orders)
  lost: number; // cancelled bill value + removed item value
}

export type DiscountRowKind = "manual" | "gst" | "reward";

export interface CancelledBillRow {
  id: string; // Order _id
  orderId: string;
  billNumber?: number; // present only if a bill was already issued
  day: string; // IST day key of the order's createdAt (the report's bucket)
  at: string; // ISO — cancelledAt, else createdAt
  value: number; // total
  paid: number; // paidAmount (money taken before it was cancelled)
  by: string; // cancelledBy ("" when unknown)
  reason: string; // cancelReason
  customerName: string;
  tableNo: string; // "" when not a table order
}

export interface RemovedItemRow {
  orderId: string;
  day: string; // IST day key of the ORDER's createdAt
  at: string; // ISO — the void's own `at`
  item: string; // label as sold ("name (variation)")
  qty: number;
  value: number; // 0 for a removed free reward line
  by: string; // voidedBy
  reason: string;
}

export interface DiscountRow {
  orderId: string;
  billNumber?: number;
  day: string;
  at: string; // ISO createdAt
  kind: DiscountRowKind;
  amount: number; // manual/gst: the discount · reward: the bill's reward value
  billTotal: number;
  /** Who took the order (`receiver`) — the order holds no "discount given by". */
  by: string;
  customerName: string;
}

export interface StaffLeakRow {
  name: string; // "" = not recorded (older orders)
  cancelled: { count: number; value: number };
  removed: { lines: number; value: number };
  discounts: { orders: number; amount: number }; // manual + GST only, by order taker
}

export interface ReasonRow {
  kind: "cancel" | "remove";
  reason: string; // as first written (grouping ignores case + surrounding spaces)
  count: number;
  value: number;
}

export interface CancelsReport {
  range: DashboardRange;
  compare: ReportCompare;
  kpis: { current: LeakTotals; previous: LeakTotals };
  mode: DashboardSeriesMode;
  /** Every day of the range (day mode) / every hour with activity (hour mode), zero buckets included in day mode. */
  series: LeakPoint[];
  /** Newest first; capped — `truncated` when kpis.current has more than the rows listed. */
  cancelled: { rows: CancelledBillRow[]; truncated: boolean };
  removed: { rows: RemovedItemRow[]; truncated: boolean };
  /** Discount AND reward bills, newest first. */
  discounts: { rows: DiscountRow[]; truncated: boolean };
  /** Over ALL of the range's events (never the capped rows); most money first. */
  byStaff: StaffLeakRow[];
  /** Over ALL events; most frequent first. */
  reasons: ReasonRow[];
}

// ── GST ──────────────────────────────────────────────────────────────────────
// Per bill, EXACTLY the printed bill's rule: lib/receipt.ts receiptGst() with
// the order's own rate/mode snapshot (legacy orders without one fall back to
// the cafe's current GST settings, as the reprinted bill does). Whole rupees
// per bill; CGST = SGST = GST / 2 (shown to the paisa). Charges (table +
// staff extras) are never taxed. Identity, exact per bill and so per day/range:
//   taxable + gst + noGst + charges === Σ total (= Sales summary net sales)

export interface GstRateRow {
  rate: number; // percent, e.g. 5
  bills: number;
  taxable: number;
  gst: number;
  value: number; // taxable + gst (charges excluded)
}

/** GSTR-1 Table 13 style — daily bill numbers restart at the cafe's restart time, so each day is its own series (GST invoice serials: see GstInvoices). */
export interface GstDocs {
  first: number | null; // lowest billNumber that day (null when none numbered)
  last: number | null;
  numbered: number; // bills holding a number: Completed + Cancelled-after-billing
  cancelled: number; // of those, cancelled after the bill was issued
  unnumbered: number; // Completed bills with no bill number (numbering off / older bills)
}

/**
 * GST invoice serials (print customization S10), per day and for the whole range. One series runs the whole
 * financial year (never restarts daily), so a day always belongs to ONE financial year. For a RANGE, `fy` is that
 * financial year (start year, e.g. 2026 = 2026-27) only when every numbered invoice is in the same one; when the
 * range crosses 1 April it is null and first/last are null too (serials of two years never share one range), while
 * the counts stay exact.
 */
export interface GstInvoices {
  fy: number | null; // null when nothing is numbered, or (range level) the numbered invoices span two financial years
  first: number | null; // lowest invoice serial in that financial year
  last: number | null;
  numbered: number; // paid bills holding an invoice number: Completed + Cancelled-after-billing
  cancelled: number; // of those, cancelled after the invoice was issued (GSTR-1 Table 13)
  without: number; // Completed GST bills with no invoice number (paid before invoice numbers, or a rare numbering gap)
}

export interface GstDayRow {
  date: string;
  bills: number; // Completed bills
  taxable: number;
  gst: number;
  noGst: number; // value of bills that carried no GST (charges excluded)
  charges: number;
  value: number; // Σ total
  docs: GstDocs;
  invoices: GstInvoices;
}

export interface GstBillRow {
  date: string;
  at: string; // ISO createdAt
  billNumber?: number;
  invoiceNumber?: number; // running serial; set together with invoiceFy
  invoiceFy?: number;
  orderId: string;
  rate: number; // 0 = no GST on this bill
  inclusive: boolean;
  taxable: number; // 0 when rate is 0
  gst: number;
  noGst: number;
  charges: number;
  total: number;
  payment: string;
}

export interface GstReport {
  range: DashboardRange;
  bills: number;
  taxable: number;
  gst: number;
  noGst: number;
  noGstBills: number;
  charges: number;
  /** Σ total of Completed bills — must equal the Sales summary for the range. */
  netSales: number;
  /** Rates that carried tax, highest first. */
  rates: GstRateRow[];
  /** Every day of the range, oldest first. */
  days: GstDayRow[];
  /** Range totals (first/last are per day — see days[].docs). */
  docs: Omit<GstDocs, "first" | "last">;
  /** Range-level GST invoice summary (see GstInvoices: `fy` is null when the range spans two financial years). */
  invoices: GstInvoices;
  /** Only when requested (?bills=1) — the bill-wise CSV, oldest first. */
  billRows?: GstBillRow[];
}
