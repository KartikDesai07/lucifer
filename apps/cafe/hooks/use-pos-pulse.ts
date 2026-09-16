"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { STALE_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import type { PosPulseData } from "@pos/shared/self-order-alert";

// CR2.3 §20 — the ONE 20s staff-attention poll per tab, replacing the old
// per-widget 20s badge poll (requests/min is unchanged). This hook must be
// called from EXACTLY ONE place — PosPulseProvider, mounted once in the
// dashboard layout: a second observer would arm a SECOND, phase-shifted
// refetchInterval timer against the same endpoint, doubling the poll rate
// the whole point of hoisting this above the badge's own poll was to avoid.
export const POS_PULSE_KEYS = {
  all: ["pos-pulse"] as const,
};

const POS_PULSE_ENDPOINT = "/api/order-requests/pulse";

// refetchIntervalInBackground:true — TanStack Query v5 pauses refetchInterval
// polling entirely on a hidden/backgrounded tab unless this flag is set
// (tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching);
// without it, a staff terminal with this tab merely unfocused (a second
// monitor, a switched app) would silently stop alerting. The browser's own
// throttling of a hidden tab's timers to ~1/min past ~5 minutes hidden is a
// separate, unavoidable limit — accepted, never fought (§20).
export function usePosPulse() {
  return useQuery({
    queryKey: POS_PULSE_KEYS.all,
    queryFn: () => apiGet<PosPulseData>(POS_PULSE_ENDPOINT),
    staleTime: STALE_TIMES.LIVE,
    refetchInterval: REFETCH_INTERVALS.POS_PULSE,
    refetchIntervalInBackground: true,
  });
}
