import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { toast } from "sonner";

import { heldKeyOf, heldRoutes } from "@/lib/held-routes";
import { navDecision, offlineNavMessage } from "@/lib/nav-decision";
import { navProgress, navTargetPath, type NavProgress, type createNavProgress } from "@/lib/nav-progress";
import { pageTitleFor } from "@/lib/page-titles";
import { leaveWhenPrintFree } from "@/lib/print-host-busy";
import { serverReach } from "@/lib/server-reach";
import { updatePending } from "@/lib/update-pending";

// The one place a staff navigation is decided, so a tap on a link (AppLink) and a navigation from code
// (navigateTo) behave the same: the "page is opening" progress starts, and a tap on the page that is
// already opening does nothing. The offline and full-load decisions are made HERE (lib/nav-decision.ts holds the table), not at call sites.
// A document load this page starts (a full load, "Try again") goes through the print gate (R71): it waits while a slip
// is printing here, and the waiting one is dropped the moment its opening ends (Back, a newer tap, a settle).

export type NavAction = "navigate" | "full-load" | "refuse" | "stay";
export type NavStart = { action: NavAction; label: string };
type ProgressStore = Pick<ReturnType<typeof createNavProgress>, "start" | "cancel" | "get" | "subscribe">;

/** The facts a decision reads, and the two side effects; every one has a real default so callers pass nothing. */
export interface NavDeps {
  isOffline: () => boolean;
  /** `key` is heldKeyOf(href): the path, or the path + query for a query link (ruling R36). */
  holds: (key: string, now: number) => boolean;
  /** Same key: Next may keep a hard-load marker for it (lib/held-routes.ts distrustSince, post-verifier V1, V2). */
  suspect: (key: string, now: number) => boolean;
  /** A newer build is waiting for this page (the pulse reported it, lib/update-pending.ts). */
  updatePending: () => boolean;
  toastOffline: (message: string) => void;
  assign: (href: string) => void;
  /** A full load that takes the current history entry's place (the screen it replaces must not come back on Back). */
  replace: (href: string) => void;
  /** The print gate every document load goes through (lib/print-host-busy.ts); tests pass a fake. */
  leave: typeof leaveWhenPrintFree;
}

const realDeps: NavDeps = {
  isOffline: () => serverReach.isOffline() || (typeof navigator !== "undefined" && navigator.onLine === false),
  holds: (key, now) => heldRoutes.holds(key, now),
  suspect: (key, now) => heldRoutes.suspect(key, now),
  updatePending: () => updatePending.isPending(),
  toastOffline: (message) => void toast.error(message),
  assign: (href) => window.location.assign(href),
  replace: (href) => window.location.replace(href),
  leave: leaveWhenPrintFree,
};

// The ONE document load that may be waiting at the gate. A newer load replaces it; the entry of the opening it started
// under ending (Back, a newer tap, a same-path tap, popstate) drops it, so a load never fires after the person left.
let pendingLoad: (() => void) | null = null;

// How each opening (a progress entry) began: "soft" = Next navigates (it fetches the screen), "load" = our own full load
// (no Next navigation ever starts). Back reads it (ruling V3, R35); "Try again" never changes it.
const startedAs = new WeakMap<NonNullable<NavProgress>, "soft" | "load">();
let documentLanded = false;

/** Does the screen now showing at `pathname` prove Next's router-cache entry for it (lib/held-routes.ts visit, V11)? The
 *  document's first screen does (Next seeds its cache with it, from this build), and so does the landing of a soft
 *  navigation to it (Next resolved it through its cache, and another build's answer or a failed fetch would have loaded
 *  the document instead). A landing with no such opening (a Back / Forward step restores from history) proves nothing.
 *  Called once per landing, before the store settles (components/layout/NavProgressView.tsx). */
export function landingProves(pathname: string, progress: Pick<ProgressStore, "get"> = navProgress): boolean {
  const first = !documentLanded;
  documentLanded = true;
  if (first) return true;
  const entry = progress.get();
  return entry !== null && navTargetPath(entry.href) === pathname && startedAs.get(entry) === "soft";
}

function loadThroughGate(go: () => void, d: NavDeps, progress: ProgressStore, ready?: () => boolean): void {
  pendingLoad?.();
  const entry = progress.get();
  let off = () => {};
  let cancelGate = () => {};
  const end = () => {
    off();
    if (pendingLoad === drop) pendingLoad = null;
  };
  const drop = () => {
    end();
    cancelGate();
  };
  pendingLoad = drop;
  off = progress.subscribe(() => {
    if (progress.get() !== entry) drop();
  });
  cancelGate = d.leave(
    () => {
      end();
      go();
    },
    { ready },
  );
}

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
  const key = heldKeyOf(href);
  const action = navDecision({ href, offline: d.isOffline(), held: d.holds(key, now), suspect: d.suspect(key, now), updatePending: d.updatePending() });
  // A refused tap opens nothing, so no skeleton starts.
  if (action === "refuse") return { action, label: words };
  if (!progress.start(href, words, now, fromPath)) return { action: "stay", label: words };
  const entry = progress.get();
  if (entry !== null) startedAs.set(entry, action === "full-load" ? "load" : "soft");
  return { action, label: words };
}

/** Do what a decision says besides navigating. Returns true when the caller should go on and navigate. */
export function applyNavAction(
  result: NavStart,
  href: string,
  deps: Partial<NavDeps> = {},
  opts?: { replace?: boolean; progress?: ProgressStore },
): boolean {
  const d = { ...realDeps, ...deps };
  if (result.action === "refuse") d.toastOffline(offlineNavMessage(result.label));
  else if (result.action === "full-load") {
    // The load waits for print AND the line: an internet drop during the wait never loads the browser's error page.
    const load = opts?.replace ? d.replace : d.assign;
    loadThroughGate(() => load(href), d, opts?.progress ?? navProgress, () => !d.isOffline());
  }
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
  if (!applyNavAction(result, href, opts?.deps, { replace: opts?.replace, progress: opts?.progress })) return;
  if (opts?.replace) router.replace(href);
  else router.push(href);
}

/** "Back" under "Still opening…" (ruling R35): the old screen shows again AND the navigation is dropped, so a late
 *  answer can never replace the screen the person chose to stay on (a cart in progress lives in the POS page's state).
 *  Next discards a pending navigation when a new one is dispatched, and a replace to the URL already showing keeps the
 *  page's tree and state; `scroll: false` leaves the page where it was. Ending the opening also drops our load waiting at
 *  the gate under it (a full load, a "Try again"). Only an opening that began as our own full load skips the replace
 *  (ruling V3): no Next navigation is in flight to drop, and a replace of a stale current screen would refetch it (with
 *  a newer build waiting, Next loads the document itself, past the gate). A soft one keeps it, Try again or not (R35). */
export function abandonNavigation(router: AppRouterInstance, progress: Pick<ProgressStore, "cancel" | "get"> = navProgress): void {
  const entry = progress.get();
  progress.cancel();
  if (entry !== null && startedAs.get(entry) === "load") return;
  router.replace(window.location.pathname + window.location.search, { scroll: false });
}

/** "Try again" under "Still opening…": a full page load of the target. Offline, a document load could only swap the
 *  POS for the browser's error page, so the refused tap's toast shows instead and the page stays as it is. */
export function retryNavigation(href: string, label: string, deps: Partial<NavDeps> = {}, progress: ProgressStore = navProgress): void {
  const d = { ...realDeps, ...deps };
  if (d.isOffline()) d.toastOffline(offlineNavMessage(label));
  else loadThroughGate(() => d.assign(href), d, progress, () => !d.isOffline());
}
