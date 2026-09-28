// Slice D review fixes (D-F1, D-F3, D-F5) over lib/realtime-invalidate.ts, run
// against a REAL QueryClient with an injected clock (no React, no socket). Split
// from realtime-live-state.test.ts to keep both files under the size cap.
//   D-F1 — a nudge never cancels an in-flight fetch; the query is re-checked
//          once per window and invalidated once it is idle.
//   D-F3 — one late tables refetch past the per-instance GET /api/tables cache.
//   D-F5 — Kitchen nudges hold while a Kitchen tick / ready write is in flight.

import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver, MutationObserver, focusManager, type InvalidateQueryFilters, type QueryKey } from "@tanstack/react-query";

import { TTL } from "@/lib/cache";
import { createRealtimeInvalidator, type NudgeTimers, type RealtimeInvalidateSpec } from "@/lib/realtime-invalidate";
import {
  KITCHEN_EVENT_KINDS, KITCHEN_REALTIME, LIVE_STATE_EVENT_KINDS, LIVE_STATE_REALTIME,
  REALTIME_NUDGE_COALESCE_MS, TABLES_LATE_REFETCH_MS,
} from "@/hooks/use-realtime";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { KITCHEN_KEYS } from "@/hooks/use-kitchen";

const WINDOW = REALTIME_NUDGE_COALESCE_MS;
const MAX_TICKS = 50;
const MS_PER_S = 1000;
const OPEN_TABS = ORDER_KEYS.list({ payment: "Unpaid", status: "Pending" });
const TODAY = ORDER_KEYS.list({ date: "2026-09-29" });
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

function setup(kinds: readonly string[] = LIVE_STATE_EVENT_KINDS, spec: RealtimeInvalidateSpec = LIVE_STATE_REALTIME) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const calls: InvalidateQueryFilters[] = [];
  const real = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((filters?: InvalidateQueryFilters, options?: object) => {
    calls.push(filters ?? {});
    return real(filters, options);
  }) as QueryClient["invalidateQueries"];
  const clock = timeClock();
  return { qc, calls, clock, nudger: createRealtimeInvalidator(qc, kinds, spec, clock.timers) };
}

/** A query whose every fetch stays in flight until finish(i). */
function slowQuery(qc: QueryClient, queryKey: QueryKey) {
  const signals: AbortSignal[] = [];
  const gates: Array<(value: unknown[]) => void> = [];
  const observer = new QueryObserver(qc, {
    queryKey,
    queryFn: ({ signal }) => {
      signals.push(signal);
      return new Promise<unknown[]>((resolve) => gates.push(resolve));
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  return { signals, count: () => signals.length, finish: (i: number) => gates[i]([]), unsubscribe };
}

/** A query whose fetches resolve at once; count() is how many ran. */
function quickQuery(qc: QueryClient, queryKey: QueryKey) {
  let fetches = 0;
  const observer = new QueryObserver(qc, { queryKey, queryFn: async () => (fetches++, []) });
  const unsubscribe = observer.subscribe(() => {});
  return { count: () => fetches, unsubscribe };
}

async function idle(qc: QueryClient, queryKey: QueryKey) {
  for (let i = 0; i < MAX_TICKS && qc.getQueryState(queryKey)?.fetchStatus !== "idle"; i++) await tick();
  assert.equal(qc.getQueryState(queryKey)?.fetchStatus, "idle", "precondition: the fetch settled");
}

test("D-F1 (a) a nudge during an in-flight list fetch does not cancel it; exactly one more fetch follows once it settles", async () => {
  const { qc, clock, nudger } = setup();
  qc.setQueryData(OPEN_TABS, []);
  qc.setQueryData(TODAY, []);
  const list = slowQuery(qc, OPEN_TABS);
  try {
    assert.equal(list.count(), 1, "precondition: the mount fetch is in flight");
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    await tick();
    assert.equal(list.signals[0].aborted, false, "the in-flight fetch is never aborted");
    assert.equal(list.count(), 1, "no second fetch while the first is in flight");
    assert.equal(qc.getQueryState(TODAY)?.isInvalidated, true, "an idle sibling list is still nudged in the same round");
    list.finish(0);
    await idle(qc, OPEN_TABS);
    assert.equal(list.count(), 1, "nothing refetches the moment it settles");
    clock.advance(WINDOW);
    await tick();
    assert.equal(list.count(), 2, "the next window re-checks it and fetches the post-write state once");
    list.finish(1);
    await idle(qc, OPEN_TABS);
    clock.advance(WINDOW * 5);
    await tick();
    assert.equal(list.count(), 2, "bounded: no further fetch without a new frame");
    assert.deepEqual(clock.armed(), [], "nothing left armed");
  } finally {
    nudger.dispose();
    list.unsubscribe();
  }
});

test("D-F1 (b) nudges every window while one fetch spans three windows: never cancelled, and a fetch that starts after the last nudge still runs", async () => {
  const { qc, clock, nudger } = setup();
  qc.setQueryData(OPEN_TABS, []);
  const list = slowQuery(qc, OPEN_TABS);
  try {
    for (let i = 0; i < 3; i++) {
      nudger.onKind(i % 2 ? "kot-fired" : "order-changed");
      clock.advance(WINDOW);
      await tick();
      assert.equal(list.signals[0].aborted, false, `window ${i + 1}: not aborted`);
      assert.equal(list.count(), 1, `window ${i + 1}: still the one fetch`);
    }
    list.finish(0);
    await idle(qc, OPEN_TABS);
    clock.advance(WINDOW);
    await tick();
    assert.equal(list.count(), 2, "the fetch after the last nudge runs");
    list.finish(1);
    await idle(qc, OPEN_TABS);
    clock.advance(WINDOW * 5);
    await tick();
    assert.equal(list.count(), 2, "and only one");
  } finally {
    nudger.dispose();
    list.unsubscribe();
  }
});

test("D-F1 dispose() drops a deferred re-check: nothing fetches afterwards", async () => {
  const { qc, clock, nudger } = setup();
  qc.setQueryData(OPEN_TABS, []);
  const list = slowQuery(qc, OPEN_TABS);
  try {
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    nudger.dispose();
    assert.deepEqual(clock.armed(), [], "dispose clears the re-check window");
    list.finish(0);
    await idle(qc, OPEN_TABS);
    clock.advance(WINDOW * 5);
    await tick();
    assert.equal(list.count(), 1);
  } finally {
    list.unsubscribe();
  }
});

test("D-F3 PIN: the late tables refetch waits longer than the GET /api/tables cache TTL", () => {
  assert.ok(TTL.TABLES > 0, "positive landmark: TTL.TABLES is read");
  assert.ok(TABLES_LATE_REFETCH_MS > TTL.TABLES * MS_PER_S, `${TABLES_LATE_REFETCH_MS} must exceed ${TTL.TABLES * MS_PER_S}`);
});

test("D-F3 a visible round that refetched the tables schedules exactly ONE more tables refetch, TABLES_LATE_REFETCH_MS later", async () => {
  const { qc, calls, clock, nudger } = setup();
  const tables = quickQuery(qc, TABLE_KEYS.all);
  try {
    await idle(qc, TABLE_KEYS.all);
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    await idle(qc, TABLE_KEYS.all);
    assert.equal(tables.count(), 2, "the round refetched the tables");
    const tableCalls = () => calls.filter((c) => c.queryKey?.[0] === TABLE_KEYS.all[0]).length;
    const afterRound = tableCalls();
    clock.advance(TABLES_LATE_REFETCH_MS - 1);
    await tick();
    assert.equal(tables.count(), 2, "not before the late delay");
    clock.advance(1);
    await idle(qc, TABLE_KEYS.all);
    assert.equal(tables.count(), 3, "one late tables refetch");
    assert.equal(tableCalls(), afterRound + 1, "exactly one more tables invalidation");
    clock.advance(TABLES_LATE_REFETCH_MS * 5);
    await tick();
    assert.equal(tables.count(), 3, "the late refetch never re-arms itself");
    assert.deepEqual(clock.armed(), []);
  } finally {
    nudger.dispose();
    tables.unsubscribe();
  }
});

test("D-F3 coalesced: a new round re-arms the late refetch, so two rounds give one late refetch after the second", async () => {
  const { qc, clock, nudger } = setup();
  const tables = quickQuery(qc, TABLE_KEYS.all);
  const GAP_MS = 2000;
  try {
    await idle(qc, TABLE_KEYS.all);
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    await idle(qc, TABLE_KEYS.all);
    clock.advance(GAP_MS);
    nudger.onKind("kot-fired");
    clock.advance(WINDOW);
    await idle(qc, TABLE_KEYS.all);
    assert.equal(tables.count(), 3, "two rounds, two refetches");
    clock.advance(TABLES_LATE_REFETCH_MS - 1);
    await tick();
    assert.equal(tables.count(), 3, "the first round's late refetch was superseded");
    clock.advance(1);
    await idle(qc, TABLE_KEYS.all);
    assert.equal(tables.count(), 4, "one late refetch, after the second round");
    clock.advance(TABLES_LATE_REFETCH_MS * 5);
    await tick();
    assert.equal(tables.count(), 4);
  } finally {
    nudger.dispose();
    tables.unsubscribe();
  }
});

test("D-F3 dispose() cancels a pending late refetch", async () => {
  const { qc, clock, nudger } = setup();
  const tables = quickQuery(qc, TABLE_KEYS.all);
  try {
    await idle(qc, TABLE_KEYS.all);
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    await idle(qc, TABLE_KEYS.all);
    assert.deepEqual(clock.armed(), [TABLES_LATE_REFETCH_MS], "precondition: the late refetch is armed");
    nudger.dispose();
    assert.deepEqual(clock.armed(), [], "dispose clears it");
    clock.advance(TABLES_LATE_REFETCH_MS * 2);
    await tick();
    assert.equal(tables.count(), 2);
  } finally {
    tables.unsubscribe();
  }
});

test("D-F3 a hidden tab schedules no late refetch", async () => {
  const { qc, calls, clock, nudger } = setup();
  const tables = quickQuery(qc, TABLE_KEYS.all);
  try {
    await idle(qc, TABLE_KEYS.all);
    focusManager.setFocused(false);
    nudger.onKind("order-changed");
    clock.advance(WINDOW);
    await tick();
    assert.ok(calls.some((c) => c.queryKey?.[0] === TABLE_KEYS.all[0]), "positive landmark: the hidden round did nudge the tables");
    assert.deepEqual(clock.armed(), [], "no late refetch armed");
    clock.advance(TABLES_LATE_REFETCH_MS * 2);
    await tick();
    assert.equal(tables.count(), 1, "stale only, nothing refetched");
  } finally {
    nudger.dispose();
    tables.unsubscribe();
    focusManager.setFocused(undefined);
  }
});

test("D-F5 a Kitchen frame during a pending tick / ready write causes no refetch until it settles, then exactly one", async () => {
  const { qc, calls, nudger } = setup(KITCHEN_EVENT_KINDS, KITCHEN_REALTIME);
  const board = quickQuery(qc, KITCHEN_KEYS.all);
  try {
    await idle(qc, KITCHEN_KEYS.all);
    for (const mutationKey of [KITCHEN_KEYS.mutation, KITCHEN_KEYS.ready]) {
      calls.length = 0;
      const before = board.count();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const done = new MutationObserver(qc, { mutationKey, mutationFn: () => gate }).mutate();
      assert.equal(qc.isMutating({ mutationKey }), 1, `precondition: a ${mutationKey.join("/")} write is in flight`);
      nudger.onKind("kot-ticked");
      nudger.onKind("order-changed");
      await tick();
      assert.equal(calls.length, 0, `${mutationKey.join("/")}: no invalidation while the write is in flight`);
      assert.equal(board.count(), before, `${mutationKey.join("/")}: no refetch while the write is in flight`);
      release();
      await done;
      await idle(qc, KITCHEN_KEYS.all);
      assert.deepEqual(calls, [{ queryKey: KITCHEN_KEYS.all }], `${mutationKey.join("/")}: one flush, today's exact call`);
      assert.equal(board.count(), before + 1, `${mutationKey.join("/")}: one refetch once it settles`);
    }
  } finally {
    nudger.dispose();
    board.unsubscribe();
  }
});
