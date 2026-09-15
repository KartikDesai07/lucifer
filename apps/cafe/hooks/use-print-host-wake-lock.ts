"use client";

import { useEffect } from "react";

// Print-host plan §B7 (PH-5, design review MERGED-15) — keep the host PC's
// display awake while it is the host. Screen Wake Lock is released by the
// browser whenever the page is hidden (it prevents DISPLAY sleep only), so it
// is re-requested on every return to visible; a denial (low battery, an engine
// without the API) degrades silently — the runbook's "keep the window visible"
// caveat covers the rest. Requesting while hidden rejects, so visibility is
// checked first. Never on a non-host device: the pref alone arms it.

const WAKE_LOCK_TYPE = "screen";

export function usePrintHostWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request(WAKE_LOCK_TYPE);
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
      } catch {
        // Denied or unsupported — beats and prints still run, only display
        // sleep is no longer held off.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release();
      sentinel = null;
    };
  }, [enabled]);
}
