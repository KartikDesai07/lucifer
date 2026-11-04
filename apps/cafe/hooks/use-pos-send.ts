"use client";

// Why a new file: nothing existing holds a send attempt (its key, its lock,
// its "Couldn't confirm"), and the POS's two creating writes — Send to Kitchen
// and Pay Now — must share one. The rules live in the pure controller
// lib/pos-send.ts (runtime-tested in lib/pos-send.test.ts); this hook only
// gives it the key minter and subscribes the POS to it.
//
// useSyncExternalStore, not a mirrored useState: the controller owns the state
// outside React, and this is React's tear-free contract for such a store. No
// timers — the controller is created once per mounted POS, and its one effect
// marks it mounted, so an answer after the operator left is toasted (K2).
//
// Printing Phase 5 (spec 5.1, 5.5): the controller also reads the page's offline state, keeps a send on the device
// through `keepOffline` (hooks/use-offline-send.ts, read at call time: it changes with the menu and the printers), and
// reports each online answer (one with no answer is checked once by a pulse refetch).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { reachOf, type ServerReach } from "@/lib/offline-state";
import { mintAttemptId } from "@/lib/pos-device-id";
import { createPosSend, SEND_OFFLINE_NOT_KEPT, type PosSendPorts, type UnmountedToast } from "@/lib/pos-send";
import { reportWriteAnswer, serverReach } from "@/lib/server-reach";

const toastUnmounted = (t: UnmountedToast) => (t.tone === "success" ? toast.success(t.message) : toast.warning(t.message));

/** The one check after an unanswered write: a pulse refetch (no new endpoint), read back from the query's own state. */
async function checkPulseReach(qc: QueryClient): Promise<ServerReach> {
  await qc.refetchQueries({ queryKey: POS_PULSE_KEYS.all }, { throwOnError: false });
  const state = qc.getQueryState(POS_PULSE_KEYS.all);
  return state !== undefined && state.errorUpdatedAt > state.dataUpdatedAt ? reachOf(state.error) : "reached";
}

export function usePosSend(keepOffline?: PosSendPorts["keepOffline"]) {
  const qc = useQueryClient();
  const keepRef = useRef(keepOffline);
  useEffect(() => {
    keepRef.current = keepOffline;
  }, [keepOffline]);
  const [send] = useState(() =>
    createPosSend({
      mintKey: mintAttemptId,
      toastUnmounted,
      offline: serverReach.isOffline,
      keepOffline: (job, key) => keepRef.current?.(job, key) ?? Promise.resolve({ kept: false, message: SEND_OFFLINE_NOT_KEPT }),
      onAnswer: (error) => void reportWriteAnswer(error, serverReach, () => checkPulseReach(qc)),
    }),
  );
  useEffect(() => send.mount(), [send]);
  const state = useSyncExternalStore(send.subscribe, send.getState, send.getState);

  return {
    sending: state.sending,
    frozen: state.frozen,
    kitchenNotice: state.notice?.job === "kitchen" ? state.notice.notice : null,
    payNotice: state.notice?.job === "pay" ? state.notice.notice : null,
    run: send.run,
    isLocked: send.isLocked,
    reset: send.reset,
    holds: send.holds,
  };
}
