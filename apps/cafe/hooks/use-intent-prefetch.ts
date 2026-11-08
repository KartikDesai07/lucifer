"use client";

import { useCallback, useContext, useEffect, useRef } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { QueryClientContext } from "@tanstack/react-query";

import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { heldRoutes } from "@/lib/held-routes";
import { INTENT_HOVER_MS, shouldIntentPrefetch } from "@/lib/intent-prefetch";
import { serverReach } from "@/lib/server-reach";
import { updatePending } from "@/lib/update-pending";
import { answeredAtFromCache, lineProven } from "@/lib/warm-routes";

// A nav row prefetches its route when the user shows intent: a press, or a
// mouse resting on it for INTENT_HOVER_MS. Everything is decided at the moment
// of the event (no timer, poll or subscription of its own beyond the one hover
// timeout), so a row on a dead line does nothing and the click still works.
export function useIntentPrefetch(href: string): {
  onPointerDown(): void;
  onMouseEnter(): void;
  onMouseLeave(): void;
} {
  // The contexts are read directly (what useRouter / useQueryClient do, minus the throw when nothing is mounted):
  // a link rendered without them, as a source-render test does, simply never prefetches.
  const router = useContext(AppRouterContext);
  const qc = useContext(QueryClientContext);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const offer = useCallback(() => {
    if (!router || !qc) return;
    const now = Date.now();
    const answeredAt = answeredAtFromCache(qc.getQueryState(POS_PULSE_KEYS.all), now);
    const go = shouldIntentPrefetch({
      href,
      online: navigator.onLine !== false,
      offline: serverReach.isOffline(),
      lineProven: lineProven(answeredAt, now),
      updatePending: updatePending.isPending(),
      offeredAt: heldRoutes.offeredAt(href),
      now,
    });
    if (!go) return;
    // An optimisation only: a throwing router must never break the tap.
    try {
      router.prefetch(href);
      heldRoutes.mark(href, now);
    } catch {
      /* the click still works, it just waits for the network */
    }
  }, [href, qc, router]);

  useEffect(() => clear, [clear]);

  return {
    onPointerDown: () => {
      clear();
      offer();
    },
    onMouseEnter: () => {
      clear();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        offer();
      }, INTENT_HOVER_MS);
    },
    onMouseLeave: clear,
  };
}
