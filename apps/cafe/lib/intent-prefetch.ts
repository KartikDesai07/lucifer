// When a touch on a nav row may prefetch its route. Pure: the hook
// (hooks/use-intent-prefetch.ts) gathers the facts at the moment of the event.
//
// Why the same gates as the warm pass: a prefetch that fails poisons its entry
// in the router cache for the whole reuse window (see lib/warm-routes.ts), so
// a touch only prefetches on a line one of the page's own queries has just
// proven. And a row already offered inside the window is left alone: asking
// again is a no-op in Next at best and a wasted request at worst.

import { HELD_ROUTES_WINDOW_MS } from "@/lib/held-routes";

/** How long the mouse must rest on a row before it counts as intent. */
export const INTENT_HOVER_MS = 120;

export interface IntentPrefetchInput {
  href: string;
  online: boolean;
  offline: boolean;
  lineProven: boolean;
  offeredAt: number | undefined;
  now: number;
}

export function shouldIntentPrefetch(input: IntentPrefetchInput): boolean {
  if (!input.online || input.offline || !input.lineProven) return false;
  const { offeredAt, now } = input;
  // Strict, like HeldRoutes.holds: at exactly the window the entry is gone.
  return !(offeredAt !== undefined && now - offeredAt < HELD_ROUTES_WINDOW_MS);
}
