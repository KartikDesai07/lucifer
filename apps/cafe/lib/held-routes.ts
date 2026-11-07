// A page-wide record of which routes this page has offered to the router for
// prefetch (the warm pass, or a touch on a nav row). Next's router cache keeps
// a prefetched screen for next.config.ts PREFETCH_REUSE_SECONDS, so "offered
// within that window" is the page's best knowledge that a tap on the route
// renders from memory. Pure and tiny: the same record answers "did we already
// offer this row?" (lib/intent-prefetch.ts) and, later, "may an offline tap on
// this row still open?".

import { navTargetPath } from "@/lib/nav-progress";

/** The router-cache reuse window, in ms. It must equal next.config.ts
 *  PREFETCH_REUSE_SECONDS * 1000 (client code cannot import that file;
 *  lib/held-routes.test.ts reads it and fails if the two drift apart). */
export const HELD_ROUTES_WINDOW_MS = 30 * 60 * 1000;

export interface HeldRoutes {
  mark(href: string, now: number): void;
  /** Marked and still inside the window (at the boundary: no longer held). */
  holds(href: string, now: number): boolean;
  /** When the route was last marked, if ever. */
  offeredAt(href: string): number | undefined;
}

export function createHeldRoutes(windowMs: number): HeldRoutes {
  const marked = new Map<string, number>();
  return {
    mark: (href, now) => {
      marked.set(href, now);
    },
    holds: (href, now) => {
      const at = marked.get(href);
      return at !== undefined && now - at < windowMs;
    },
    offeredAt: (href) => marked.get(href),
  };
}

/** This page's record (one per tab; a reload starts empty, like the router cache). */
export const heldRoutes = createHeldRoutes(HELD_ROUTES_WINDOW_MS);

/** The key a tap's held check asks about: the path alone, or the path + query when the href has one (the hash never
 *  counts). Next's router cache keeps a screen per URL, so /orders held says nothing about /orders?date=…: offline, a
 *  query link opens only when that exact URL was visited or offered (ruling R36), else the toast, never the network. */
export function heldKeyOf(href: string): string {
  const beforeHash = href.split("#")[0];
  const at = beforeHash.indexOf("?");
  const query = at === -1 ? "" : beforeHash.slice(at);
  return query.length > 1 ? navTargetPath(href) + query : navTargetPath(href);
}

/** A screen now showing counts as held by its path and, when it shows a query (`search` is window.location.search),
 *  by its whole URL too: the two keys heldKeyOf gives a tap. */
export function markVisit(held: Pick<HeldRoutes, "mark">, pathname: string, search: string, now: number): void {
  held.mark(pathname, now);
  if (search.length > 1) held.mark(pathname + search, now);
}
