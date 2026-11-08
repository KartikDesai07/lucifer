// When held marks stop being trusted (the post-verifier's V1, V2). lib/held-routes.ts says which screens Next's router
// cache holds, so a tap on one opens from memory. But Next 15.5 keeps a prefetch whose answer came from ANOTHER build, or
// that failed, as a hard-load marker for the entry's whole life (fetch-server-response.js; lib/warm-routes.ts), and a
// tap on it makes Next load the document itself: past the print gate (lib/print-host-busy.ts), and offline into the
// browser's error page. Two moments say such markers may exist:
//   · a newer build turns pending: a mark made at or after the pulse's last report of this page's own build may have
//     been answered by the newer one (every mark, when no such report came yet);
//   · the line is found down (the page's offline state turns on): a mark made at or after the pulse's last real answer,
//     the line's last proof of reach, may have failed.
// Each makes those marks suspect: lib/navigate.ts then refuses them offline and loads them through the gate online. It
// listens to stores the page already has and sends nothing. hooks/use-pos-pulse.ts starts it, once per page.

import { heldRoutes, type HeldRoutes } from "@/lib/held-routes";
import { serverReach, type ServerReachStore } from "@/lib/server-reach";
import { updatePending, type UpdatePendingStore } from "@/lib/update-pending";

export interface SuspectWatchDeps {
  held: Pick<HeldRoutes, "distrustSince">;
  update: Pick<UpdatePendingStore, "isPending" | "sameBuildAt" | "subscribe">;
  reach: Pick<ServerReachStore, "isOffline" | "subscribe">;
  /** When the pulse last really answered (ms): the line's last proof of reach, null before any. */
  proofAt: () => number | null;
}

/** Starts the watch; returns its stop. A state already on when it starts counts as turning on then (a remount while
 *  pending or offline distrusts again, which changes nothing it already distrusted). */
export function watchSuspectPrefetches(deps: Partial<SuspectWatchDeps> & Pick<SuspectWatchDeps, "proofAt">): () => void {
  const { held = heldRoutes, update = updatePending, reach = serverReach, proofAt } = deps;
  let pending = false;
  let offline = false;
  const look = (): void => {
    const nowPending = update.isPending();
    if (nowPending && !pending) held.distrustSince(update.sameBuildAt());
    pending = nowPending;
    const nowOffline = reach.isOffline();
    if (nowOffline && !offline) held.distrustSince(proofAt());
    offline = nowOffline;
  };
  const offUpdate = update.subscribe(look);
  const offReach = reach.subscribe(look);
  look();
  return () => {
    offUpdate();
    offReach();
  };
}
