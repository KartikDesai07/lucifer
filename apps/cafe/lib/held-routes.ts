// A page-wide record of which routes the router cache probably holds: the page's
// best knowledge of Next's router cache, never more generous than it. A screen
// offered for prefetch (the warm pass, or a touch on a nav row) or visited is kept
// by Next for next.config.ts PREFETCH_REUSE_SECONDS from its first use, and that
// window is not extended by later use, so an entry's window here starts at its
// first mark and a later mark inside it changes nothing. A visit with a query is
// never held (Next stores no entry for it). Wrongly saying "not held" only shows
// the offline toast; wrongly saying "held" would send an offline tap to the
// network and swap the POS for the browser's error page. Pure and tiny: the same
// record answers "did we already offer this row?" (lib/intent-prefetch.ts) and
// "may an offline tap on this row still open?" (lib/navigate.ts).

import { navTargetPath } from "@/lib/nav-progress";

/** The router-cache reuse window, in ms. It must equal next.config.ts
 *  PREFETCH_REUSE_SECONDS * 1000 (client code cannot import that file;
 *  lib/held-routes.test.ts reads it and fails if the two drift apart). */
export const HELD_ROUTES_WINDOW_MS = 30 * 60 * 1000;

export interface HeldRoutes {
  mark(href: string, now: number): void;
  /** Marked and still inside the window (at the boundary: no longer held). */
  holds(href: string, now: number): boolean;
  /** When the route's current window started (its first mark since it last expired), if ever. */
  offeredAt(href: string): number | undefined;
}

export function createHeldRoutes(windowMs: number): HeldRoutes {
  const marked = new Map<string, number>();
  return {
    mark: (href, now) => {
      // A live entry keeps its first time: Next does not extend an entry on reuse, so a restart here would claim more than it holds.
      const at = marked.get(href);
      if (at === undefined || now - at >= windowMs) marked.set(href, now);
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

/** A screen now showing counts as held by its path, unless it shows a query (`search` is window.location.search): Next
 *  stores no entry for a query visit and serves it from a bare-path entry as a copy, so neither the query URL nor the
 *  path is reusable because of it (rulings R40, R41). */
export function markVisit(held: Pick<HeldRoutes, "mark">, pathname: string, search: string, now: number): void {
  if (search.length > 1) return;
  held.mark(pathname, now);
}
