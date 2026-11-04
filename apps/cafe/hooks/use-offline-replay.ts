"use client";

// The replay runner on the page (Printing Phase 5, spec 5.8; plan Task 13): mounted once per tab in the dashboard
// shell, so the outbox goes out from any staff screen. At each pulse tick (a query cache event: no observer of its
// own, no request of its own) it runs while online, once the last pulse says `offlineReplay`; one tab of the device
// sends (the Web Lock "pos-offline-replay", taken only if free) and every outbox write stays under the outbox lock.
// Each send is the request the online send would have made, with the print headers, so this device's own lines print
// at once as today; the answer's jobs are followed, never a slip enqueued (POST /api/print-jobs).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { REFETCH_INTERVALS } from "@pos/shared/query";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { useOfflineOutbox } from "@/hooks/use-offline-outbox";
import { CUSTOMER_KEYS } from "@/hooks/use-customers";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useServerReach } from "@/hooks/use-server-reach";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { apiSend } from "@/lib/api-client";
import { offlinePrinting } from "@/lib/offline-keep";
import type { OutboxEntry } from "@/lib/offline-outbox-schema";
import { offlineOutbox } from "@/lib/offline-outbox-store";
import { REPLAY_NO_ECHO_MESSAGE, offlineReplayBody, replayReady, replaySendable, replaySentMessage, runOfflineReplay, type ReplayAnswer } from "@/lib/offline-replay";
import { reachOf, type ServerReach } from "@/lib/offline-state";
import { printAgentRequestOptions, printJobRefOf } from "@/lib/print-agent-calls";
import { deliverLeasedJob, kickPrintAgent } from "@/lib/print-agent-seams";
import { markOwnSlip } from "@/lib/pulse-cadence-now";
import { reportWriteAnswer, serverReach } from "@/lib/server-reach";
import type { Order } from "@/types";

const REPLAY_LOCK = "pos-offline-replay";

// An answer without the echo came from a server that dropped the note: nothing more is sent from this page.
let blocked = false;
const blockedListeners = new Set<() => void>();
const subscribeBlocked = (listener: () => void) => {
  blockedListeners.add(listener);
  return () => void blockedListeners.delete(listener);
};

const tellBlocked = () => {
  for (const listener of [...blockedListeners]) listener();
};

/** The runner stopped for good on this page (Offline orders says why). */
export function useReplayBlocked(): boolean {
  return useSyncExternalStore(subscribeBlocked, () => blocked, () => false);
}

// What the last pulse said about offline replays, for Offline orders' line (spec §6), published by the runner.
type ReplayGate = { known: boolean; offlineReplay: boolean };
const UNKNOWN_GATE: ReplayGate = { known: false, offlineReplay: false };
let gate: ReplayGate = UNKNOWN_GATE;

export function useReplayGate(): ReplayGate {
  return useSyncExternalStore(subscribeBlocked, () => gate, () => UNKNOWN_GATE);
}

async function checkPulseReach(qc: QueryClient): Promise<ServerReach> {
  await qc.refetchQueries({ queryKey: POS_PULSE_KEYS.all }, { throwOnError: false });
  const state = qc.getQueryState(POS_PULSE_KEYS.all);
  return state !== undefined && state.errorUpdatedAt > state.dataUpdatedAt ? reachOf(state.error) : "reached";
}

/** The answer's jobs, as an online send follows them (hooks/use-host-routing.ts followPrintJob): a job made leased to
 *  this tab prints here now, a queued one wakes the agent; a job made printed (its line printed offline) does nothing. */
function followAnswer(order: Order): void {
  for (const kind of ["kot", "bill"] as const) {
    const ref = printJobRefOf(order, kind);
    if (ref === null) continue;
    if (ref.leased !== undefined) deliverLeasedJob(ref.leased);
    else if (ref.status === "queued") kickPrintAgent(ref.printerId);
    for (const job of ref.alsoLeased ?? []) deliverLeasedJob(job);
  }
}

async function withReplayLock(work: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  // Without Web Locks (an http page that is not a secure context) this page's own guard is the only one.
  if (locks === undefined) return work();
  await locks.request(REPLAY_LOCK, { ifAvailable: true }, async (lock) => {
    if (lock !== null) await work();
  });
}

export function useOfflineReplay(): void {
  const qc = useQueryClient();
  const { offline } = useServerReach();
  const { record } = useOfflineOutbox();
  // Every pulse answer is a tick, even one that changed nothing (a structurally equal answer keeps its object).
  const [tick, setTick] = useState(0);
  useEffect(
    () =>
      qc.getQueryCache().subscribe((event) => {
        if (event.type === "updated" && event.action.type === "success" && event.query.queryKey[0] === POS_PULSE_KEYS.all[0]) setTick((n) => n + 1);
      }),
    [qc],
  );
  const runningRef = useRef(false);
  const retryAfterRef = useRef(0);
  // Read from the cache at each tick (no pulse context of its own: the pulse stays one poller with its eight readers).
  const pulse = qc.getQueryData<PosPulseData>(POS_PULSE_KEYS.all);
  const offlineReplay = pulse?.offlineReplay === true;
  useEffect(() => {
    const known = pulse !== undefined;
    if (gate.known === known && gate.offlineReplay === offlineReplay) return;
    gate = { known, offlineReplay };
    tellBlocked();
  }, [pulse, offlineReplay]);
  const sendable = replaySendable(record);

  useEffect(() => {
    if (runningRef.current || !replayReady({ offline, offlineReplay, sendable, nowMs: Date.now(), retryAfter: retryAfterRef.current, blocked })) return;
    runningRef.current = true;
    const send = async (entry: OutboxEntry): Promise<ReplayAnswer> => {
      const url = entry.kind === "create" ? "/api/orders" : `/api/orders/${encodeURIComponent(entry.orderId ?? "")}/items`;
      try {
        const answer = await apiSend<ReplayAnswer>(url, "POST", offlineReplayBody(entry), printAgentRequestOptions(entry.sale));
        void reportWriteAnswer(null, serverReach, () => checkPulseReach(qc));
        return answer;
      } catch (error) {
        void reportWriteAnswer(error, serverReach, () => checkPulseReach(qc));
        throw error;
      }
    };
    void withReplayLock(async () => {
      const result = await runOfflineReplay({ update: offlineOutbox.update, printing: (key) => offlinePrinting.has(key), send, follow: followAnswer });
      if (result.sent > 0) {
        markOwnSlip(); // spec 5.11: a replay is a slip-making write: the pulse stays lively 2 minutes
        toast.success(replaySentMessage(result.sent));
        for (const queryKey of [ORDER_KEYS.all, TABLE_KEYS.all, CUSTOMER_KEYS.all]) void qc.invalidateQueries({ queryKey });
      }
      // A miss (or a sign-in to check) waits a pulse tick before anything more goes (never a tight loop).
      if (result.stop === "miss" || result.stop === "signed-out" || result.stop === "storage") retryAfterRef.current = Date.now() + REFETCH_INTERVALS.POS_PULSE;
      if (result.stop === "no-echo" && !blocked) {
        blocked = true;
        tellBlocked();
        toast.error(REPLAY_NO_ECHO_MESSAGE);
      }
    }).finally(() => {
      runningRef.current = false;
    });
  }, [qc, offline, offlineReplay, sendable, tick]);
}
