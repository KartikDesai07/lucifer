// Menu B2 — when may New Order re-read the menu on its own? PURE and
// DOM-free: hooks/use-menu-freshness.ts feeds it the facts, and the rule is
// unit-tested here (lib/menu-freshness.test.ts).
//
// The rule protects the owner's "one master call per page load" promise while
// still catching a menu that moved on another device:
//   - never while the bootstrap, the products or the categories are already
//     being fetched (a mount refresh would double the page-load call);
//   - never within MENU_REFRESH_MIN_GAP_MS of the last refresh OR of the last
//     real bootstrap fetch — both measured on THIS device's clock;
//   - a stamp from the future (the clock moved backwards) counts as due,
//     never as "recent";
//   - never while the device is offline (a paused fetch would just hang) —
//     except when the cashier taps Try again.
// The gap is never measured from a query's dataUpdatedAt: the stored-copy seed
// stamps that with the SERVER's `at` (lib/masters-seed.ts), which is a
// different clock and hours old.

/** Least time between two automatic menu refreshes. */
export const MENU_REFRESH_MIN_GAP_MS = 30_000;

// Module-level on purpose: it must survive the New Order page unmounting, so a
// client-side round trip through another screen cannot re-arm a refresh.
let lastMenuRefreshAt: number | null = null;

/** Client-clock time the last refresh started (null = none this page load). */
export function getLastMenuRefreshAt(): number | null {
  return lastMenuRefreshAt;
}

export function setLastMenuRefreshAt(at: number | null): void {
  lastMenuRefreshAt = at;
}

export interface MenuFreshnessFacts {
  now: number;
  /** Client-clock start of the last refreshMenuNow, or null. */
  lastRefreshAt: number | null;
  bootstrapFetching: boolean;
  /** Client-clock success time of the bootstrap query's last real fetch, or null. */
  bootstrapFetchedAt: number | null;
  /** A products or categories fetch is running now. */
  menuFetching: boolean;
  online: boolean;
}

// Recent = 0 <= age < gap. A negative age is NOT recent (see the header).
function isRecent(stamp: number | null, now: number): boolean {
  if (stamp === null) return false;
  const age = now - stamp;
  return age >= 0 && age < MENU_REFRESH_MIN_GAP_MS;
}

/**
 * `manual` = the cashier tapped Try again: always due. refreshMenuNow cancels
 * a products/categories read already running before it re-reads, so the tap
 * REPLACES that read — the browser smoke (s59) caught a tap swallowed while
 * TanStack's own focus refetch was in flight. Automatic triggers never start
 * a read on top of a running one.
 */
export function menuRefreshDue(facts: MenuFreshnessFacts, manual = false): boolean {
  if (manual) return true;
  if (facts.bootstrapFetching || facts.menuFetching) return false;
  if (!facts.online) return false;
  if (isRecent(facts.lastRefreshAt, facts.now)) return false;
  if (isRecent(facts.bootstrapFetchedAt, facts.now)) return false;
  return true;
}
