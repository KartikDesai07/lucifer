// Keeping the sidebar's busiest screens ready to open with NO network wait.
// Pure (no React, no router): the scheduling rule lives here so it is unit-
// tested (lib/warm-routes.test.ts); hooks/use-warm-routes.ts wires it to the
// App Router, the page's timers and the page's own query answers.
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
//
// Why only on a working line: in the same Next 15.5 cache a prefetch that
// FAILS is poison. A transport error, a non-OK answer or a non-RSC answer all
// resolve to a plain string (fetch-server-response.js), the entry is kept and
// stays reusable for the whole static window, pruning drops only expired
// entries, and re-prefetching returns the same entry — so the beat can never
// repair it. A click on that entry turns into a full page load
// (navigate-reducer.js handleExternalUrl), and router.refresh would do the
// same to the CURRENT screen. So a prefetch is offered only while one of the
// page's own queries has answered recently, and the offers are spaced out so
// a reconnect does not fire every route into a line that is still waking up.
// These vendor facts are pinned in lib/warm-routes.test.ts; the pin fails on
// purpose on any Next upgrade beyond 15.5.x.

import { ApiError } from "@pos/shared/api-client";
import { REFETCH_INTERVALS } from "@/lib/query";

/** How often the busiest routes are re-offered to the router. Short against
 *  the reuse window (next.config.ts PREFETCH_REUSE_SECONDS) so an expired
 *  entry is refilled within this long, not left to a click. */
export const WARM_ROUTES_INTERVAL_MS = 45 * 1000;

/** The gap between two offers in one pass, so a reconnect sends one route at
 *  a time and each offer re-checks the line before it goes. */
export const WARM_ROUTES_STAGGER_MS = 1500;

/** How recent a query answer must be to count as a working line. Two pulse
 *  beats: on a healthy page the pulse alone keeps the line proven. */
export const WARM_LINE_PROOF_MS = 2 * REFETCH_INTERVALS.POS_PULSE;

/** From here up, an HTTP status is the server or platform failing, not our
 *  own server answering about that one request. */
const HTTP_SERVER_ERROR_MIN = 500;

export interface WarmEnvironment {
  /** document.visibilityState === "visible" — a hidden tab never spends
   *  requests on screens nobody is looking at. */
  visible: boolean;
  /** navigator.onLine — no point queueing prefetches the network will fail. */
  online: boolean;
  /** lineProven(...) — one of the page's own requests answered recently, so
   *  a prefetch is unlikely to fail and poison its cache entry. */
  lineProven: boolean;
}

/** One offer in a staggered pass: `href` goes to the router `delayMs` after
 *  the pass starts. */
export interface StaggeredOffer {
  href: string;
  delayMs: number;
}

/** Offer each route to the router once, when the page can use it. Returns
 *  the routes offered, so the rule is observable in tests. */
export function warmRoutes(
  hrefs: readonly string[],
  prefetch: (href: string) => void,
  env: WarmEnvironment,
): string[] {
  if (!env.visible || !env.online || !env.lineProven) return [];
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

/** Whether the line counts as working at `now`, given when a query last got
 *  an answer (null = none yet, or the line has failed since). */
export function lineProven(answeredAt: number | null, now: number): boolean {
  return answeredAt !== null && now - answeredAt <= WARM_LINE_PROOF_MS;
}

/** Each href once, in order, `gapMs` apart (the first at once). */
export function staggerPlan(hrefs: readonly string[], gapMs: number): StaggeredOffer[] {
  return [...new Set(hrefs)].map((href, i) => ({ href, delayMs: i * gapMs }));
}

/** Whether a query failure says the line is down. Only our own server
 *  answering with a 4xx about that one request leaves the line proven. */
export function isLineFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.kind !== "http" || error.status === null) return true;
  return error.status >= HTTP_SERVER_ERROR_MIN;
}
