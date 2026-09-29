"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { REFETCH_INTERVALS } from "@/lib/query";
import { rangeIncludesToday } from "@/lib/dashboard/range";
import type { DashboardData, DashboardLive, DashboardRange } from "@/types/dashboard";

export const DASHBOARD_KEYS = {
  all: ["dashboard"] as const,
  range: (range: DashboardRange) => ["dashboard", "range", range.from, range.to] as const,
  // Refetched by realtime nudges (hooks/use-realtime.ts DASHBOARD_REALTIME).
  live: ["dashboard", "live"] as const,
};

/**
 * The chosen range's numbers. Switching range keeps the previous numbers on
 * screen (dimmed by the page) until the new ones land — no skeleton flash,
 * no layout jump. Only a range that includes today keeps polling.
 */
export function useDashboard(range: DashboardRange, enabled = true) {
  const live = rangeIncludesToday(range);
  return useQuery({
    enabled,
    queryKey: DASHBOARD_KEYS.range(range),
    queryFn: () => apiGet<DashboardData>(`/api/dashboard?from=${range.from}&to=${range.to}`),
    staleTime: REFETCH_INTERVALS.SUMMARY,
    refetchInterval: live ? REFETCH_INTERVALS.SUMMARY : false,
    placeholderData: keepPreviousData,
  });
}

/** The "Needs attention" strip — nudged by realtime, polled as the fallback. */
export function useDashboardLive() {
  return useQuery({
    queryKey: DASHBOARD_KEYS.live,
    queryFn: () => apiGet<DashboardLive>("/api/dashboard/live"),
    staleTime: 0,
    refetchInterval: REFETCH_INTERVALS.LIVE_LISTS,
  });
}
