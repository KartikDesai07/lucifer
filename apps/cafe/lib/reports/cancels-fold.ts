// Leak facet rows -> CancelsReport — pure (no DB); mirrors
// lib/reports/sales-fold.ts's own split. `totals`/`cancelled`/`voids` are the
// Dashboard's own leaks card, so this report's KPIs never disagree with it.
import { addDays, compareLabel, compareRange, dayLabel, hourLabel } from "@/lib/dashboard/range";
import type {
  CancelledBillFacetRow,
  DiscountFacetRow,
  LeakCancelledRow,
  LeakCompareFacet,
  LeakFacet,
  LeakSeriesRow,
  LeakTotalsRow,
  LeakVoidsRow,
  ReasonFacetRow,
  StaffCancelledRow,
  StaffDiscountRow,
  StaffRemovedRow,
} from "@/lib/reports/cancels-pipelines";
import type { DashboardRange, DashboardSeriesMode } from "@/types/dashboard";
import type {
  CancelledBillRow,
  CancelsReport,
  DiscountRow,
  LeakPoint,
  LeakTotals,
  ReasonRow,
  RemovedItemRow,
  StaffLeakRow,
} from "@/types/reports-b2";

export const LEAK_ROWS_LIMIT = 300;
const GST_DISCOUNT_KIND = "gst";

function foldLeakTotals(
  totals: LeakTotalsRow | undefined,
  cancelled: LeakCancelledRow | undefined,
  voids: LeakVoidsRow | undefined,
): LeakTotals {
  return {
    discounts: { orders: totals?.discountedOrders ?? 0, amount: totals?.discount ?? 0 },
    rewards: { orders: totals?.rewardedOrders ?? 0, amount: totals?.reward ?? 0 },
    cancelled: { count: cancelled?.count ?? 0, value: cancelled?.value ?? 0 },
    voids: { lines: voids?.lines ?? 0, qty: voids?.qty ?? 0, value: voids?.value ?? 0 },
  };
}

function foldSeries(mode: DashboardSeriesMode, range: DashboardRange, given: LeakSeriesRow[], cancelled: LeakSeriesRow[], voids: LeakSeriesRow[]): LeakPoint[] {
  const givenMap = new Map(given.map((r) => [String(r._id), r.amount]));
  const cancelledMap = new Map(cancelled.map((r) => [String(r._id), r.amount]));
  const voidMap = new Map(voids.map((r) => [String(r._id), r.amount]));
  const lost = (key: string) => (cancelledMap.get(key) ?? 0) + (voidMap.get(key) ?? 0);

  if (mode === "day") {
    const points: LeakPoint[] = [];
    for (let key = range.from; key <= range.to; key = addDays(key, 1)) {
      points.push({ key, label: dayLabel(key), given: givenMap.get(key) ?? 0, lost: lost(key) });
    }
    return points;
  }

  const hours = [...givenMap.keys(), ...cancelledMap.keys(), ...voidMap.keys()].map(Number);
  if (hours.length === 0) return [];
  const points: LeakPoint[] = [];
  for (let h = Math.min(...hours); h <= Math.max(...hours); h++) {
    const key = String(h);
    points.push({ key, label: hourLabel(h), given: givenMap.get(key) ?? 0, lost: lost(key) });
  }
  return points;
}

function isoAt(cancelledAt: Date | undefined, createdAt: Date): string {
  return (cancelledAt ?? createdAt).toISOString();
}

function foldCancelledRows(rows: CancelledBillFacetRow[]): CancelledBillRow[] {
  return rows.map((r) => ({
    id: String(r._id),
    orderId: r.orderId,
    ...(r.billNumber !== undefined ? { billNumber: r.billNumber } : {}),
    day: r.day,
    at: isoAt(r.cancelledAt, r.createdAt),
    value: r.total,
    paid: r.paidAmount,
    by: r.cancelledBy ?? "",
    reason: r.cancelReason ?? "",
    customerName: r.customerName,
    tableNo: r.tableNo ?? "",
  }));
}

function foldRemovedRows(rows: Array<{ orderId: string; day: string; at: Date; item: string; qty: number; value: number; voidedBy?: string; reason: string }>): RemovedItemRow[] {
  return rows.map((r) => ({
    orderId: r.orderId,
    day: r.day,
    at: r.at.toISOString(),
    item: r.item,
    qty: r.qty,
    value: r.value,
    by: r.voidedBy ?? "",
    reason: r.reason,
  }));
}

/** discountRows ∪ rewardRows, newest first (tie: kind, so the order is deterministic). */
function foldDiscountRows(discountRows: DiscountFacetRow[], rewardRows: DiscountFacetRow[]): DiscountRow[] {
  const toRow = (r: DiscountFacetRow, kind: DiscountRow["kind"]): DiscountRow => ({
    orderId: r.orderId,
    ...(r.billNumber !== undefined ? { billNumber: r.billNumber } : {}),
    day: r.day,
    at: r.createdAt.toISOString(),
    kind,
    amount: r.amount,
    billTotal: r.billTotal,
    by: r.by,
    customerName: r.customerName,
  });
  const rows: DiscountRow[] = [
    ...discountRows.map((r) => toRow(r, r.discountKind === GST_DISCOUNT_KIND ? "gst" : "manual")),
    ...rewardRows.map((r) => toRow(r, "reward")),
  ];
  rows.sort((a, b) => b.at.localeCompare(a.at) || a.kind.localeCompare(b.kind));
  return rows;
}

function foldByStaff(cancelled: StaffCancelledRow[], removed: StaffRemovedRow[], discounts: StaffDiscountRow[]): StaffLeakRow[] {
  const byName = new Map<string, StaffLeakRow>();
  const get = (name: string): StaffLeakRow => {
    const existing = byName.get(name);
    if (existing) return existing;
    const row: StaffLeakRow = {
      name,
      cancelled: { count: 0, value: 0 },
      removed: { lines: 0, value: 0 },
      discounts: { orders: 0, amount: 0 },
    };
    byName.set(name, row);
    return row;
  };
  for (const r of cancelled) get(r._id).cancelled = { count: r.count, value: r.value };
  for (const r of removed) get(r._id).removed = { lines: r.lines, value: r.value };
  for (const r of discounts) get(r._id).discounts = { orders: r.orders, amount: r.amount };

  return [...byName.values()].sort(
    (a, b) =>
      b.cancelled.value + b.removed.value + b.discounts.amount - (a.cancelled.value + a.removed.value + a.discounts.amount) ||
      a.name.localeCompare(b.name),
  );
}

function foldReasons(cancelReasons: ReasonFacetRow[], removeReasons: ReasonFacetRow[]): ReasonRow[] {
  const rows: ReasonRow[] = [
    ...cancelReasons.map((r) => ({ kind: "cancel" as const, reason: r.reason, count: r.count, value: r.value })),
    ...removeReasons.map((r) => ({ kind: "remove" as const, reason: r.reason, count: r.count, value: r.value })),
  ];
  rows.sort((a, b) => b.count - a.count || b.value - a.value || a.reason.localeCompare(b.reason));
  return rows;
}

export interface FoldCancelsReportInput {
  range: DashboardRange;
  mode: DashboardSeriesMode;
  facet: LeakFacet;
  compare: LeakCompareFacet;
}

export function foldCancelsReport({ range, mode, facet, compare }: FoldCancelsReportInput): CancelsReport {
  const totals = facet.totals[0];
  const cancelled = facet.cancelled[0];
  const voids = facet.voids[0];

  const cancelledRows = foldCancelledRows(facet.cancelledRows);
  const removedRows = foldRemovedRows(facet.removedRows);
  const discountRows = foldDiscountRows(facet.discountRows, facet.rewardRows);

  return {
    range,
    compare: { ...compareRange(range), label: compareLabel(range) },
    kpis: {
      current: foldLeakTotals(totals, cancelled, voids),
      previous: foldLeakTotals(compare.totals[0], compare.cancelled[0], compare.voids[0]),
    },
    mode,
    series: foldSeries(mode, range, facet.givenSeries, facet.cancelledSeries, facet.voidSeries),
    cancelled: { rows: cancelledRows, truncated: cancelledRows.length < (cancelled?.count ?? 0) },
    removed: { rows: removedRows, truncated: removedRows.length < (voids?.lines ?? 0) },
    discounts: {
      rows: discountRows,
      truncated: facet.discountRows.length < (totals?.discountedOrders ?? 0) || facet.rewardRows.length < (totals?.rewardedOrders ?? 0),
    },
    byStaff: foldByStaff(facet.staffCancelled, facet.staffRemoved, facet.staffDiscounts),
    reasons: foldReasons(facet.cancelReasons, facet.removeReasons),
  };
}
