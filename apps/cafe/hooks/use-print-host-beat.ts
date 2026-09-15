"use client";

import { useEffect } from "react";
import { hashKey, useMutation, useQueryClient } from "@tanstack/react-query";

import type { PrintHostState } from "@pos/shared/print-job";
import { apiSend } from "@/lib/api-client";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { PRINT_JOB_KEYS } from "@/hooks/use-print-host";

// Print-host plan §B3 (PH-5) — the host heartbeat. Fired once per SUCCESSFUL
// pulse fetch, and it proves knowledge of THIS device's own id (D-5): the body
// carries `deviceId` read from local storage by the provider, never the host
// id every tab can read off the pulse payload — otherwise any tab would keep a
// powered-off PC's `lastSeenAt` fresh and the band would never warn. (Named
// obliquely on purpose: the pin over this file scans raw bytes, comments too.)
//
// Trigger (amends MERGED-08's `pulseUpdatedAt`-on-the-context design): a
// QueryCache subscription filtered to the pulse query's `success` action.
// Exposing `dataUpdatedAt` through the pulse context would have re-rendered
// PosPulseProvider AND all five wide consumers on every 20s fetch — TanStack's
// tracked-props optimisation is what keeps a payload-equal tick at ZERO
// renders today (CB-1d.3 measurement) — whereas the cache event fires exactly
// once per fetch with no render at all. `manual` (a setQueryData) is skipped.

/** Client mirror of `lib/print-host.ts`'s `BeatPrintHostResult` (server-only
 *  module; PH-10 parity-pins the pair). `isHost:false` is a normal 200 that
 *  wrote nothing — this device was demoted. */
export type BeatPrintHostResult = { isHost: true; state: PrintHostState } | { isHost: false };

export interface BeatPrintHostInput {
  deviceId: string;
  /** PH-7's attestation write (§B7) — absent on the routine 20s beat. */
  silentMode?: boolean;
  silentProbeMs?: number;
}

const BEAT_ENDPOINT = "/api/print-host/beat";

/** POST /api/print-host/beat. Deliberately SILENT on error: a missed beat is
 *  retried on the very next fetch, and a flaky link would otherwise nag the
 *  host PC every 20s. `onNotHost` is HOOK-level (memory
 *  `tanstack-mutate-callbacks-unmount`). */
export function useBeatPrintHost(opts: { onNotHost?: () => void } = {}) {
  const { onNotHost } = opts;
  return useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: (input: BeatPrintHostInput) => apiSend<BeatPrintHostResult>(BEAT_ENDPOINT, "POST", input),
    onSuccess: (result) => {
      if (!result.isHost) onNotHost?.();
    },
  });
}

interface UsePrintHostBeatOptions {
  enabled: boolean;
  deviceId: string;
  /** The `isHost:false` answer: clear the local pref and stop beating (§B3). */
  onDemoted: () => void;
}

export function usePrintHostBeat({ enabled, deviceId, onDemoted }: UsePrintHostBeatOptions): void {
  const qc = useQueryClient();
  const { mutate: beat } = useBeatPrintHost({ onNotHost: onDemoted });

  useEffect(() => {
    if (!enabled || deviceId === "") return;
    const pulseHash = hashKey(POS_PULSE_KEYS.all);
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.query.queryHash !== pulseHash) return;
      if (event.action.type !== "success" || event.action.manual) return;
      beat({ deviceId });
    });
  }, [enabled, deviceId, qc, beat]);
}
