"use client";

import { useCallback, useMemo, type MutableRefObject } from "react";

import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { usePrintJobFeed } from "@/components/layout/PosPulseProvider";
import { usePrintHostBeat } from "@/hooks/use-print-host-beat";
import { usePrintHostDrain, type ClaimedPrintJobLike } from "@/hooks/use-print-host-drain";
import { usePrintHostDrainLock } from "@/hooks/use-print-host-lock";
import { usePrintHostWake } from "@/hooks/use-print-host-wake";
import { usePrintHostWakeLock } from "@/hooks/use-print-host-wake-lock";
import { usePrintRealtime } from "@/hooks/use-realtime";
import { useSelfOrderAutoPrint } from "@/hooks/use-self-order-auto-print";
import { hostPrintSlipOf, type HostPrintSlip } from "@/lib/print-host-slips";
import { cafeDateString } from "@/lib/utils";
import type { Order } from "@/types";

interface PrintHostDrainProps {
  /** `isHostDevice` — the pref is on and this device has an identity. */
  enabled: boolean;
  deviceId: string;
  tabId: string;
  busy: boolean;
  claimLockRef: MutableRefObject<boolean>;
  onSlip: (slip: HostPrintSlip) => void;
  onKotRound: (order: Order, round?: number) => void;
  onDemoted: () => void;
}

// Print-host plan §B5/§B6 (PH-5) — the host's three lanes in one null-
// rendering child of PrintHostProvider (the SelfOrderAutoPrint pattern): the
// print-job drain, the self-order lane, and the heartbeat, all armed by the
// same `enabled`. It is the component that subscribes to pulse-derived state,
// so a payload-changing tick re-renders THIS and nothing on screen. The
// self-order lane here consumes the wide pulse through useSelfOrderAutoPrint
// (an existing consumer); the drain reads the narrow feed context only.
export function PrintHostDrain({
  enabled,
  deviceId,
  tabId,
  busy,
  claimLockRef,
  onSlip,
  onKotRound,
  onDemoted,
}: PrintHostDrainProps) {
  // Exactly one draining window per host PC (MERGED-23): both claiming lanes
  // wait for the lock; the beat and the wake lock do not — a second window is
  // still this device, and its beats are as truthful as the holder's.
  const holdsLock = usePrintHostDrainLock(enabled);
  const drains = enabled && holdsLock;

  usePrintHostWakeLock(enabled);
  usePrintHostBeat({ enabled, deviceId, onDemoted });

  // Stable identities, so neither lane's effect re-runs on this child's own
  // per-tick renders (the ref never changes; the constant never changes).
  const hostLane = useMemo(() => ({ claimLock: claimLockRef, maxAgeMs: PRINT_HOST_MAX_AGE_MS }), [claimLockRef]);
  useSelfOrderAutoPrint({ enabled: drains, busy, queueKotRound: onKotRound, hostLane });

  // `cafeDateString()` at CLAIM time is the host's cafe-day the eod slip's
  // open-tabs applicability is derived from (PH-6 MUST — rollover noted in
  // lib/print-host-slips.ts).
  const onClaimed = useCallback(
    (job: ClaimedPrintJobLike) => onSlip(hostPrintSlipOf(job.payload, cafeDateString())),
    [onSlip],
  );

  const feed = usePrintJobFeed();
  // CB-U1 — the fast wake poll, armed by the SAME `drains` gate as the two
  // claiming lanes: only the lock-holding host tab polls (plan §B4 amendment).
  usePrintHostWake({ drains, feed });
  // Socket slice 2 — the realtime nudge that EARNS the relaxed wake cadence
  // above. Mounted on this one component, which is already gated to the single
  // lock-holding host tab, so there is exactly one subscriber per device (and
  // the connection itself is shared and refcounted in lib/realtime-client.ts).
  // If the socket is down the wake poll notices on its own and snaps back to
  // the 3s cadence — this hook is a pure accelerator, never a dependency.
  usePrintRealtime();
  usePrintHostDrain({ enabled: drains, feed, busy, deviceId, tabId, claimLockRef, onClaimed, onDemoted });

  return null;
}
