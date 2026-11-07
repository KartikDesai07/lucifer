import { useSyncExternalStore } from "react";
import { navProgress, type NavProgress } from "@/lib/nav-progress";

/** The navigation in progress, or null. The server renders "nothing opening". */
export function useNavProgress(): NavProgress {
  return useSyncExternalStore(navProgress.subscribe, navProgress.get, () => null);
}
