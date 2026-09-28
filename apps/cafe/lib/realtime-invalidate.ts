import { focusManager, matchQuery, type Query, type QueryClient, type QueryKey } from "@tanstack/react-query";

// ─────────────────────────────────────────────────────────────────────────────
// Realtime nudges → query invalidation. Why a new file: this factory needs a
// runtime node:test without React; lib/realtime-client.ts is the socket and
// stays unaware of queries; hooks/use-realtime.ts is only the React wiring
// (one effect) plus the per-surface specs.
//
// A nudge carries a KIND and nothing else, so all a device can do with one is
// refetch its own queries early. The spec says which queries, and how gently:
//   * no `coalesceMs`  → invalidate at once, once per frame (the Kitchen board,
//     the print host and the pulse — exactly the shipped behaviour);
//   * `coalesceMs`     → a burst of frames inside one fixed window becomes ONE
//     round (a busy room must not refetch every list once per frame — each
//     invalidate fans out to every cache subscriber). A coalesced round never
//     CANCELS an in-flight fetch (on a slow line, frequent nudges would starve
//     the list): a query still fetching is left alone and re-checked once per
//     window, then invalidated once it is idle — the fetch in flight may have
//     started before the write, so the post-write state is still fetched;
//   * `holdWhileMutating` → no round while a write under that key is in flight
//     (it would clobber the optimistic state the live lists pause their own
//     polls for); the held round runs once the last write settles (one window
//     later when coalesced);
//   * `staleOnlyWhenHidden` → a hidden tab only marks the queries stale. When
//     the tab is shown again, ONE round runs at once (however many ran hidden),
//     so it refetches them (and arms `lateRefetch`) whatever each list's own
//     refetchOnWindowFocus says; TanStack's focus refetch, when on, shares that
//     fetch (neither cancels the other);
//   * `lateRefetch` → after a coalesced round that refetched that key on a
//     visible tab, ONE more invalidation of it `afterMs` later (a new round
//     re-arms it). For a server read cached per instance, whose first refetch
//     can land on a warm instance still holding the old value.
// Every poll stays exactly as it is. A lost frame costs one poll interval.
// ─────────────────────────────────────────────────────────────────────────────

export interface RealtimeTarget {
  queryKey: QueryKey;
  /** Narrows the prefix match (e.g. an infinite list only while one page is loaded). */
  predicate?: (query: Query) => boolean;
}

export interface RealtimeInvalidateSpec {
  targets: readonly RealtimeTarget[];
  coalesceMs?: number;
  holdWhileMutating?: QueryKey;
  staleOnlyWhenHidden?: boolean;
  lateRefetch?: { queryKey: QueryKey; afterMs: number };
}

/** Injected so the tests drive the window by hand. */
export interface NudgeTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const BROWSER_TIMERS: NudgeTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RealtimeInvalidator {
  /** Feed every inbound kind here; kinds outside the list are ignored. */
  onKind: (kind: string) => void;
  /** Clears every timer, the re-checks and the mutation + visibility listeners; nothing flushes afterwards. */
  dispose: () => void;
}

const inFlight = (query: Query): boolean => query.state.fetchStatus !== "idle";
const everyQuery = (): boolean => true;

export function createRealtimeInvalidator(
  qc: QueryClient,
  kinds: readonly string[],
  spec: RealtimeInvalidateSpec,
  timers: NudgeTimers = BROWSER_TIMERS,
): RealtimeInvalidator {
  let pending = false;
  let armed = false;
  let handle: unknown;
  let lateHandle: unknown;
  let disposed = false;
  // A hidden round marked queries stale: showing the tab runs one round.
  let staleWhileHidden = false;
  // Queries a coalesced round left alone because they were fetching, re-checked
  // once per window against their target's own `select` (a list that no longer
  // qualifies is dropped). `armsLate`: whether their refetch may arm
  // `lateRefetch` (false for the late refetch's own, so it never re-arms itself).
  const deferred = new Map<Query, { armsLate: boolean; select: (query: Query) => boolean }>();
  const cache = qc.getQueryCache();

  const held = (): boolean =>
    spec.holdWhileMutating !== undefined &&
    qc.isMutating({ mutationKey: spec.holdWhileMutating }) > 0;

  const hidden = (): boolean => spec.staleOnlyWhenHidden === true && !focusManager.isFocused();

  // The immediate specs: today's exact call, once per target.
  const invalidateNow = (): void => {
    if (hidden()) staleWhileHidden = true;
    const refetchType = hidden() ? { refetchType: "none" as const } : {};
    for (const target of spec.targets) {
      void qc.invalidateQueries({
        queryKey: target.queryKey,
        ...(target.predicate ? { predicate: target.predicate } : {}),
        ...refetchType,
      });
    }
  };

  const onLate = (): void => {
    if (disposed || !spec.lateRefetch) return;
    for (const query of cache.findAll({ queryKey: spec.lateRefetch.queryKey })) {
      if (!deferred.has(query)) deferred.set(query, { armsLate: false, select: everyQuery });
    }
    // Held: the mutation listener picks the re-check up once the write settles.
    if (held()) return;
    recheck();
    if (deferred.size > 0) schedule();
  };

  const armLate = (): void => {
    if (!spec.lateRefetch) return;
    timers.clearTimeout(lateHandle);
    lateHandle = timers.setTimeout(onLate, spec.lateRefetch.afterMs);
  };

  // Invalidates every IDLE query `select` matches — never cancelling a fetch
  // (cancelRefetch: false, and the idle filter) — and defers the in-flight ones.
  // `only` narrows it to that one query (a re-check), still under `select`.
  const refresh = (queryKey: QueryKey, select: (query: Query) => boolean, armsLate: boolean, only?: Query): void => {
    const isHidden = hidden();
    if (isHidden) staleWhileHidden = true;
    const pick = only === undefined ? select : (query: Query) => query === only && select(query);
    const matches = cache.findAll({ queryKey, predicate: pick });
    const late = spec.lateRefetch;
    // Read BEFORE invalidating: the refetch flips an idle query to fetching.
    const refetchesLateKey =
      armsLate && !isHidden && late !== undefined &&
      matches.some((query) => !inFlight(query) && query.isActive() && matchQuery({ queryKey: late.queryKey }, query));
    for (const query of matches) {
      if (inFlight(query)) deferred.set(query, { armsLate: armsLate || deferred.get(query)?.armsLate === true, select });
    }
    void qc.invalidateQueries(
      { queryKey, predicate: pick, fetchStatus: "idle", ...(isHidden ? { refetchType: "none" as const } : {}) },
      { cancelRefetch: false },
    );
    if (refetchesLateKey) armLate();
  };

  const recheck = (): void => {
    const due = [...deferred];
    deferred.clear();
    for (const [query, { armsLate, select }] of due) {
      // Gone from the cache (garbage-collected) → nothing to refetch.
      if (cache.get(query.queryHash) === query) refresh(query.queryKey, select, armsLate, query);
    }
  };

  const flush = (): void => {
    armed = false;
    if (disposed) return;
    // Held: stay pending. The mutation listener below re-arms once the last
    // write settles, so a held round is delayed, never lost.
    if (held()) return;
    if (spec.coalesceMs === undefined) {
      pending = false;
      invalidateNow();
      return;
    }
    if (pending) {
      // A round covers every target, so it re-decides every deferred query.
      pending = false;
      deferred.clear();
      for (const target of spec.targets) refresh(target.queryKey, target.predicate ?? everyQuery, true);
    } else {
      recheck();
    }
    // One re-check per window while anything is still fetching.
    if (deferred.size > 0) schedule();
  };

  const schedule = (): void => {
    if (armed) return;
    if (spec.coalesceMs === undefined) {
      flush();
      return;
    }
    armed = true;
    handle = timers.setTimeout(flush, spec.coalesceMs);
  };

  const stopListening =
    spec.holdWhileMutating === undefined
      ? undefined
      : qc.getMutationCache().subscribe(() => {
          if ((pending || deferred.size > 0) && !held()) schedule();
        });

  // The tab shown again after a hidden round: one round at once (a window
  // armed meanwhile folds into it). Held: it waits for the write like any round.
  const stopWatchingFocus =
    spec.staleOnlyWhenHidden !== true
      ? undefined
      : focusManager.subscribe((focused) => {
          if (!focused || disposed || !staleWhileHidden) return;
          staleWhileHidden = false;
          pending = true;
          timers.clearTimeout(handle);
          armed = false;
          flush();
        });

  return {
    onKind: (kind) => {
      if (disposed || !kinds.includes(kind)) return;
      pending = true;
      schedule();
    },
    dispose: () => {
      disposed = true;
      timers.clearTimeout(handle);
      timers.clearTimeout(lateHandle);
      deferred.clear();
      stopListening?.();
      stopWatchingFocus?.();
    },
  };
}
