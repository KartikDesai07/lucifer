// The page's one offline state (Printing Phase 5, spec 5.1; plan Task 10). A store over the pure nextOfflineState
// (lib/offline-state.ts) that every reader of this tab shares: the send path decides by it, the pulse and the send
// feed it, the header and the replay runner read it. Module state is this tab's state (one page per tab), so no
// provider has to sit above all of them.

import { ONLINE_STATE, nextOfflineState, reachOf, type OfflineEvent, type OfflineState, type ServerReach } from "./offline-state";

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
      const same =
        next.offline === state.offline && next.pulseMisses === state.pulseMisses && next.writeMissed === state.writeMissed && next.browserOffline === state.browserOffline;
      if (next === state || same) return;
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

/** A pulse tick that failed (the review's I1): its reach; null when there is nothing to report (no failed tick yet, or
 *  the next answer cleared the error — TanStack sets it back to null with the count unchanged). */
export function pulseErrorReach(errorUpdateCount: number, error: unknown): ServerReach | null {
  return errorUpdateCount > 0 && error !== null && error !== undefined ? reachOf(error) : null;
}

/** An order write's answer (the send path, spec 5.1): one that came back (`null`) or reached us ends offline; one with
 *  no answer is remembered and checked once at once (`check`: one pulse refetch, its retry included), and offline
 *  starts only when that check gets no answer either. A check that throws is a miss. */
export async function reportWriteAnswer(error: unknown, store: ServerReachStore, check: () => Promise<ServerReach>): Promise<void> {
  const reach = error === null ? "reached" : reachOf(error);
  store.report({ type: "write", reach });
  if (reach === "reached") return;
  const checked = await check().catch((): ServerReach => "unreached");
  store.report({ type: "check", reach: checked });
}
