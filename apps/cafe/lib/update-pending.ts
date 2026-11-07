// Does a newer build wait for this open page? The pulse reports the server's build id; this store compares it with
// the page's own. Pending follows the LATEST valid report: a report equal to the page's build (a rollback) clears it,
// and a missing / non-string / empty report (an older server, a bad answer) changes nothing. Listeners hear only real
// changes, because the pulse ticks every 20-60 s and an identical answer is the normal case.
export interface UpdatePendingStore {
  isPending(): boolean;
  /** The latest valid build the pulse reported, null before any. */
  serverBuild(): string | null;
  observe(serverBuild: unknown, pageBuild: string): void;
  subscribe(fn: () => void): () => void;
}

export function createUpdatePending(): UpdatePendingStore {
  let latest: string | null = null;
  let pending = false;
  const listeners = new Set<() => void>();
  return {
    isPending: () => pending,
    serverBuild: () => latest,
    observe(serverBuild, pageBuild) {
      if (typeof serverBuild !== "string" || serverBuild === "") return;
      const nextPending = serverBuild !== pageBuild;
      if (serverBuild === latest && nextPending === pending) return;
      latest = serverBuild;
      pending = nextPending;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

export const updatePending = createUpdatePending();
