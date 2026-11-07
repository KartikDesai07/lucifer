import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { toast } from "sonner";

import { heldKeyOf, heldRoutes } from "@/lib/held-routes";
import { navDecision, offlineNavMessage } from "@/lib/nav-decision";
import { navProgress, navTargetPath, type createNavProgress } from "@/lib/nav-progress";
import { pageTitleFor } from "@/lib/page-titles";
import { serverReach } from "@/lib/server-reach";

// The one place a staff navigation is decided, so a tap on a link (AppLink) and a navigation from code
// (navigateTo) behave the same: the "page is opening" progress starts, and a tap on the page that is
// already opening does nothing. The offline and full-load decisions are made HERE (lib/nav-decision.ts holds the table), not at call sites.

export type NavAction = "navigate" | "full-load" | "refuse" | "stay";
export type NavStart = { action: NavAction; label: string };
type ProgressStore = Pick<ReturnType<typeof createNavProgress>, "start" | "cancel">;

/** The facts a decision reads, and the two side effects; every one has a real default so callers pass nothing. */
export interface NavDeps {
  isOffline: () => boolean;
  /** `key` is heldKeyOf(href): the path, or the path + query for a query link (ruling R36). */
  holds: (key: string, now: number) => boolean;
  /** Part D's build stamp feeds this (a newer build is waiting); until then no update is ever pending. */
  updatePending: () => boolean;
  toastOffline: (message: string) => void;
  assign: (href: string) => void;
  /** A full load that takes the current history entry's place (the screen it replaces must not come back on Back). */
  replace: (href: string) => void;
}

const realDeps: NavDeps = {
  isOffline: () => serverReach.isOffline() || (typeof navigator !== "undefined" && navigator.onLine === false),
  holds: (key, now) => heldRoutes.holds(key, now),
  updatePending: () => false,
  toastOffline: (message) => void toast.error(message),
  assign: (href) => window.location.assign(href),
  replace: (href) => window.location.replace(href),
};

/** Decide a navigation to `href` made from `fromPath`. `stay` = do nothing (that exact href is already opening).
 *  A same-path tap cancels any opening and starts none (nothing to wait for; a query change renders in place), and
 *  never checks the network: the page showing is the one the page holds. */
export function beginNavigation(
  href: string,
  label: string | undefined,
  fromPath: string,
  now: number,
  progress: ProgressStore = navProgress,
  deps: Partial<NavDeps> = {},
): NavStart {
  const d = { ...realDeps, ...deps };
  const path = navTargetPath(href);
  const words = label ?? (pageTitleFor(path) || path);
  // Next throws away a pending navigation when a new one is dispatched, so the old target never lands and nothing
  // would settle it: a tap on the page already showing ends the wait, then navigates as today (R30).
  if (path === fromPath) {
    progress.cancel();
    return { action: "navigate", label: words };
  }
  const action = navDecision({ href, offline: d.isOffline(), held: d.holds(heldKeyOf(href), now), updatePending: d.updatePending() });
  // A refused tap opens nothing, so no skeleton starts.
  if (action === "refuse") return { action, label: words };
  if (!progress.start(href, words, now, fromPath)) return { action: "stay", label: words };
  return { action, label: words };
}

/** Do what a decision says besides navigating. Returns true when the caller should go on and navigate. */
export function applyNavAction(result: NavStart, href: string, deps: Partial<NavDeps> = {}, opts?: { replace?: boolean }): boolean {
  const d = { ...realDeps, ...deps };
  if (result.action === "refuse") d.toastOffline(offlineNavMessage(result.label));
  else if (result.action === "full-load") (opts?.replace ? d.replace : d.assign)(href);
  return result.action === "navigate";
}

/** Navigate from code (never `router.push` / `router.replace` directly: the pin in lib/app-link-paths.test.ts).
 *  `href` may be rooted or an absolute same-origin URL. */
export function navigateTo(
  router: AppRouterInstance,
  href: string,
  opts?: { replace?: boolean; label?: string; deps?: Partial<NavDeps>; progress?: ProgressStore },
): void {
  const result = beginNavigation(href, opts?.label, window.location.pathname, Date.now(), opts?.progress, opts?.deps);
  if (!applyNavAction(result, href, opts?.deps, { replace: opts?.replace })) return;
  if (opts?.replace) router.replace(href);
  else router.push(href);
}

/** "Back" under "Still opening…" (ruling R35): the old screen shows again AND the navigation is dropped, so a late
 *  answer can never replace the screen the person chose to stay on (a cart in progress lives in the POS page's state).
 *  Next discards a pending navigation when a new one is dispatched, and a replace to the URL already showing keeps the
 *  page's tree and state; `scroll: false` leaves the page where it was. */
export function abandonNavigation(router: AppRouterInstance, progress: Pick<ProgressStore, "cancel"> = navProgress): void {
  progress.cancel();
  router.replace(window.location.pathname + window.location.search, { scroll: false });
}

/** "Try again" under "Still opening…": a full page load of the target. Offline, a document load could only swap the
 *  POS for the browser's error page, so the refused tap's toast shows instead and the page stays as it is. */
export function retryNavigation(href: string, label: string, deps: Partial<NavDeps> = {}): void {
  const d = { ...realDeps, ...deps };
  if (d.isOffline()) d.toastOffline(offlineNavMessage(label));
  else d.assign(href);
}
