import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { navProgress, navTargetPath, type createNavProgress } from "@/lib/nav-progress";
import { pageTitleFor } from "@/lib/page-titles";

// The one place a staff navigation is decided, so a tap on a link (AppLink) and a navigation from code
// (navigateTo) behave the same: the "page is opening" progress starts, and a tap on the page that is
// already opening does nothing. Later decisions (full load, refuse offline) are added HERE, not at call sites.

export type NavStart = { go: boolean };

/** Decide a navigation to `href` made from `fromPath`. `go: false` = do not navigate (that exact href is already
 *  opening). A same-path tap cancels any opening and starts none (nothing to wait for; a query change renders in place). */
export function beginNavigation(
  href: string,
  label: string | undefined,
  fromPath: string,
  now: number,
  progress: Pick<ReturnType<typeof createNavProgress>, "start" | "cancel"> = navProgress,
): NavStart {
  const path = navTargetPath(href);
  // Next throws away a pending navigation when a new one is dispatched, so the old target never lands and nothing
  // would settle it: a tap on the page already showing ends the wait, then navigates as today (R30).
  if (path === fromPath) {
    progress.cancel();
    return { go: true };
  }
  const words = label ?? (pageTitleFor(path) || path);
  return { go: progress.start(href, words, now, fromPath) };
}

/** Navigate from code (never `router.push` / `router.replace` directly: the pin in lib/app-link-paths.test.ts).
 *  `href` may be rooted or an absolute same-origin URL. */
export function navigateTo(
  router: AppRouterInstance,
  href: string,
  opts?: { replace?: boolean; label?: string },
): void {
  if (!beginNavigation(href, opts?.label, window.location.pathname, Date.now()).go) return;
  if (opts?.replace) router.replace(href);
  else router.push(href);
}
