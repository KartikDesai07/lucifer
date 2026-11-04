"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { reachOf } from "@/lib/offline-state";
import { serverReach } from "@/lib/server-reach";
import { cadenceVersionOf, currentPulseIntervalMs, markOwnSlip, subscribeCadence } from "@/lib/pulse-cadence-now";
import { pulsePrintDeviceQuery } from "@/lib/print-agent";
import { STALE_TIMES } from "@/lib/query";
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
/** The writes that make slips (send, Pay Now, settle, void, move share ORDER_KEYS.mutation; every client-started
 *  slip goes through the print-jobs enqueue): spelt here so this module imports neither hook. */
const SLIP_MAKING_MUTATIONS = new Set([JSON.stringify(["orders", "mutation"]), JSON.stringify(["print-jobs", "mutation"])]);

export function usePosPulse() {
  const qc = useQueryClient();
  // Printing Phase 5 (spec 5.11): a local input of the cadence changed (an own slip, offline, the outbox, a realtime
  // drop): this render makes TanStack re-read the interval below. No request.
  useSyncExternalStore(subscribeCadence, cadenceVersionOf, () => 0);
  useEffect(
    () =>
      qc.getMutationCache().subscribe((event) => {
        if (event.type === "updated" && event.action.type === "success" && SLIP_MAKING_MUTATIONS.has(JSON.stringify(event.mutation.options.mutationKey ?? []))) markOwnSlip();
      }),
    [qc],
  );
  const query = useQuery({
    queryKey: POS_PULSE_KEYS.all,
    // Session 1C: with no host, the print agent names this device here (?device=) — no new request.
    queryFn: () => apiGet<PosPulseData>(`${POS_PULSE_ENDPOINT}${pulsePrintDeviceQuery()}`),
    staleTime: STALE_TIMES.LIVE,
    // Printing Phase 5 (spec 5.11, P5-6): 20 s while anything may need this device, 60 s when quiet.
    refetchInterval: (q) => currentPulseIntervalMs(q.state.data),
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
