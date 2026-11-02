// Slice D follow-up fixes (R1, R2) over lib/realtime-invalidate.ts, run against
// a REAL QueryClient with an injected clock (no React, no socket). Split from
// realtime-nudge-fetch.test.ts to keep both files under the size cap.
//   R1 — a deferred (was-fetching) query is re-checked against its target's OWN
//        predicate: an infinite list that grew to two pages meanwhile is
//        dropped, never refetched page by page.
//   R2 — a hidden-tab round only marks the targets stale; when the tab is shown
//        again ONE round runs at once (coalesced) and its tables refetch reads
//        the floor fresh. The tab is simulated the way the other suites do it:
//        focusManager.setFocused (TanStack's own visibilitychange handler
//        feeds the same listeners).
//   F7 (perf P1) — the spec's onRound runs once at the start of every visible
//        pass (never a hidden one), so LIVE_STATE_REALTIME's tables refetch
//        reads /api/tables?fresh=1 and the 6 s late tables refetch is gone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver, InfiniteQueryObserver, focusManager, type InvalidateQueryFilters, type QueryKey } from "@tanstack/react-query";

import { createRealtimeInvalidator, type NudgeTimers, type RealtimeInvalidateSpec } from "@/lib/realtime-invalidate";
import { takeTablesFreshRead } from "@/lib/tables-fresh-read";
import { LIVE_STATE_EVENT_KINDS, LIVE_STATE_REALTIME, REALTIME_NUDGE_COALESCE_MS } from "@/hooks/use-realtime";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";

const WINDOW = REALTIME_NUDGE_COALESCE_MS;
const MAX_TICKS = 50;
/** The late tables refetch F7 removed (TABLES_LATE_REFETCH_MS) — nothing may happen at or after it. */
const LATE_WAS_MS = 6000;
const OPEN_TABS = ORDER_KEYS.list({ payment: "Unpaid", status: "Pending" });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A hand-driven clock that knows the time: advance(ms) fires what falls due, in order. */
function timeClock() {
  let now = 0;
  let nextId = 1;
  const armed = new Map<number, { fn: () => void; at: number; ms: number }>();
  const timers: NudgeTimers = {
    setTimeout: (fn, ms) => (armed.set(nextId, { fn, at: now + ms, ms }), nextId++),
    clearTimeout: (handle) => void armed.delete(handle as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...armed.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      armed.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  return { timers, advance, armed: () => [...armed.values()].map((t) => t.ms) };
}

function setup(spec: RealtimeInvalidateSpec = LIVE_STATE_REALTIME) {
  takeTablesFreshRead(); // F7: every case starts with the module's one-shot flag clear
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const calls: InvalidateQueryFilters[] = [];
  const real = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((filters?: InvalidateQueryFilters, options?: object) => {
    calls.push(filters ?? {});
    return real(filters, options);
  }) as QueryClient["invalidateQueries"];
  const clock = timeClock();
  return { qc, calls, clock, nudger: createRealtimeInvalidator(qc, LIVE_STATE_EVENT_KINDS, spec, clock.timers) };
}

async function idle(qc: QueryClient, queryKey: QueryKey) {
  for (let i = 0; i < MAX_TICKS && qc.getQueryState(queryKey)?.fetchStatus !== "idle"; i++) await tick();
  assert.equal(qc.getQueryState(queryKey)?.fetchStatus, "idle", "precondition: the fetch settled");
}

/** A query whose fetches resolve at once; count() is how many ran. */
function quickQuery(qc: QueryClient, queryKey: QueryKey) {
  let fetches = 0;
  const unsubscribe = new QueryObserver(qc, { queryKey, queryFn: async () => (fetches++, []) }).subscribe(() => {});
  return { count: () => fetches, unsubscribe };
}

/** The tables query as useTables runs it: each fetch takes the one-shot fresh-read flag (F7). */
function floorQuery(qc: QueryClient) {
  const reads: boolean[] = [];
  const unsubscribe = new QueryObserver(qc, { queryKey: TABLE_KEYS.all, queryFn: async () => (reads.push(takeTablesFreshRead()), []) }).subscribe(() => {});
  return { reads, count: () => reads.length, unsubscribe };
}

test("R1 a one-page list fetching its next page during a round is NOT refetched once it settles with two pages", async () => {
  const { qc, clock, nudger } = setup();
  const key = ORDER_KEYS.infiniteList({});
  const pageCalls: unknown[] = [];
  let releaseNext: () => void = () => {};
  const observer = new InfiniteQueryObserver(qc, {
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: () => "cursor",
    queryFn: ({ pageParam }) => {
      pageCalls.push(pageParam);
      if (pageParam === undefined) return Promise.resolve([]);
      return new Promise<unknown[]>((resolve) => (releaseNext = () => resolve([])));
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await idle(qc, key);
    const next = observer.fetchNextPage();
    assert.equal(qc.getQueryState(key)?.fetchStatus, "fetching", "precondition: Load more is in flight");
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    assert.deepEqual(clock.armed(), [WINDOW], "precondition: the in-flight list was deferred to a re-check");
    releaseNext();
    await next;
    await idle(qc, key);
    const settled = qc.getQueryData<{ pages: unknown[] }>(key);
    assert.equal(settled?.pages.length, 2, "precondition: the list now holds two pages");
    const before = pageCalls.length;
    clock.advance(WINDOW);
    await tick();
    assert.equal(qc.getQueryState(key)?.isInvalidated, false, "the re-check re-applies the one-page rule");
    assert.equal(pageCalls.length, before, "no page is refetched");
    assert.deepEqual(clock.armed(), [], "dropped from the re-check set, nothing left armed");
  } finally {
    nudger.dispose();
    unsubscribe();
  }
});

test("R2 hidden rounds, then the tab is shown: the stale tables refetch ONCE at once, reading the floor fresh — and no late refetch after (F7)", async () => {
  const { qc, clock, nudger } = setup();
  const floor = floorQuery(qc);
  try {
    await idle(qc, TABLE_KEYS.all);
    focusManager.setFocused(false);
    for (const kind of ["order-changed", "kot-fired"]) {
      nudger.onKind(kind);
      clock.advance(WINDOW);
    }
    await tick();
    assert.equal(qc.getQueryState(TABLE_KEYS.all)?.isInvalidated, true, "precondition: hidden rounds mark the tables stale");
    assert.equal(floor.count(), 1, "precondition: nothing refetched while hidden");
    assert.deepEqual(clock.armed(), [], "precondition: nothing armed while hidden");
    focusManager.setFocused(true);
    await idle(qc, TABLE_KEYS.all);
    assert.deepEqual(floor.reads, [false, true], "shown: one refetch for both hidden rounds, at once, past the instance cache");
    assert.deepEqual(clock.armed(), [], "F7: no late tables refetch is armed");
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    clock.advance(LATE_WAS_MS * 5);
    await tick();
    assert.equal(floor.count(), 2, "showing the tab again with no hidden round since refetches nothing");
  } finally {
    nudger.dispose();
    floor.unsubscribe();
    focusManager.setFocused(undefined);
  }
});

test("F7 a visible round calls onRound ONCE, before it invalidates anything; a hidden round never calls it", () => {
  const seen: number[] = [];
  const { calls, clock, nudger } = setup({ ...LIVE_STATE_REALTIME, onRound: () => seen.push(calls.length) });
  const targets = LIVE_STATE_REALTIME.targets.length;
  try {
    nudger.onKind("order-changed");
    nudger.onKind("kot-fired");
    clock.advance(WINDOW);
    assert.equal(calls.length, targets, "precondition: the round ran");
    assert.deepEqual(seen, [0], "one call for the round, before its first invalidation");
    focusManager.setFocused(false);
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    assert.equal(calls.length, targets * 2, "precondition: the hidden round marked the targets stale");
    assert.deepEqual(seen, [0], "a hidden (mark-stale) round never calls onRound");
  } finally {
    nudger.dispose();
    focusManager.setFocused(undefined);
  }
});

test("F7 (generic) an immediate (uncoalesced) spec calls onRound once per frame, before its invalidation", () => {
  const seen: number[] = [];
  const { calls, clock, nudger } = setup({ targets: [{ queryKey: TABLE_KEYS.all }], onRound: () => seen.push(calls.length) });
  nudger.onKind("order-changed");
  assert.deepEqual(seen, [0], "before the frame's one invalidation");
  assert.equal(calls.length, 1, "precondition: the immediate invalidation ran");
  assert.deepEqual(clock.armed(), [], "no window: an immediate spec");
  nudger.dispose();
});

test("F7 LIVE_STATE: the round's own tables refetch reads fresh, a later fetch reads the plain route, and nothing follows 6 s later", async () => {
  const { qc, calls, clock, nudger } = setup();
  const floor = floorQuery(qc);
  const tableCalls = () => calls.filter((c) => c.queryKey?.[0] === TABLE_KEYS.all[0]).length;
  try {
    await idle(qc, TABLE_KEYS.all);
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    await idle(qc, TABLE_KEYS.all);
    assert.deepEqual(floor.reads, [false, true], "mount: the plain read; the nudge round's refetch: past the instance cache");
    const afterRound = tableCalls();
    clock.advance(LATE_WAS_MS * 5);
    await tick();
    assert.equal(floor.count(), 2, "no late tables refetch");
    assert.equal(tableCalls(), afterRound, "no second tables invalidation 6 s later");
    assert.deepEqual(clock.armed(), [], "nothing armed");
    await qc.refetchQueries({ queryKey: TABLE_KEYS.all });
    assert.deepEqual(floor.reads, [false, true, false], "one-shot: the next fetch (a poll, a focus) is the plain cached read");
  } finally {
    nudger.dispose();
    floor.unsubscribe();
  }
});

test("F7 a tables fetch in flight during the round is re-checked a window later, and the re-check marks the fresh read again", async () => {
  const { qc, clock, nudger } = setup();
  const reads: boolean[] = [];
  const gates: Array<() => void> = [];
  const queryFn = () => (reads.push(takeTablesFreshRead()), new Promise<unknown[]>((resolve) => gates.push(() => resolve([]))));
  const unsubscribe = new QueryObserver(qc, { queryKey: TABLE_KEYS.all, queryFn }).subscribe(() => {});
  try {
    assert.deepEqual(reads, [false], "precondition: the mount fetch is in flight");
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    assert.deepEqual(clock.armed(), [WINDOW], "precondition: the in-flight floor was deferred to a re-check");
    assert.equal(takeTablesFreshRead(), true, "the round marked it; another fetch (a mount, a focus) takes it meanwhile");
    gates[0]();
    await idle(qc, TABLE_KEYS.all);
    clock.advance(WINDOW);
    for (let i = 0; i < MAX_TICKS / 5 && reads.length < 2; i++) await tick();
    assert.deepEqual(reads, [false, true], "the re-check's refetch still reads past the instance cache");
    gates[1]();
    await idle(qc, TABLE_KEYS.all);
    assert.deepEqual(clock.armed(), [], "nothing left armed");
  } finally {
    nudger.dispose();
    unsubscribe();
  }
});

test("R2 with TanStack's own focus refetch live (client mounted), showing the tab still fetches the stale list exactly once", async () => {
  const { qc, clock, nudger } = setup();
  qc.mount();
  const gates: Array<(value: unknown[]) => void> = [];
  const observer = new QueryObserver(qc, { queryKey: OPEN_TABS, queryFn: () => new Promise<unknown[]>((resolve) => gates.push(resolve)) });
  const unsubscribe = observer.subscribe(() => {});
  try {
    gates[0]([]);
    await idle(qc, OPEN_TABS);
    focusManager.setFocused(false);
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    await tick();
    assert.equal(gates.length, 1, "precondition: hidden, nothing refetched");
    focusManager.setFocused(true);
    for (let i = 0; i < MAX_TICKS / 5; i++) await tick();
    assert.equal(gates.length, 2, "the nudge round and the focus refetch share ONE fetch");
    gates[1]([]);
    await idle(qc, OPEN_TABS);
    clock.advance(WINDOW * 5);
    await tick();
    assert.equal(gates.length, 2, "and nothing follows it");
  } finally {
    nudger.dispose();
    unsubscribe();
    qc.unmount();
    focusManager.setFocused(undefined);
  }
});

test("R2 dispose() detaches the visibility listener, and a StrictMode remount leaves exactly one", async () => {
  const listenerCount = () => (focusManager as unknown as { listeners: Set<unknown> }).listeners.size;
  const base = listenerCount();
  const { qc, calls, clock, nudger } = setup();
  const tables = quickQuery(qc, TABLE_KEYS.all);
  try {
    assert.equal(listenerCount(), base + 1, "the live nudger listens for the tab being shown");
    await idle(qc, TABLE_KEYS.all);
    nudger.dispose();
    assert.equal(listenerCount(), base, "dispose removes the listener");
    const remount = createRealtimeInvalidator(qc, LIVE_STATE_EVENT_KINDS, LIVE_STATE_REALTIME, clock.timers);
    assert.equal(listenerCount(), base + 1, "the remount holds exactly one");
    focusManager.setFocused(false);
    remount.onKind("order-changed");
    clock.advance(WINDOW);
    calls.length = 0;
    focusManager.setFocused(true);
    await idle(qc, TABLE_KEYS.all);
    assert.equal(calls.length, LIVE_STATE_REALTIME.targets.length, "one round on show, from the live nudger only");
    assert.equal(tables.count(), 2);
    remount.dispose();
    assert.equal(listenerCount(), base);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await tick();
    assert.equal(tables.count(), 2, "a disposed nudger never runs a round");
  } finally {
    tables.unsubscribe();
    focusManager.setFocused(undefined);
  }
});
