// What a tap shows while the next screen opens (P2 N1). Pure, so node:test covers the whole rule: which skeleton
// the target screen gets, whether the page is covered right now, and how long until "Still opening…" shows.

import { NAV_STILL_OPENING_MS, navTargetPath, type NavProgress } from "@/lib/nav-progress";

/** The three quiet shapes a screen can open on: a list of rows, a board of tiles, or a form of cards. */
export type SkeletonKind = "list" | "board" | "form";

/** The screens drawn as boards (exact paths: /tables/setup is a list of rows like the rest). */
const BOARD_PATHS: readonly string[] = ["/", "/tables", "/kitchen", "/pos", "/now-serving"];

/** The skeleton a screen opens on. Every screen that is not a board or a form is a list, the old route skeleton. */
export function skeletonKindOf(pathname: string): SkeletonKind {
  const path = navTargetPath(pathname);
  if (BOARD_PATHS.includes(path)) return "board";
  if (path === "/settings" || path.startsWith("/settings/") || path === "/printers") return "form";
  return "list";
}

/** The navigation that covers the page now, or null. Only while the path is still the one the tap came from (the
 *  spec's "the path has not changed"): the target landing, or a redirect landing anywhere else, shows the page at
 *  once. The view and the line under the header both read this, so they can never disagree. */
export function coverOf(progress: NavProgress, pathname: string): NavProgress {
  return progress !== null && pathname === progress.fromPath ? progress : null;
}

/** How long until the opening screen says it is taking longer than usual: 8 s after the tap, never negative. */
export function stillOpeningIn(progress: NonNullable<NavProgress>, now: number): number {
  return Math.max(0, progress.startedAt + NAV_STILL_OPENING_MS - now);
}
