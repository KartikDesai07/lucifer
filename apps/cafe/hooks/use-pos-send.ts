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

import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { mintAttemptId } from "@/lib/pos-device-id";
import { createPosSend, type UnmountedToast } from "@/lib/pos-send";

const toastUnmounted = (t: UnmountedToast) => (t.tone === "success" ? toast.success(t.message) : toast.warning(t.message));

export function usePosSend() {
  const [send] = useState(() => createPosSend({ mintKey: mintAttemptId, toastUnmounted }));
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
