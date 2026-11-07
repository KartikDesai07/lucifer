import { useSyncExternalStore } from "react";
import { navProgress, type NavProgress } from "@/lib/nav-progress";

/** The navigation in progress, or null. The server renders "nothing opening". */
export function useNavProgress(): NavProgress {
  return useSyncExternalStore(navProgress.subscribe, navProgress.get, () => null);
}

/** Whether this link's href is the one opening now. A boolean per link, so a tap re-renders only the row it lit
 *  (and the one it unlit), never every link on the screen. */
export function useNavOpening(href: string): boolean {
  return useSyncExternalStore(navProgress.subscribe, () => navProgress.get()?.href === href, () => false);
}
