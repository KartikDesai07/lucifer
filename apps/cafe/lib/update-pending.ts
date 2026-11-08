// Does a newer build wait for this open page? The pulse reports the server's build id; this store compares it with
// the page's own. Pending follows the LATEST valid report: a report equal to the page's build (a rollback) clears it,
// and a missing / non-string / empty report (an older server, a bad answer) changes nothing. Listeners hear only real
// changes, because the pulse ticks every 20-60 s and an identical answer is the normal case. It also keeps when the
// pulse last reported the page's own build (post-verifier V1): a prefetch made after that may have been answered by a
// newer build, so when pending turns on those marks are distrusted (lib/suspect-prefetch.ts).
export interface UpdatePendingStore {
  isPending(): boolean;
  /** The latest valid build the pulse reported, null before any. */
  serverBuild(): string | null;
  /** The time of the latest report equal to the page's build (ms), null before any. */
  sameBuildAt(): number | null;
  /** `now`: when the report came (the pulse answer's time); a time alone moving notifies nobody. */
  observe(serverBuild: unknown, pageBuild: string, now?: number): void;
  subscribe(fn: () => void): () => void;
}

export function createUpdatePending(): UpdatePendingStore {
  let latest: string | null = null;
  let pending = false;
  let sameAt: number | null = null;
  const listeners = new Set<() => void>();
  return {
    isPending: () => pending,
    serverBuild: () => latest,
    sameBuildAt: () => sameAt,
    observe(serverBuild, pageBuild, now = Date.now()) {
      if (typeof serverBuild !== "string" || serverBuild === "") return;
      const nextPending = serverBuild !== pageBuild;
      if (!nextPending) sameAt = sameAt === null ? now : Math.max(sameAt, now);
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
