"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { reachOf } from "@/lib/offline-state";
import { serverReach } from "@/lib/server-reach";
import { pulsePrintDeviceQuery } from "@/lib/print-agent";
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
  const query = useQuery({
    queryKey: POS_PULSE_KEYS.all,
    // Session 1C: with no host, the print agent names this device here (?device=) — no new request.
    queryFn: () => apiGet<PosPulseData>(`${POS_PULSE_ENDPOINT}${pulsePrintDeviceQuery()}`),
    staleTime: STALE_TIMES.LIVE,
    refetchInterval: REFETCH_INTERVALS.POS_PULSE,
    refetchIntervalInBackground: true,
  });
  // Printing Phase 5 (spec 5.1): each tick's result feeds the page's offline state, once per tick (a tick's one retry
  // is the same tick): an answer reached us; a failed tick by reachOf (our own 4xx reached us, a 5xx or a host page not).
  const { dataUpdatedAt, errorUpdateCount, error } = query;
  useEffect(() => {
    if (dataUpdatedAt > 0) serverReach.report({ type: "pulse", reach: "reached" });
  }, [dataUpdatedAt]);
  useEffect(() => {
    if (errorUpdateCount > 0) serverReach.report({ type: "pulse", reach: reachOf(error) });
  }, [errorUpdateCount, error]);
  return query;
}
