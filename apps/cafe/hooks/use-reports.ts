"use client";

import { keepPreviousData, useQuery, type QueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { STALE_TIMES } from "@/lib/query";
import { gstBillChunks } from "@/lib/reports/gst-display";
import type { DashboardRange } from "@/types/dashboard";
import type { SalesReport, DuesReport, ItemsReport, ItemDetail, CancelsReport, GstBillRow, GstReport } from "@/types/reports";

// The Reports screens' data (Batch 1 — sales, payments, dues; Batch 2 — items,
// cancels, gst). `all` is a prefix every one of the keys below falls under;
// use-customers.ts's useReceiveDuePayment/useEditDuePayment/useDeleteDuePayment
// invalidate it — keep it exactly ["reports"].
export const REPORT_KEYS = {
  all: ["reports"] as const,
  sales: (r: DashboardRange) => ["reports", "sales", r.from, r.to] as const,
  dues: (r: DashboardRange) => ["reports", "dues", r.from, r.to] as const,
  items: (r: DashboardRange) => ["reports", "items", r.from, r.to] as const,
  cancels: (r: DashboardRange) => ["reports", "cancels", r.from, r.to] as const,
  gst: (r: DashboardRange) => ["reports", "gst", r.from, r.to] as const,
  gstBills: (r: DashboardRange) => ["reports", "gst", r.from, r.to, "bills"] as const,
  itemDetail: (r: DashboardRange, key: string) => ["reports", "items", r.from, r.to, "detail", key] as const,
};

function rangeQuery(r: DashboardRange): string {
  return `?from=${r.from}&to=${r.to}`;
}

// Sales summary + Payments & cash tally share this one query (same range —
// the Payments page reads the same SalesReport, different presentation).
export function useSalesReport(range: DashboardRange, enabled = true) {
  return useQuery({
    enabled,
    queryKey: REPORT_KEYS.sales(range),
    queryFn: () => apiGet<SalesReport>(`/api/reports/sales${rangeQuery(range)}`),
    staleTime: STALE_TIMES.REPORTS,
    placeholderData: keepPreviousData,
  });
}

export function useDuesReport(range: DashboardRange, enabled = true) {
  return useQuery({
    enabled,
    queryKey: REPORT_KEYS.dues(range),
    queryFn: () => apiGet<DuesReport>(`/api/reports/dues${rangeQuery(range)}`),
    staleTime: STALE_TIMES.REPORTS,
    placeholderData: keepPreviousData,
  });
}

export function useItemsReport(range: DashboardRange, enabled = true) {
  return useQuery({
    enabled,
    queryKey: REPORT_KEYS.items(range),
    queryFn: () => apiGet<ItemsReport>(`/api/reports/items${rangeQuery(range)}`),
    staleTime: STALE_TIMES.REPORTS,
    placeholderData: keepPreviousData,
  });
}

export function useCancelsReport(range: DashboardRange, enabled = true) {
  return useQuery({
    enabled,
    queryKey: REPORT_KEYS.cancels(range),
    queryFn: () => apiGet<CancelsReport>(`/api/reports/cancels${rangeQuery(range)}`),
    staleTime: STALE_TIMES.REPORTS,
    placeholderData: keepPreviousData,
  });
}

export function useGstReport(range: DashboardRange, enabled = true) {
  return useQuery({
    enabled,
    queryKey: REPORT_KEYS.gst(range),
    queryFn: () => apiGet<GstReport>(`/api/reports/gst${rangeQuery(range)}`),
    staleTime: STALE_TIMES.REPORTS,
    placeholderData: keepPreviousData,
  });
}

/** An item's drill-down (ItemSheet) — enabled only once a row/bar has been tapped. */
export function useItemDetail(range: DashboardRange, item: { productId: string; label: string; key: string } | null) {
  return useQuery({
    enabled: !!item,
    queryKey: REPORT_KEYS.itemDetail(range, item?.key ?? ""),
    queryFn: () =>
      apiGet<ItemDetail>(
        `/api/reports/items/detail${rangeQuery(range)}&productId=${encodeURIComponent(item!.productId)}&label=${encodeURIComponent(item!.label)}`,
      ),
    staleTime: STALE_TIMES.REPORTS,
    placeholderData: keepPreviousData,
  });
}

/** The GST bill-wise CSV — fetched on demand (Download bill-wise CSV), not a standing query. */
// The bill-wise CSV walks the range in GST_BILLS_MAX_DAYS chunks, oldest
// first (the route refuses a longer bills request — Vercel's 4.5 MB response
// cap), so the joined rows stay in date order.
export async function fetchGstBills(queryClient: QueryClient, range: DashboardRange): Promise<GstBillRow[]> {
  const rows: GstBillRow[] = [];
  for (const chunk of gstBillChunks(range)) {
    const part = await queryClient.fetchQuery({
      queryKey: REPORT_KEYS.gstBills(chunk),
      queryFn: () => apiGet<GstReport>(`/api/reports/gst${rangeQuery(chunk)}&bills=1`),
      staleTime: STALE_TIMES.REPORTS,
    });
    rows.push(...(part.billRows ?? []));
  }
  return rows;
}
