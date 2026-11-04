// The calm pulse wired (Printing Phase 5, spec 5.11; plan Task 16). pulseIntervalMs (lib/pos-pulse-cadence.ts) decides
// from the page's own inputs and the last pulse answer; this module reads those inputs (realtime proven, the offline
// state, the outbox, this device's own slip-making writes) and tells the pulse's provider when one of them changes, so
// TanStack re-reads the interval (it re-reads it only on a query update or a render). No request of its own.

import type { PosPulseData } from "@pos/shared/self-order-alert";
import { realtimeTrusted } from "@/lib/live-poll";
import { offlineOutbox } from "@/lib/offline-outbox-store";
import { pulseIntervalMs, type PulseCadenceInput } from "@/lib/pos-pulse-cadence";
import { subscribeRealtimeDown } from "@/lib/realtime-client";
import { serverReach } from "@/lib/server-reach";

export interface LocalCadence {
  trusted: boolean;
  offline: boolean;
  outboxEntries: number;
  lastOwnSlipAt: number | null;
}

/** No answer yet proves nothing quiet: it counts as realtime not proven (lively). */
export function cadenceInputsOf(data: PosPulseData | undefined, local: LocalCadence, nowMs: number): PulseCadenceInput {
  return {
    realtimeTrusted: local.trusted && data !== undefined,
    offline: local.offline,
    outboxEntries: local.outboxEntries,
    printAttention: data?.printAttention?.length ?? 0,
    printJobsForMe: data?.printJobsForMe?.count ?? 0,
    openRequests: data?.openCount ?? 0,
    lastOwnSlipAt: local.lastOwnSlipAt,
    nowMs,
  };
}

/** This device's own slip-making writes (send, Pay Now, settle, void, move, reprint, a replay): it watches for its
 *  own slip for PULSE_OWN_SLIP_WINDOW_MS. `version` moves on each change (a snapshot with no time in it). */
export function createOwnSlips() {
  let lastAt: number | null = null;
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    mark(nowMs: number) {
      lastAt = nowMs;
      version += 1;
      for (const listener of [...listeners]) listener();
    },
    lastAt: () => lastAt,
    version: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const ownSlips = createOwnSlips();

export const markOwnSlip = (): void => ownSlips.mark(Date.now());

/** The pulse's interval now, from its last answer and this page's inputs. */
export function currentPulseIntervalMs(data: PosPulseData | undefined, nowMs: number = Date.now()): number {
  const local: LocalCadence = {
    trusted: realtimeTrusted(nowMs),
    offline: serverReach.isOffline(),
    outboxEntries: offlineOutbox.getSnapshot().record?.entries.length ?? 0,
    lastOwnSlipAt: ownSlips.lastAt(),
  };
  return pulseIntervalMs(cadenceInputsOf(data, local, nowMs));
}

let cadenceVersion = 0;

/** A local input changed (an own slip, the offline state, the outbox, a realtime drop): the provider re-renders. */
export function subscribeCadence(listener: () => void): () => void {
  const bump = () => {
    cadenceVersion += 1;
    listener();
  };
  const offs = [ownSlips.subscribe(bump), serverReach.subscribe(bump), offlineOutbox.subscribe(bump), subscribeRealtimeDown(bump)];
  return () => {
    for (const off of offs) off();
  };
}

export const cadenceVersionOf = (): number => cadenceVersion;
