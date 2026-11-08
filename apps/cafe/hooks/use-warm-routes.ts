"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { heldRoutes } from "@/lib/held-routes";
import {
  WARM_ROUTES_INTERVAL_MS,
  WARM_ROUTES_STAGGER_MS,
  answeredAtFromCache,
  isLineFailure,
  lineProven,
  staggerPlan,
  warmRoutes,
} from "@/lib/warm-routes";
import { updatePending } from "@/lib/update-pending";

// Keeps `hrefs` fully prefetched while this component is mounted, so a click
// on one of them renders from the router cache instead of waiting for the
// network (the rule and its reasons: lib/warm-routes.ts). A prefetch that
// fails poisons its entry for the whole reuse window, so nothing is offered
// until the line has proven itself: the proof is a real answer to one of the
// page's own queries (a fetch success in the QueryCache, never a
// setQueryData write). The first answer after none — the first load, or the
// refetch TanStack runs on reconnect — starts a pass; the beat and the tab
// coming back into view start one only while the proof is recent. A line
// failure (offline, timeout, 5xx, a paused fetch) drops the proof and cancels
// any offers still waiting. A pass offers the routes one at a time, and each
// offer re-checks the line as it fires. A hidden or offline tab, or one a
// newer build waits for (post-verifier V1), sends nothing. Prefetching is a
// no-op in `next dev` (Next skips it there), so
// this only has an effect in a production build.
export function useWarmRoutes(hrefs: readonly string[]): void {
  const router = useRouter();
  const qc = useQueryClient();
  // A stable string key: the caller may rebuild the array every render.
  const key = hrefs.join("\n");

  useEffect(() => {
    const list = key ? key.split("\n") : [];
    if (list.length === 0) return;
    let answeredAt: number | null = null;
    let offers: number[] = [];
    const prefetch = (href: string) => {
      router.prefetch(href);
      // Offered = held for the router-cache window (lib/held-routes.ts).
      heldRoutes.mark(href, Date.now());
    };
    const env = () => ({
      visible: document.visibilityState === "visible",
      online: navigator.onLine !== false,
      lineProven: lineProven(answeredAt, Date.now()),
      updatePending: updatePending.isPending(),
    });
    const cancelPass = () => {
      for (const offer of offers) window.clearTimeout(offer);
      offers = [];
    };
    const pass = () => {
      cancelPass();
      offers = staggerPlan(list, WARM_ROUTES_STAGGER_MS).map(({ href, delayMs }) =>
        window.setTimeout(() => warmRoutes([href], prefetch, env()), delayMs),
      );
    };
    const lineDown = () => {
      answeredAt = null;
      cancelPass();
    };

    // This hook mounts after the pulse's first answer (behind the master-data
    // hold and the session gate), so waiting for a pulse SUCCESS event would
    // leave the first pass to the second pulse. A recent success already in
    // the cache is the same proof: start from it and offer at once.
    const cached = answeredAtFromCache(qc.getQueryState(POS_PULSE_KEYS.all), Date.now());
    if (cached !== null) {
      answeredAt = cached;
      pass();
    }

    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const { action } = event;
      if (action.type === "success") {
        // Only the POS pulse proves the line: every dashboard screen polls it
        // over the network, and WARM_LINE_PROOF_MS is sized from its interval.
        // Other queries can answer locally (the print host's wake query does
        // once its daily budget is spent), which proves nothing.
        if (action.manual === true || event.query.queryKey[0] !== POS_PULSE_KEYS.all[0]) return;
        const now = Date.now();
        const wasProven = lineProven(answeredAt, now);
        answeredAt = now;
        if (!wasProven) pass();
        return;
      }
      if (
        action.type === "pause" ||
        ((action.type === "failed" || action.type === "error") && isLineFailure(action.error))
      ) {
        lineDown();
      }
    });
    const beat = window.setInterval(() => {
      if (lineProven(answeredAt, Date.now())) pass();
    }, WARM_ROUTES_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && lineProven(answeredAt, Date.now())) pass();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("offline", lineDown);
    return () => {
      unsubscribe();
      cancelPass();
      window.clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("offline", lineDown);
    };
  }, [router, qc, key]);
}
