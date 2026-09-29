"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { STALE_TIMES } from "@/lib/query";
import type { DashboardRange } from "@/types/dashboard";
import type { SalesReport, DuesReport } from "@/types/reports";

// The Reports screens' data (Batch 1 — sales, payments, dues). `all` is a
// prefix every one of the three keys below falls under; use-customers.ts's
// useReceiveDuePayment/useEditDuePayment/useDeleteDuePayment invalidate it —
// keep it exactly ["reports"].
export const REPORT_KEYS = {
  all: ["reports"] as const,
  sales: (r: DashboardRange) => ["reports", "sales", r.from, r.to] as const,
  dues: (r: DashboardRange) => ["reports", "dues", r.from, r.to] as const,
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
