"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  PRINT_WAKE_ACTIVE_WINDOW_MS,
  PRINT_WAKE_DAILY_CAP,
  PRINT_WAKE_FAST_MS,
  PRINT_WAKE_SLOW_MS,
  type PrintJobFeedRow,
  type PrintWakeData,
} from "@pos/shared/print-job";
import { apiGet } from "@/lib/api-client";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import {
  bumpPrintWakeBudget,
  mergePrintWakeBudget,
  readPrintWakeBudget,
  writePrintWakeBudget,
  type PrintWakeBudget,
} from "@/lib/print-wake-budget";
import { cafeDateString } from "@/lib/utils";
import { isDesktopShell } from "@/lib/desktop-shell";

// CB-U1 — the host's adaptive wake poll (plan §B4 amendment: ONE extra poll
// from the ONE lock-holding draining host tab, not a second 20s poll from
// every open tab). FAST (3s) while "active" (a feed change within the last
// hour); SLOW (15s) otherwise, and also while the route is failing (F-D: no
// storm, no toast — a success restores FAST). The route answers with a
// CHANGE SIGNAL — the newest drain-eligible job's id — so the pos-pulse query
// invalidates only once per NEW job, never once per tick (F-A): a row the
// host is busy printing keeps the same id. Bounded three ways: a hidden
// browser tab never fetches — TanStack's focusManager gate gives up the
// moment visibilityState !== "visible" (refetchIntervalInBackground:false) —
// while a desktop-shell host is never hidden in that sense: the PC IS the
// counter, so it keeps the cadence going in the tray (see the inline comment
// below); a daily hit cap degrades to SLOW-forever once spent; and the feed
// arrives as a PROP — this hook never reaches the wide pulse context or the
// print-job feed context itself.
export const PRINT_WAKE_KEYS = { all: ["print-wake"] as const };

const WAKE_ENDPOINT = "/api/print-jobs/wake";

export function usePrintHostWake({ drains, feed }: { drains: boolean; feed: PrintJobFeedRow[] }): void {
  const qc = useQueryClient();

  // A changed feed REFERENCE means a row appeared or left — TanStack's
  // structural sharing keeps an unchanged array's identity, so this effect
  // only re-arms on a real change. It also fires on mount, so a host tab
  // reload during service starts FAST for the first hour.
  const activeUntilRef = useRef(0);
  useEffect(() => {
    activeUntilRef.current = Date.now() + PRINT_WAKE_ACTIVE_WINDOW_MS;
  }, [feed]);

  // Set by the queryFn once the per-device daily cap is spent; once true the
  // interval falls back to SLOW permanently for the rest of the day
  // (readPrintWakeBudget's dayKey rollover clears it again next cafe-day).
  const capSpentRef = useRef(false);
  // Set on a thrown queryFn; cleared on success — an unreachable route is
  // retried on the SLOW cadence, never FAST (F-D).
  const failedRef = useRef(false);
  // In-memory half of the budget merge (F-C): a localStorage that silently
  // fails every read would otherwise look identical to "never bumped" and
  // reset the cap every tick. Merged with storage (higher count wins), so a
  // dead localStorage can only make the cap MORE strict, never defeat it.
  const memoryBudgetRef = useRef<PrintWakeBudget | null>(null);
  // The newestId this hook has already invalidated on; reset to null once
  // the route reports nothing pending.
  const lastNewestIdRef = useRef<string | null>(null);

  const { data, dataUpdatedAt } = useQuery({
    queryKey: PRINT_WAKE_KEYS.all,
    queryFn: async () => {
      const dayKey = cafeDateString();
      const seed = mergePrintWakeBudget(readPrintWakeBudget(), memoryBudgetRef.current, dayKey);
      const { record, allowed } = bumpPrintWakeBudget(seed, dayKey, PRINT_WAKE_DAILY_CAP);
      memoryBudgetRef.current = record;
      writePrintWakeBudget(record);
      capSpentRef.current = !allowed;
      if (!allowed) return { pending: false, newestId: null } satisfies PrintWakeData;
      try {
        const data = await apiGet<PrintWakeData>(WAKE_ENDPOINT);
        failedRef.current = false;
        return data;
      } catch (error) {
        failedRef.current = true;
        throw error;
      }
    },
    enabled: drains,
    staleTime: 0,
    retry: false,
    refetchIntervalInBackground: isDesktopShell(),
    // In a browser tab this stays false: TanStack skips the fetch entirely
    // once the tab is hidden. On a desktop-shell host this is true — the
    // shell's own backgroundThrottling:false already keeps
    // document.visibilityState "visible" while the window is hidden to the
    // tray, so this is the explicit guarantee that the poll never pauses
    // there. Either way a failing route (F-D) is retried on the SLOW cadence
    // too, until a fetch succeeds again.
    refetchInterval: () =>
      !capSpentRef.current && !failedRef.current && Date.now() < activeUntilRef.current
        ? PRINT_WAKE_FAST_MS
        : PRINT_WAKE_SLOW_MS,
  });

  // Keyed on dataUpdatedAt so this fires once per FETCH. Change-signal rule
  // (F-A): invalidate ONLY when `newestId` changes — once per NEW job, never
  // once per tick. Default cancelRefetch (true, by omission) is deliberate:
  // an in-flight 20 s-tick pulse started BEFORE this job's insert would
  // otherwise satisfy the invalidation with stale data and strand the new
  // job until the next tick — cancelling costs at most one duplicate fetch.
  useEffect(() => {
    if (!data) return;
    if (!data.pending) {
      lastNewestIdRef.current = null;
      return;
    }
    if (data.newestId === lastNewestIdRef.current) return;
    lastNewestIdRef.current = data.newestId;
    void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
  }, [data, dataUpdatedAt, qc]);

  // Errors carry no information beyond the failedRef backoff (retry:false,
  // isError ignored): no invalidation, no toast — the next tick retries.
}
