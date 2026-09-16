"use client";

import { useEffect, useState } from "react";

import { PRINT_HOST_DRAIN_LOCK_NAME } from "@/lib/print-host-slips";

// Print-host plan §B5 (PH-5, design review MERGED-23) — exactly one DRAIN per
// host PC. Web Locks are scoped to the ORIGIN and shared by every window/tab
// of one browser profile (w3c.github.io/web-locks): the first window to ask
// holds "pos.print-host.drain" for its lifetime (the callback's promise never
// settles until teardown — the documented infinite-hold pattern), later
// windows queue behind it and are granted the moment the holder closes or
// crashes (the agent's termination releases its locks; mere occlusion does
// not). A non-holder drains nothing and beats nothing that needs the lock.
//
// No `navigator.locks` (an insecure LAN http origin, an old engine) ⇒ HELD:
// the per-job claim CAS stays the duplicate fence, exactly as §B7 lists.

export function usePrintHostDrainLock(enabled: boolean): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("locks" in navigator) || !navigator.locks) {
      setHeld(true);
      return () => setHeld(false);
    }

    // `release` resolves the hold promise, which is the ONLY way a granted lock
    // is given back; the AbortController only cancels a still-PENDING request.
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();

    navigator.locks
      .request(PRINT_HOST_DRAIN_LOCK_NAME, { signal: controller.signal }, () => {
        setHeld(true);
        return hold;
      })
      .catch(() => {
        // An aborted pending request (this window stopped being the host
        // before its turn came) — nothing was ever held.
      });

    return () => {
      controller.abort();
      release();
      setHeld(false);
    };
  }, [enabled]);

  return held;
}
