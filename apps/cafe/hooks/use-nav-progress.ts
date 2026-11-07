import { useSyncExternalStore } from "react";
import { navProgress, type NavProgress } from "@/lib/nav-progress";
import { coverOf } from "@/lib/nav-skeleton";

/** The navigation in progress, or null. The server renders "nothing opening". */
export function useNavProgress(): NavProgress {
  return useSyncExternalStore(navProgress.subscribe, navProgress.get, () => null);
}

/** Whether this link's href is the one opening now. A boolean per link, so a tap re-renders only the row it lit
 *  (and the one it unlit), never every link on the screen. */
export function useNavOpening(href: string): boolean {
  return useSyncExternalStore(navProgress.subscribe, () => navProgress.get()?.href === href, () => false);
}

/** Whether a tap's opening screen covers the page at `pathname` now (the view's and the line's rule, lib/nav-skeleton.ts
 *  coverOf). A boolean, so a component that only needs to know re-renders when it flips, not on every store change. */
export function useNavCovered(pathname: string): boolean {
  return useSyncExternalStore(navProgress.subscribe, () => coverOf(navProgress.get(), pathname) !== null, () => false);
}
