// Slice D follow-up fixes (R1, R2) over lib/realtime-invalidate.ts, run against
// a REAL QueryClient with an injected clock (no React, no socket). Split from
// realtime-nudge-fetch.test.ts to keep both files under the size cap.
//   R1 — a deferred (was-fetching) query is re-checked against its target's OWN
//        predicate: an infinite list that grew to two pages meanwhile is
//        dropped, never refetched page by page.
//   R2 — a hidden-tab round only marks the targets stale; when the tab is shown
//        again ONE round runs at once (coalesced) and arms the late tables
//        refetch. The tab is simulated the way the other suites do it:
//        focusManager.setFocused (TanStack's own visibilitychange handler
//        feeds the same listeners).

import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver, InfiniteQueryObserver, focusManager, type InvalidateQueryFilters, type QueryKey } from "@tanstack/react-query";

import { createRealtimeInvalidator, type NudgeTimers } from "@/lib/realtime-invalidate";
import { LIVE_STATE_EVENT_KINDS, LIVE_STATE_REALTIME, REALTIME_NUDGE_COALESCE_MS, TABLES_LATE_REFETCH_MS } from "@/hooks/use-realtime";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";

const WINDOW = REALTIME_NUDGE_COALESCE_MS;
const MAX_TICKS = 50;
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

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const calls: InvalidateQueryFilters[] = [];
  const real = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((filters?: InvalidateQueryFilters, options?: object) => {
    calls.push(filters ?? {});
    return real(filters, options);
  }) as QueryClient["invalidateQueries"];
  const clock = timeClock();
  return { qc, calls, clock, nudger: createRealtimeInvalidator(qc, LIVE_STATE_EVENT_KINDS, LIVE_STATE_REALTIME, clock.timers) };
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

test("R2 hidden rounds, then the tab is shown: the stale tables refetch ONCE at once, and the late refetch is armed then", async () => {
  const { qc, clock, nudger } = setup();
  const tables = quickQuery(qc, TABLE_KEYS.all);
  try {
    await idle(qc, TABLE_KEYS.all);
    focusManager.setFocused(false);
    for (const kind of ["order-changed", "kot-fired"]) {
      nudger.onKind(kind);
      clock.advance(WINDOW);
    }
    await tick();
    assert.equal(qc.getQueryState(TABLE_KEYS.all)?.isInvalidated, true, "precondition: hidden rounds mark the tables stale");
    assert.equal(tables.count(), 1, "precondition: nothing refetched while hidden");
    assert.deepEqual(clock.armed(), [], "precondition: no late refetch while hidden");
    focusManager.setFocused(true);
    await idle(qc, TABLE_KEYS.all);
    assert.equal(tables.count(), 2, "shown: one refetch for both hidden rounds, without waiting a window");
    assert.deepEqual(clock.armed(), [TABLES_LATE_REFETCH_MS], "shown: the late tables refetch is armed");
    clock.advance(TABLES_LATE_REFETCH_MS);
    await idle(qc, TABLE_KEYS.all);
    assert.equal(tables.count(), 3, "one late tables refetch");
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    clock.advance(TABLES_LATE_REFETCH_MS * 5);
    await tick();
    assert.equal(tables.count(), 3, "showing the tab again with no hidden round since refetches nothing");
  } finally {
    nudger.dispose();
    tables.unsubscribe();
    focusManager.setFocused(undefined);
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
