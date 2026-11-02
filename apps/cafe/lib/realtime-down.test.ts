// Perf P1 Task 3 (F6; the owner's D3, 2026-11-02) — the room's DOWN event and the one catch-up round it drives.
//
// lib/realtime-client.ts fires subscribeRealtimeDown's listeners from dropAndReconnect() only when the socket being
// torn down had proof of life (lastSeenAt > 0 before the reset): once per healthy→down transition, never again for a
// reconnect attempt that never opened. hooks/use-realtime.ts feeds that event into a coalesced invalidator as the
// synthetic kind "lane-down" (CATCH_UP_REALTIME): the live queries refetch once, and their polls — 120 s while the
// room was up — read isRealtimeHealthy() again (false now) and fall back to today's 30 s / 10 s.
//
// The fake WebSocket is the minimal shape realtime-client.ts touches (the realtime-paths.test.ts idiom). The client is
// a module singleton: every case unsubscribes its last listener in a `finally`, which resets the socket state.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";

import { stripComments } from "@/lib/source-pin-utils";
import { REFETCH_INTERVALS } from "@/lib/query";
import { CAFE_EVENT_KINDS } from "@/lib/realtime-publish";
import {
  REALTIME_PING_INTERVAL_MS, REALTIME_PONG_TIMEOUT_MS, isRealtimeHealthy, subscribeRealtime, subscribeRealtimeDown,
} from "@/lib/realtime-client";
import { createRealtimeInvalidator, type NudgeTimers } from "@/lib/realtime-invalidate";
import { livePoll } from "@/lib/live-poll";
import { markTablesFreshRead, takeTablesFreshRead } from "@/lib/tables-fresh-read";
import { CATCH_UP_REALTIME, REALTIME_DOWN_KIND, REALTIME_NUDGE_COALESCE_MS } from "@/hooks/use-realtime";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { KITCHEN_KEYS } from "@/hooks/use-kitchen";
import { DASHBOARD_KEYS } from "@/hooks/use-dashboard";
import { TOKEN_KEYS } from "@/hooks/use-tokens";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { PRINT_WAKE_KEYS } from "@/hooks/use-print-host-wake";

const URL_ON = "wss://realtime.example.com/join";
/** A real-looking clock start: proof of life is a Date.now() stamp, and a mocked Date starts at 0 by default. */
const CLOCK_START = 1_800_000_000_000;
/** Longer than any reconnect backoff step (the client caps it at 60 s). */
const PAST_ANY_BACKOFF_MS = 61_000;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  /** A browser's close(): CLOSING now, the close event later (finishClose) — a half-open link's handshake can take long. */
  deferClose = false;
  sent = 0;
  private readonly listeners: Record<string, Array<(arg?: unknown) => void>> = {};
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (arg?: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  send(): void { this.sent++; }
  close(): void {
    if (this.readyState >= FakeWebSocket.CLOSING) return;
    if (this.deferClose) this.readyState = FakeWebSocket.CLOSING;
    else this.finishClose();
  }
  finishClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.fire("close");
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.fire("open");
  }
  fire(type: string, arg?: unknown): void {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(arg);
  }
}

async function withFakeSocket(body: () => void | Promise<void>): Promise<void> {
  const savedWs = (globalThis as { WebSocket?: unknown }).WebSocket;
  const savedUrl = process.env.NEXT_PUBLIC_REALTIME_URL;
  FakeWebSocket.instances = [];
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  process.env.NEXT_PUBLIC_REALTIME_URL = URL_ON;
  try {
    await body();
  } finally {
    (globalThis as { WebSocket: unknown }).WebSocket = savedWs;
    if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_REALTIME_URL;
    else process.env.NEXT_PUBLIC_REALTIME_URL = savedUrl;
  }
}

const socketAt = (i: number): FakeWebSocket => {
  const ws = FakeWebSocket.instances[i];
  assert.ok(ws, `precondition: socket #${i} was constructed`);
  return ws;
};

test("F6: the down event fires once per healthy→down transition — a missed pong once, failed reconnects never, an open-then-close once more", async () => {
  await withFakeSocket(() => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: CLOCK_START });
    let downs = 0;
    const stopDown = subscribeRealtimeDown(() => downs++);
    const stopBroken = subscribeRealtimeDown(() => {
      throw new Error("a broken down listener");
    });
    const unsub = subscribeRealtime(() => {});
    try {
      socketAt(0).open();
      assert.equal(isRealtimeHealthy(), true, "precondition: the room is proven up");
      assert.equal(downs, 0, "an open room is not down");
      mock.timers.tick(REALTIME_PING_INTERVAL_MS);
      mock.timers.tick(REALTIME_PONG_TIMEOUT_MS + 1);
      assert.equal(isRealtimeHealthy(), false, "precondition: the missed pong tore the socket down");
      assert.equal(downs, 1, "a missed pong on a proven socket: one down event (a throwing listener starves no one)");
      for (const i of [1, 2]) {
        mock.timers.tick(PAST_ANY_BACKOFF_MS);
        socketAt(i).close();
        assert.equal(downs, 1, `reconnect #${i} closed before it ever opened: still one down event`);
      }
      mock.timers.tick(PAST_ANY_BACKOFF_MS);
      socketAt(3).open();
      assert.equal(downs, 1, "the room is back: no event for coming up");
      socketAt(3).close();
      assert.equal(downs, 2, "proven up again, then closed: the second down event");
    } finally {
      unsub();
      stopBroken();
      stopDown();
      mock.timers.reset();
    }
  });
});

test("F6 (fix C2): a superseded socket's late error / close never tears down the newer proven socket, and fires no second down event", async () => {
  await withFakeSocket(() => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: CLOCK_START });
    let downs = 0;
    const stopDown = subscribeRealtimeDown(() => downs++);
    const unsub = subscribeRealtime(() => {});
    try {
      const a = socketAt(0);
      a.deferClose = true;
      a.open();
      mock.timers.tick(REALTIME_PING_INTERVAL_MS);
      mock.timers.tick(REALTIME_PONG_TIMEOUT_MS + 1);
      assert.equal(a.readyState, FakeWebSocket.CLOSING, "precondition: A's close handshake is still pending");
      assert.equal(downs, 1, "precondition: the missed pong is the one down event");
      mock.timers.tick(PAST_ANY_BACKOFF_MS);
      const b = socketAt(1);
      b.open();
      assert.equal(isRealtimeHealthy(), true, "precondition: B is current and proven up");
      a.fire("error");
      a.finishClose();
      assert.equal(b.readyState, FakeWebSocket.OPEN, "A's late error / close leaves B open");
      assert.equal(isRealtimeHealthy(), true, "and the room still reads proven up");
      assert.equal(downs, 1, "no second down event, so no extra catch-up round");
      mock.timers.tick(PAST_ANY_BACKOFF_MS);
      assert.equal(FakeWebSocket.instances.length, 2, "no reconnect was scheduled over B");
    } finally {
      unsub();
      stopDown();
      mock.timers.reset();
    }
  });
});

test("F6 (fix M3): a superseded socket's late open / message never touches the current socket's pings, proof or pong deadline", async () => {
  await withFakeSocket(() => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: CLOCK_START });
    const kinds: string[] = [];
    const first = subscribeRealtime(() => {});
    const a = Object.assign(socketAt(0), { deferClose: true });
    a.open();
    first(); // last one out: A is torn down, its close handshake still pending
    const unsub = subscribeRealtime((kind) => kinds.push(kind));
    try {
      const b = socketAt(1);
      b.open();
      a.fire("open");
      mock.timers.tick(REALTIME_PING_INTERVAL_MS);
      assert.deepEqual([a.sent, b.sent], [0, 1], "M3: A's late open leaves B's ping cycle alone (B pinged, A got no ping)");
      a.fire("message", { data: JSON.stringify({ kind: "order-changed" }) });
      mock.timers.tick(REALTIME_PONG_TIMEOUT_MS + 1);
      assert.equal(isRealtimeHealthy(), false, "M3: A's frame neither refreshed B's proof nor cleared B's pong deadline: B's missed pong tore it down");
      assert.deepEqual(kinds, [], "M3: A's frame is not fanned out (a browser never delivers one after close() anyway)");
    } finally {
      unsub();
      mock.timers.reset();
    }
  });
});

test("F6: an unsubscribed down listener is never called, and a down subscription alone opens no socket", async () => {
  await withFakeSocket(() => {
    let downs = 0;
    const stopDown = subscribeRealtimeDown(() => downs++);
    assert.equal(FakeWebSocket.instances.length, 0, "listening for downs never opens the room");
    stopDown();
    const unsub = subscribeRealtime(() => {});
    try {
      socketAt(0).open();
      socketAt(0).close();
      assert.equal(downs, 0, "unsubscribed: not called");
    } finally {
      unsub();
    }
  });
});

test("D3: livePoll re-reads the room's health on EVERY call — 120 s while proven up, today's interval the moment it is not", async () => {
  await withFakeSocket(() => {
    const poll = livePoll(REFETCH_INTERVALS.LIVE_LISTS);
    const unsub = subscribeRealtime(() => {});
    try {
      assert.equal(poll(), REFETCH_INTERVALS.LIVE_LISTS, "connecting (not proven up): today's 30 s");
      socketAt(0).open();
      assert.equal(poll(), 120_000, "proven up: 120 s");
      socketAt(0).close();
      assert.equal(poll(), REFETCH_INTERVALS.LIVE_LISTS, "dropped: today's 30 s on the very next tick, never a cached answer");
    } finally {
      unsub();
    }
  });
});

/** A hand clock for the invalidator's window (the socket's own timers stay real here). */
function handClock() {
  const armed = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
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

// Fix M1: today's day summary polls through livePoll too, so it joins the catch-up (its refetch re-arms its poll at
// today's 30 s at once, D3); a past day's summary never polls and is left alone.
test("F6 catch-up: a drop runs ONE coalesced round over the live queries (lists, floor, one-page Orders list, kitchen, dashboard, tokens, today's summary) — never a past day, the pulse or the print host", async () => {
  await withFakeSocket(() => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const onePage = ORDER_KEYS.infiniteList({});
    const twoPages = ORDER_KEYS.infiniteList({ status: "Completed" });
    const caught = [ORDER_KEYS.list({ payment: "Unpaid", status: "Pending" }), TABLE_KEYS.all, onePage, KITCHEN_KEYS.all, DASHBOARD_KEYS.live, DASHBOARD_KEYS.range({ from: "2026-11-02", to: "2026-11-02" }), TOKEN_KEYS.all, ORDER_KEYS.summary()];
    const untouched = [ORDER_KEYS.summary("2026-10-01"), POS_PULSE_KEYS.all, PRINT_WAKE_KEYS.all, twoPages];
    for (const key of [...caught, ...untouched]) qc.setQueryData(key, []);
    qc.setQueryData<InfiniteData<unknown[]>>(onePage, { pages: [[]], pageParams: [undefined] });
    qc.setQueryData<InfiniteData<unknown[]>>(twoPages, { pages: [[], []], pageParams: [undefined, "c"] });
    const clock = handClock();
    const invalidator = createRealtimeInvalidator(qc, [REALTIME_DOWN_KIND], CATCH_UP_REALTIME, clock.timers);
    const stopDown = subscribeRealtimeDown(() => invalidator.onKind(REALTIME_DOWN_KIND));
    const unsub = subscribeRealtime(() => {});
    const stale = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated === true;
    try {
      takeTablesFreshRead();
      socketAt(0).open();
      socketAt(0).close();
      assert.deepEqual(clock.armed(), [REALTIME_NUDGE_COALESCE_MS], "the drop arms one window (coalesced like a nudge)");
      assert.ok(caught.every((key) => !stale(key)), "nothing runs before the window closes");
      clock.fire();
      for (const key of caught) assert.ok(stale(key), `caught up: ${JSON.stringify(key)}`);
      for (const key of untouched) assert.ok(!stale(key), `left alone: ${JSON.stringify(key)}`);
      assert.equal(takeTablesFreshRead(), true, "the catch-up's floor read skips the 5 s instance cache (onRound, F7)");
      clock.fire();
      assert.deepEqual(clock.armed(), [], "one round per drop, nothing re-armed");
    } finally {
      unsub();
      stopDown();
      invalidator.dispose();
    }
  });
});

test("PIN (F6): CATCH_UP_REALTIME is coalesced, held by an order write, stale-only on a hidden tab, and marks the fresh floor read", () => {
  assert.equal(CATCH_UP_REALTIME.coalesceMs, REALTIME_NUDGE_COALESCE_MS, "coalesced: a burst is one round");
  assert.deepEqual(CATCH_UP_REALTIME.holdWhileMutating, ORDER_KEYS.mutation, "never clobbers an optimistic order write");
  assert.equal(CATCH_UP_REALTIME.staleOnlyWhenHidden, true, "a hidden tab only marks stale; showing it runs the round");
  assert.equal(CATCH_UP_REALTIME.onRound, markTablesFreshRead, "the catch-up reads the floor fresh");
  assert.equal(CATCH_UP_REALTIME.lateRefetch, undefined, "no late refetch");
  assert.ok(CATCH_UP_REALTIME.targets.some((t) => JSON.stringify(t.queryKey) === JSON.stringify(ORDER_KEYS.summary())), "fix M1 (D3): today's summary is a catch-up target");
  assert.ok(!(CAFE_EVENT_KINDS as readonly string[]).includes(REALTIME_DOWN_KIND), "lane-down is synthetic, never a room kind");
});

test("PIN (F6): useRealtimeCatchUp feeds the down event into ONE invalidator as lane-down and tears both down on cleanup", () => {
  const src = stripComments(readFileSync(fileURLToPath(new URL("../hooks/use-realtime.ts", import.meta.url)), "utf8"));
  assert.match(src, /export const REALTIME_DOWN_KIND = "lane-down";/, "the synthetic kind");
  const at = src.indexOf("export function useRealtimeCatchUp(): void {");
  assert.ok(at >= 0, "positive landmark: the catch-up hook");
  const hook = src.slice(at);
  assert.ok(hook.includes("useEffect("), "positive landmark: the hook's one effect");
  assert.match(hook, /const invalidator = createRealtimeInvalidator\(qc, \[REALTIME_DOWN_KIND\], CATCH_UP_REALTIME\);/);
  assert.match(hook, /const unsubscribe = subscribeRealtimeDown\(\(\) => invalidator\.onKind\(REALTIME_DOWN_KIND\)\);/);
  assert.match(hook, /return \(\) => \{\s*unsubscribe\(\);\s*invalidator\.dispose\(\);\s*\};/, "cleanup: unsubscribe AND dispose");
});
