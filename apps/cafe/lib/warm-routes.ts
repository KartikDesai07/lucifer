// Keeping the sidebar's busiest screens ready to open with NO network wait.
// Pure (no React, no router): the scheduling rule lives here so it is unit-
// tested (lib/warm-routes.test.ts); hooks/use-warm-routes.ts wires it to the
// App Router and the page's timers.
//
// Why: every staff page is a client component under a dynamic layout, so a
// sidebar click normally waits for one server round trip (the route's RSC
// payload) before the screen can change — on a slow or lossy counter network
// that single trip is the whole 3–5s the staff feel. `router.prefetch(href)`
// in Next 15.5 (old router cache) fetches the FULL route and is a no-op while
// that entry is still fresh (next/dist/client/components/router-reducer/
// prefetch-cache-utils.js getPrefetchEntryCacheStatus), so re-asking on a
// short beat costs a request only when an entry has actually expired, and a
// click inside the reuse window renders from memory.

/** How often the busiest routes are re-offered to the router. Short against
 *  the reuse window (next.config.ts PREFETCH_REUSE_SECONDS) so an expired
 *  entry is refilled within this long, not left to a click. */
export const WARM_ROUTES_INTERVAL_MS = 45 * 1000;

export interface WarmEnvironment {
  /** document.visibilityState === "visible" — a hidden tab never spends
   *  requests on screens nobody is looking at. */
  visible: boolean;
  /** navigator.onLine — no point queueing prefetches the network will fail. */
  online: boolean;
}

/** Offer each route to the router once, when the page can use it. Returns
 *  the routes offered, so the rule is observable in tests. */
export function warmRoutes(
  hrefs: readonly string[],
  prefetch: (href: string) => void,
  env: WarmEnvironment,
): string[] {
  if (!env.visible || !env.online) return [];
  const offered: string[] = [];
  for (const href of new Set(hrefs)) {
    // A prefetch is an optimisation only: one that throws (a malformed href,
    // a router mid-teardown) must never stop the rest or break the page.
    try {
      prefetch(href);
      offered.push(href);
    } catch {
      /* skipped — the click still works, it just waits for the network */
    }
  }
  return offered;
}
