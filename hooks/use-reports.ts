"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { STALE_TIMES } from "@/lib/query";
import type { Report } from "@/types";

export interface ReportRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export const REPORT_KEYS = {
  all: ["reports"] as const,
  range: (range: ReportRange) => ["reports", range] as const,
};

function buildQuery(range: ReportRange): string {
  const sp = new URLSearchParams();
  sp.set("startDate", range.startDate);
  sp.set("endDate", range.endDate);
  return `?${sp.toString()}`;
}

// Date-range analytics for the reports page. Cached briefly — reports are
// reviewed, not live POS data, and the same range is often re-opened.
export function useReport(range: ReportRange, enabled = true) {
  return useQuery({
    queryKey: REPORT_KEYS.range(range),
    queryFn: () => apiGet<Report>(`/api/reports${buildQuery(range)}`),
    enabled,
    staleTime: STALE_TIMES.REPORTS,
  });
}
