"use client";

import { useEffect, useRef, useState } from "react";

import { shouldRequestWakeLock } from "@/lib/pos-install";

// PH-5 contract: hooks/use-print-host-beat.ts will call useWakeLock(isHost) —
// the `enabled` param exists solely for that, PH-5 adds no wake-lock code of
// its own (print-host-plan.md MERGED-15). Mounted at the PAGE level (never the
// dashboard layout, so Reports/Settings never hold the lock). Honest limit:
// the lock only prevents display sleep, and the platform releases it whenever
// the document is hidden — identical behaviour in a tab and an installed
// window; there is no way to "keep the screen on while backgrounded".
export function useWakeLock(enabled: boolean): { supported: boolean; active: boolean } {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  // SSR/hydration safety: `navigator` is read only after mount, never during render.
  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && "wakeLock" in navigator);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // One request in flight at a time, and never a second sentinel while one
    // is still held: a visibilitychange racing the initial request would
    // otherwise orphan a lock this cleanup can never release.
    let pending = false;

    const request = async () => {
      if (pending || sentinelRef.current !== null) return;
      if (!shouldRequestWakeLock({ enabled, supported, visibility: document.visibilityState })) {
        return;
      }
      pending = true;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          // Only the CURRENT sentinel's release means "no longer active" — a
          // stale sentinel's late release event (its cleanup already ran and a
          // newer lock is held) must not clobber the newer lock's state.
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
            setActive(false);
          }
        });
        // The platform may already have released it in the gap before the
        // listener was attached (document hidden mid-request) — never report
        // a dead lock as active.
        if (sentinel.released) {
          sentinelRef.current = null;
          setActive(false);
        } else {
          setActive(true);
        }
      } catch {
        // Fail-soft: NotAllowedError (hidden tab / battery saver) or an
        // unsupported browser — the next visibilitychange is the only retry.
      } finally {
        pending = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void request();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    void request();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const sentinel = sentinelRef.current;
      if (sentinel) {
        void sentinel.release().catch(() => undefined);
      }
      sentinelRef.current = null;
      setActive(false);
    };
  }, [enabled, supported]);

  return { supported, active };
}
