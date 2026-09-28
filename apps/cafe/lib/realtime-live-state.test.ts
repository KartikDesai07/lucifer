// Slice D (smooth writes, R9) — the realtime invalidation factory
// (lib/realtime-invalidate.ts) run against a REAL QueryClient with an injected
// clock and direct onKind calls (no React, no socket), over the REAL specs
// hooks/use-realtime.ts exports. Plus the mount/reachability pins for
// useLiveStateRealtime and the Dashboard/Orders live-list wiring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { QueryClient, QueryObserver, MutationObserver, focusManager, type InvalidateQueryFilters } from "@tanstack/react-query";

import { stripComments } from "@/lib/source-pin-utils";
import { createRealtimeInvalidator, type NudgeTimers, type RealtimeInvalidateSpec } from "@/lib/realtime-invalidate";
import {
  KITCHEN_EVENT_KINDS, KITCHEN_REALTIME, PRINT_EVENT_KINDS, PRINT_REALTIME, PULSE_EVENT_KINDS, PULSE_REALTIME,
  LIVE_STATE_EVENT_KINDS, LIVE_STATE_REALTIME, REALTIME_NUDGE_COALESCE_MS,
} from "@/hooks/use-realtime";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { KITCHEN_KEYS } from "@/hooks/use-kitchen";
import { PRINT_WAKE_KEYS } from "@/hooks/use-print-host-wake";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** A hand-driven clock: nothing fires until the test calls fire(). */
function fakeClock() {
  let nextId = 1;
  const armed = new Map<number, { fn: () => void; ms: number }>();
  const timers: NudgeTimers = {
    setTimeout: (fn, ms) => (armed.set(nextId, { fn, ms }), nextId++),
    clearTimeout: (handle) => void armed.delete(handle as number),
  };
  const fire = () => {
    const due = [...armed.values()];
    armed.clear();
    for (const t of due) t.fn();
  };
  return { timers, fire, armed: () => [...armed.values()].map((t) => t.ms) };
}

/** A QueryClient whose invalidateQueries calls are recorded (and still run). */
function spiedClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const calls: InvalidateQueryFilters[] = [];
  const real = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((filters?: InvalidateQueryFilters, options?: object) => {
    calls.push(filters ?? {});
    return real(filters, options);
  }) as QueryClient["invalidateQueries"];
  return { qc, calls };
}

const TODAY = ORDER_KEYS.list({ date: "2026-09-29" });
const OPEN_TABS = ORDER_KEYS.list({ payment: "Unpaid", status: "Pending" });
const invalidated = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated === true;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const MAX_TICKS = 50;

/** A spied client, a hand clock and a nudger (the live-state one by default) over them. */
function setup(kinds: readonly string[] = LIVE_STATE_EVENT_KINDS, spec: RealtimeInvalidateSpec = LIVE_STATE_REALTIME) {
  const { qc, calls } = spiedClient();
  const clock = fakeClock();
  return { qc, calls, clock, nudger: createRealtimeInvalidator(qc, kinds, spec, clock.timers) };
}

/** An order write held in flight until release(). */
function heldWrite(qc: QueryClient) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const done = new MutationObserver(qc, { mutationKey: ORDER_KEYS.mutation, mutationFn: () => gate }).mutate();
  return { done, release: () => release() };
}

function seedLiveCaches(qc: QueryClient) {
  qc.setQueryData(TODAY, []);
  qc.setQueryData(OPEN_TABS, []);
  qc.setQueryData(TABLE_KEYS.all, []);
  qc.setQueryData(ORDER_KEYS.summary(), { totalSales: 0 });
  qc.setQueryData(POS_PULSE_KEYS.all, { openCount: 0 });
}

test("(a) kot-fired / order-changed invalidate the order lists and tables after one window; the summary and the pulse stay valid", () => {
  for (const kind of ["kot-fired", "order-changed"]) {
    const { qc, calls, clock, nudger } = setup();
    seedLiveCaches(qc);
    nudger.onKind(kind);
    assert.equal(calls.length, 0, `${kind}: nothing runs before the window closes`);
    assert.deepEqual(clock.armed(), [REALTIME_NUDGE_COALESCE_MS], `${kind}: one window armed`);
    clock.fire();
    assert.ok(invalidated(qc, TODAY) && invalidated(qc, OPEN_TABS), `${kind}: every order list is stale`);
    assert.ok(invalidated(qc, TABLE_KEYS.all), `${kind}: tables are stale`);
    assert.ok(!invalidated(qc, ORDER_KEYS.summary()), `${kind}: the summary is never nudged (O15)`);
    assert.ok(!invalidated(qc, POS_PULSE_KEYS.all), `${kind}: the pulse is never nudged by an order change (O14)`);
    nudger.dispose();
  }
});

test("(b) five frames inside one window make ONE round (3 invalidate calls, not 15)", () => {
  const { calls, clock, nudger } = setup();
  for (let i = 0; i < 5; i++) nudger.onKind(i % 2 ? "kot-fired" : "order-changed");
  assert.equal(clock.armed().length, 1, "a burst arms one window");
  clock.fire();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => c.queryKey), [ORDER_KEYS.lists, TABLE_KEYS.all, ORDER_KEYS.infinite]);
  clock.fire();
  assert.equal(calls.length, 3, "no second round without a new frame");
  nudger.dispose();
});

test("(c) a frame while an order mutation is pending waits; it runs once the mutation settles plus one window", async () => {
  const { qc, calls, clock, nudger } = setup();
  seedLiveCaches(qc);
  const { done, release } = heldWrite(qc);
  assert.equal(qc.isMutating({ mutationKey: ORDER_KEYS.mutation }), 1, "precondition: an order write is in flight");
  nudger.onKind("order-changed");
  clock.fire();
  assert.equal(calls.length, 0, "held while the write is in flight");
  assert.equal(clock.armed().length, 0, "no timer spins while held");
  release();
  await done;
  assert.equal(calls.length, 0, "not at once when the write settles");
  assert.deepEqual(clock.armed(), [REALTIME_NUDGE_COALESCE_MS], "one fresh window after the write settles");
  clock.fire();
  assert.equal(calls.length, 3, "the held round runs");
  assert.ok(invalidated(qc, OPEN_TABS));
  await new MutationObserver(qc, { mutationKey: ORDER_KEYS.mutation, mutationFn: async () => undefined }).mutate();
  assert.equal(clock.armed().length, 0, "a later write with no new frame arms nothing");
  nudger.dispose();
});

test("(c2) two overlapping writes: the round waits for the LAST one, with no window armed in between", async () => {
  const { qc, calls, clock, nudger } = setup();
  const first = heldWrite(qc);
  const second = heldWrite(qc);
  nudger.onKind("kot-fired");
  clock.fire();
  first.release();
  await first.done;
  assert.equal(qc.isMutating({ mutationKey: ORDER_KEYS.mutation }), 1, "precondition: one write still in flight");
  assert.equal(clock.armed().length, 0, "still held: no window while a write is in flight");
  second.release();
  await second.done;
  clock.fire();
  assert.equal(calls.length, 3, "the round runs after the last write");
  nudger.dispose();
});

test("(d) a hidden tab only marks the lists stale — no refetch until it is visible again", async () => {
  const run = async (focused: boolean) => {
    const { qc, clock, nudger } = setup();
    let fetches = 0;
    const observer = new QueryObserver(qc, { queryKey: OPEN_TABS, queryFn: async () => (fetches++, []) });
    const unsubscribe = observer.subscribe(() => {});
    for (let i = 0; i < MAX_TICKS && qc.getQueryState(OPEN_TABS)?.status !== "success"; i++) await tick();
    const before = fetches;
    focusManager.setFocused(focused);
    try {
      nudger.onKind("order-changed");
      clock.fire();
      await tick();
      assert.ok(invalidated(qc, OPEN_TABS) || fetches > before, "the list was nudged");
      return fetches - before;
    } finally {
      focusManager.setFocused(undefined);
      nudger.dispose();
      unsubscribe();
    }
  };
  assert.equal(await run(false), 0, "hidden: stale only, the queryFn is not called");
  assert.equal(await run(true), 1, "visible: the active list refetches");
});

test("(e) an infinite list holding two pages is left alone; one holding a single page is nudged", () => {
  const { qc, clock, nudger } = setup();
  const one = ORDER_KEYS.infiniteList({});
  const two = ORDER_KEYS.infiniteList({ status: "Completed" });
  qc.setQueryData(one, { pages: [[]], pageParams: [undefined] });
  qc.setQueryData(two, { pages: [[], []], pageParams: [undefined, "c"] });
  nudger.onKind("kot-fired");
  clock.fire();
  assert.ok(invalidated(qc, one), "one page: nudged");
  assert.ok(!invalidated(qc, two), "two pages: a timer never re-fetches every loaded page");
  nudger.dispose();
});

test("(f) kot-ticked, self-order, print-job and unknown kinds do nothing to the live lists", () => {
  const { calls, clock, nudger } = setup();
  for (const kind of ["kot-ticked", "self-order", "print-job", "table-changed", ""]) nudger.onKind(kind);
  assert.equal(clock.armed().length, 0);
  clock.fire();
  assert.equal(calls.length, 0);
  nudger.dispose();
});

test("(g) after dispose() nothing flushes — not the armed window, not a later mutation settle", async () => {
  const { qc, calls, clock, nudger } = setup();
  nudger.onKind("order-changed");
  assert.ok(qc.getMutationCache().hasListeners(), "precondition: the hold listener is attached");
  nudger.dispose();
  assert.equal(clock.armed().length, 0, "dispose clears the armed window");
  assert.equal(qc.getMutationCache().hasListeners(), false, "dispose detaches the hold listener (a remount must not stack them)");
  clock.fire();
  const writer = new MutationObserver(qc, { mutationKey: ORDER_KEYS.mutation, mutationFn: async () => undefined });
  await writer.mutate();
  nudger.onKind("order-changed");
  clock.fire();
  assert.equal(calls.length, 0);
  assert.equal(clock.armed().length, 0);
  const idle = createRealtimeInvalidator(qc, LIVE_STATE_EVENT_KINDS, LIVE_STATE_REALTIME, clock.timers);
  idle.dispose();
  idle.onKind("kot-fired");
  assert.equal(clock.armed().length, 0, "a frame after dispose() arms nothing, even with no window open at dispose");
});

test("Kitchen, print host and pulse keep today's behaviour: one immediate invalidate of their own key, never held by an order write, never coalesced, never stale-only", async () => {
  const cases = [
    { kinds: KITCHEN_EVENT_KINDS, spec: KITCHEN_REALTIME, fire: "order-changed", key: KITCHEN_KEYS.all },
    { kinds: PRINT_EVENT_KINDS, spec: PRINT_REALTIME, fire: "print-job", key: PRINT_WAKE_KEYS.all },
    { kinds: PULSE_EVENT_KINDS, spec: PULSE_REALTIME, fire: "self-order", key: POS_PULSE_KEYS.all },
  ];
  for (const c of cases) {
    const { qc, calls, clock, nudger } = setup(c.kinds, c.spec);
    const { done, release } = heldWrite(qc);
    focusManager.setFocused(false);
    try {
      for (let i = 0; i < 3; i++) nudger.onKind(c.fire);
      assert.deepEqual(calls, [{ queryKey: c.key }, { queryKey: c.key }, { queryKey: c.key }], `${c.fire}: exactly the old call, once per frame`);
      assert.equal(clock.armed().length, 0, `${c.fire}: no window`);
    } finally {
      focusManager.setFocused(undefined);
      release();
      await done;
      nudger.dispose();
    }
  }
  const { qc, calls } = spiedClient();
  const pulse = createRealtimeInvalidator(qc, PULSE_EVENT_KINDS, PULSE_REALTIME);
  pulse.onKind("order-changed");
  pulse.onKind("kot-fired");
  assert.equal(calls.length, 0, "an order nudge never refetches the pulse, so it never triggers a print-host beat write (O14)");
  pulse.dispose();
});

// ── Mount / reachability pins ───────────────────────────────────────────────

const USE_REALTIME = "apps/cafe/hooks/use-realtime.ts";
const PROVIDER = "apps/cafe/components/layout/PosPulseProvider.tsx";
const LAYOUT = "apps/cafe/app/(dashboard)/layout.tsx";
const DASHBOARD = "apps/cafe/app/(dashboard)/page.tsx";
const ORDERS_PAGE = "apps/cafe/app/(dashboard)/orders/page.tsx";
const count = (src: string, needle: RegExp) => (src.match(new RegExp(needle.source, "g")) ?? []).length;

test("PIN: PosPulseProvider calls useLiveStateRealtime() and usePosPulseRealtime() exactly once each, inside the provider, and the layout mounts the provider once", () => {
  const src = stripComments(readSrc(PROVIDER));
  assert.match(src, /import \{ useLiveStateRealtime, usePosPulseRealtime \} from "@\/hooks\/use-realtime";/);
  const body = src.slice(src.indexOf("export function PosPulseProvider("));
  assert.ok(body.includes("const { data } = usePosPulse();"), "positive landmark: the provider body");
  assert.equal(count(body, /\buseLiveStateRealtime\(\);/), 1);
  assert.equal(count(body, /\busePosPulseRealtime\(\);/), 1);
  const layout = stripComments(readSrc(LAYOUT));
  assert.equal(count(layout, /<PosPulseProvider>/), 1, "the provider (and so the nudger) is mounted once per tab");
});

test("PIN: the hooks wire the factory — subscribe, then unsubscribe AND dispose on cleanup; each surface passes its own kinds + spec", () => {
  const src = stripComments(readSrc(USE_REALTIME));
  assert.match(src, /const invalidator = createRealtimeInvalidator\(qc, kinds, spec\);/);
  assert.match(src, /const unsubscribe = subscribeRealtime\(invalidator\.onKind\);/);
  assert.match(src, /return \(\) => \{\s*unsubscribe\(\);\s*invalidator\.dispose\(\);\s*\};/);
  assert.match(src, /useRealtimeInvalidate\(KITCHEN_EVENT_KINDS, KITCHEN_REALTIME\);/);
  assert.match(src, /useRealtimeInvalidate\(PRINT_EVENT_KINDS, PRINT_REALTIME\);/);
  assert.match(src, /useRealtimeInvalidate\(PULSE_EVENT_KINDS, PULSE_REALTIME\);/);
  assert.match(src, /useRealtimeInvalidate\(LIVE_STATE_EVENT_KINDS, LIVE_STATE_REALTIME\);/);
  const spec = src.slice(src.indexOf("export const LIVE_STATE_REALTIME"), src.indexOf("export function useKitchenRealtime"));
  assert.ok(spec.includes("ORDER_KEYS.lists"), "positive landmark: the live-state spec block");
  assert.ok(!/summary|POS_PULSE_KEYS/.test(spec), "the live-state spec never names the summary or the pulse");
});

test("PIN: Dashboard + Orders pages use the shared live beat and follow the live row in the detail sheet", () => {
  const dash = stripComments(readSrc(DASHBOARD));
  assert.match(dash, /useOrders\(\s*\{ date: today \},\s*\{ refetchInterval: REFETCH_INTERVALS\.LIVE_LISTS \},?\s*\)/);
  assert.match(dash, /useOrders\(\s*\{ payment: "Unpaid", status: "Pending" \},\s*OPEN_TABS_QUERY_OPTIONS,?\s*\)/);
  assert.ok(dash.includes("useOrderSummary()"), "positive landmark: the dashboard page");
  assert.ok(!dash.includes("LIVE_REFRESH_MS"), "the page-local poll constant is gone");
  assert.match(dash, /order=\{liveOrderOf\(detail, floorOrders\)\}/);
  const orders = stripComments(readSrc(ORDERS_PAGE));
  assert.match(orders, /order=\{liveOrderOf\(detail, list\)\}/);
});
