// The page's one offline state (Printing Phase 5, spec 5.1; plan Task 10). A store over the pure nextOfflineState
// (lib/offline-state.ts) that every reader of this tab shares: the send path decides by it, the pulse and the send
// feed it, the header and the replay runner read it. Module state is this tab's state (one page per tab), so no
// provider has to sit above all of them.

import { ONLINE_STATE, nextOfflineState, type OfflineEvent, type OfflineState } from "./offline-state";

export interface ServerReachStore {
  getState(): OfflineState;
  isOffline(): boolean;
  report(event: OfflineEvent): void;
  subscribe(listener: () => void): () => void;
}

export function createServerReach(): ServerReachStore {
  let state: OfflineState = ONLINE_STATE;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    isOffline: () => state.offline,
    report(event) {
      const next = nextOfflineState(state, event);
      if (next === state || (next.offline === state.offline && next.pulseMisses === state.pulseMisses && next.writeMissed === state.writeMissed)) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const serverReach = createServerReach();

/** The browser's own flag, from TanStack's onlineManager (it also pauses the queries while the browser says offline
 *  and refetches them when it is back, so the pulse that ends offline comes by itself). A browser already offline
 *  when the page starts is said at once. */
export function feedBrowserOnline(
  manager: { isOnline(): boolean; subscribe(listener: (online: boolean) => void): () => void },
  store: ServerReachStore = serverReach,
): () => void {
  if (!manager.isOnline()) store.report({ type: "browser", online: false });
  return manager.subscribe((online) => store.report({ type: "browser", online }));
}
