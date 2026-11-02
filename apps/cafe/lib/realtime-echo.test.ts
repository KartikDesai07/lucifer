// Final review I2 (perf P1; the owner's D3, 2026-11-02) — the echo-of-own-write guard. isRealtimeHealthy() proves the
// socket (it pongs), not the server's publish to the room: with the publish path broken every device would sit at the
// relaxed 120 s with no nudges. lib/live-poll.ts realtimeTrusted() also asks that this device's own order / Kitchen
// write was echoed by a live nudge within REALTIME_ECHO_MS. First the pure guard on a hand clock, then realtimeTrusted /
// livePoll over a fake proven socket (mocked Date), then the wiring (hooks/use-realtime.ts watchRealtimeEcho) with a
// real QueryClient's mutations and frames from the socket. The client is a module singleton: each case unsubscribes.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MutationObserver, QueryClient } from "@tanstack/react-query";

import { stripComments } from "@/lib/source-pin-utils";
import { REFETCH_INTERVALS } from "@/lib/query";
import { subscribeRealtime } from "@/lib/realtime-client";
import {
  REALTIME_ECHO_MS, REALTIME_RELAXED_POLL_MS, createEchoGuard, livePoll, liveStaleMs, noteLiveNudge, noteOwnWriteSettled,
  noteOwnWriteStarted, realtimeTrusted,
} from "@/lib/live-poll";
import { KITCHEN_STALE_MS } from "@/lib/kitchen-board";
import { REALTIME_ECHO_KINDS, watchRealtimeEcho } from "@/hooks/use-realtime";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { KITCHEN_KEYS } from "@/hooks/use-kitchen";

/** A real-looking clock start (a mocked Date starts at 0 by default). */
const T0 = 1_800_000_000_000;
const LISTS = REFETCH_INTERVALS.LIVE_LISTS;

test("I2 (D3): an own write's echo is due within 8 s, and every live-state, Kitchen and dashboard kind counts as one", () => {
  assert.equal(REALTIME_ECHO_MS, 8000, "I2: the echo window");
  assert.deepEqual(
    [...REALTIME_ECHO_KINDS].sort(),
    ["kot-fired", "kot-ticked", "order-changed", "self-order"],
    "I2: LIVE_STATE + KITCHEN + DASHBOARD kinds, each once; never print-job (not a live surface's nudge)",
  );
});

test("I2: the pure guard — a nudge after the start (even before the answer) is the echo; none within 8 s of an OK answer is missed until the next nudge", () => {
  const g = createEchoGuard();
  g.started();
  g.nudge(); // the server publishes before it answers
  g.settled(true, T0);
  assert.equal(g.missed(T0 + 60_000), false, "I2: nudge-before-response counts as the echo");
  g.started();
  g.settled(true, T0);
  assert.equal(g.missed(T0 + REALTIME_ECHO_MS - 1), false, "I2: the echo still has time");
  assert.equal(g.missed(T0 + REALTIME_ECHO_MS), true, "I2: 8 s with no nudge — the publish path is unproven");
  assert.equal(g.missed(T0 + 3_600_000), true, "I2: and stays unproven while no nudge comes");
  g.nudge();
  assert.equal(g.missed(T0 + 3_600_000), false, "I2: the next nudge proves the path again");
});

test("I2: the pure guard — a failed write owes nothing; a nudge before the start is not its echo; one nudge pays every owed echo", () => {
  const g = createEchoGuard();
  g.started();
  g.settled(false, T0);
  assert.equal(g.missed(T0 + 60_000), false, "I2: a failed write expects no echo");
  g.settled(true, T0);
  assert.equal(g.missed(T0 + 60_000), false, "a settle with no tracked start expects nothing");
  g.nudge();
  g.started();
  g.settled(true, T0);
  assert.equal(g.missed(T0 + REALTIME_ECHO_MS), true, "I2: a nudge from before the write started is not its echo");
  g.started();
  g.started();
  g.nudge();
  g.settled(true, T0 + 1);
  g.settled(true, T0 + 2);
  assert.equal(g.missed(T0 + 60_000), false, "one nudge after both started echoes both, and pays the earlier owed echo");
});

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | undefined;
  readyState = FakeWebSocket.CONNECTING;
  private readonly listeners: Record<string, Array<(arg?: unknown) => void>> = {};
  constructor(readonly url: string) {
    FakeWebSocket.last = this;
  }
  addEventListener(type: string, fn: (arg?: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  send(): void {}
  close(): void {
    if (this.readyState >= FakeWebSocket.CLOSING) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.fire("close");
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.fire("open");
  }
  /** A room frame of `kind`, as the Worker fans it out. */
  frame(kind: string): void {
    this.fire("message", { data: JSON.stringify({ kind }) });
  }
  private fire(type: string, arg?: unknown): void {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(arg);
  }
}

/** Realtime on, the fake socket open (proven up), Date mocked at T0, nothing owed from an earlier case. */
async function withProvenRoom(body: (ws: FakeWebSocket) => void | Promise<void>): Promise<void> {
  const savedWs = (globalThis as { WebSocket?: unknown }).WebSocket;
  const savedUrl = process.env.NEXT_PUBLIC_REALTIME_URL;
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  process.env.NEXT_PUBLIC_REALTIME_URL = "wss://realtime.example.com/join";
  mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: T0 });
  FakeWebSocket.last = undefined;
  const unsub = subscribeRealtime(() => {});
  try {
    const ws = FakeWebSocket.last as FakeWebSocket | undefined;
    assert.ok(ws, "precondition: subscribing opened the one socket");
    ws.open();
    noteLiveNudge();
    assert.equal(realtimeTrusted(), true, "precondition: proven up, nothing owed");
    await body(ws);
  } finally {
    unsub();
    mock.timers.reset();
    (globalThis as { WebSocket: unknown }).WebSocket = savedWs;
    if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_REALTIME_URL;
    else process.env.NEXT_PUBLIC_REALTIME_URL = savedUrl;
  }
}

test("I2 (D3): the socket proven up, an own OK write with no nudge for 8 s puts the polls back on today's interval — until the next nudge", async () => {
  await withProvenRoom((ws) => {
    const poll = livePoll(LISTS);
    assert.equal(poll(), REALTIME_RELAXED_POLL_MS, "precondition: 120 s while trusted");
    noteOwnWriteStarted();
    noteOwnWriteSettled(true);
    mock.timers.tick(REALTIME_ECHO_MS - 1);
    assert.equal(poll(), REALTIME_RELAXED_POLL_MS, "I2: the echo still has time — 120 s");
    mock.timers.tick(1);
    assert.equal(realtimeTrusted(), false, "I2: 8 s, no echo — the socket pongs but the publish path is unproven");
    assert.equal(poll(), LISTS, "I2 (D3): the livePoll path answers today's 30 s");
    assert.equal(liveStaleMs(KITCHEN_STALE_MS, realtimeTrusted()), KITCHEN_STALE_MS, "I2: and a board reads Stale at today's 60 s");
    noteLiveNudge();
    assert.equal(poll(), REALTIME_RELAXED_POLL_MS, "I2: the next nudge proves the path — 120 s again");
    ws.close();
    assert.equal(realtimeTrusted(), false, "the socket down: never trusted, echo or not");
  });
});

test("I2: not proven up (realtime off) is never trusted, with nothing owed", () => {
  assert.equal(process.env.NEXT_PUBLIC_REALTIME_URL, undefined, "precondition: realtime off");
  noteLiveNudge();
  assert.equal(realtimeTrusted(), false, "I2: healthy=false is always untrusted");
  assert.equal(livePoll(LISTS)(), LISTS, "today's 30 s");
});

const write = (
  qc: QueryClient,
  mutationKey: readonly unknown[],
  mutationFn: () => Promise<void>,
  onMutate?: () => unknown,
): Promise<unknown> => new MutationObserver(qc, { mutationKey, mutationFn, onMutate }).mutate().catch(() => undefined);

test("I2 wiring: an order write echoed before its answer stays trusted; one never echoed is untrusted after 8 s until a Kitchen nudge", async () => {
  await withProvenRoom(async (ws) => {
    const qc = new QueryClient();
    const stop = watchRealtimeEcho(qc);
    try {
      let answer: () => void = () => {};
      const answered = new Promise<void>((resolve) => (answer = resolve)); // TanStack calls the fn a few ticks later
      const first = write(qc, ORDER_KEYS.mutation, () => answered);
      ws.frame("order-changed"); // the room's echo beats the HTTP answer
      answer();
      await first;
      mock.timers.tick(REALTIME_ECHO_MS);
      assert.equal(realtimeTrusted(), true, "I2: nudge-before-response is the echo");
      await write(qc, ORDER_KEYS.mutation, async () => {});
      mock.timers.tick(REALTIME_ECHO_MS);
      assert.equal(realtimeTrusted(), false, "I2: an OK order write the room never echoed — today's polls");
      ws.frame("print-job");
      assert.equal(realtimeTrusted(), false, "a print-job frame is not a live nudge");
      ws.frame("kot-ticked");
      assert.equal(realtimeTrusted(), true, "I2: the next live nudge proves the path again");
      await write(qc, ORDER_KEYS.mutation, async () => {}, () => ({ snapshot: [] })); // optimistic: `pending` twice
      ws.frame("order-changed");
      await write(qc, ORDER_KEYS.mutation, async () => {});
      mock.timers.tick(REALTIME_ECHO_MS);
      assert.equal(realtimeTrusted(), false, "an optimistic write is ONE start, so the next unechoed write still pairs with its own");
    } finally {
      stop();
    }
  });
});

test("I2 wiring: a failed Kitchen tick and an unwatched write owe nothing, a Kitchen Ready is watched, and the teardown stops both feeds", async () => {
  await withProvenRoom(async (ws) => {
    const qc = new QueryClient();
    const stop = watchRealtimeEcho(qc);
    try {
      await write(qc, KITCHEN_KEYS.mutation, async () => {
        throw new Error("409");
      });
      await write(qc, ["settings"], async () => {});
      mock.timers.tick(REALTIME_ECHO_MS);
      assert.equal(realtimeTrusted(), true, "I2: a failed tick and a write outside the watched keys expect no echo");
      await write(qc, KITCHEN_KEYS.ready, async () => {});
      mock.timers.tick(REALTIME_ECHO_MS);
      assert.equal(realtimeTrusted(), false, "I2: a Kitchen Ready is a watched write too");
      void write(qc, ORDER_KEYS.mutation, () => new Promise<void>(() => {})); // never answers
    } finally {
      stop();
    }
    ws.frame("order-changed");
    assert.equal(realtimeTrusted(), false, "after the teardown a frame is no longer noted");
    noteLiveNudge();
    await write(qc, ORDER_KEYS.mutation, async () => {});
    mock.timers.tick(REALTIME_ECHO_MS);
    assert.equal(realtimeTrusted(), true, "after the teardown a write is no longer watched");
    noteOwnWriteStarted();
    noteOwnWriteSettled(true);
    mock.timers.tick(REALTIME_ECHO_MS);
    assert.equal(realtimeTrusted(), false, "the teardown dropped the hung write's start: this write pairs with its own start");
  });
});

test("PIN (I2): useRealtimeCatchUp mounts watchRealtimeEcho in its own effect, and watchRealtimeEcho unsubscribes both feeds", () => {
  const src = stripComments(readFileSync(fileURLToPath(new URL("../hooks/use-realtime.ts", import.meta.url)), "utf8"));
  const hook = src.slice(src.indexOf("export function useRealtimeCatchUp(): void {"));
  assert.ok(hook.startsWith("export function useRealtimeCatchUp"), "positive landmark: the catch-up hook");
  assert.match(hook, /useEffect\(\(\) => watchRealtimeEcho\(qc\), \[qc\]\);/, "I2: one watch per tab, next to the catch-up, torn down on unmount");
  const watch = src.slice(src.indexOf("export function watchRealtimeEcho("), src.indexOf("export function useRealtimeCatchUp"));
  assert.match(watch, /const stopWrites = qc\.getMutationCache\(\)\.subscribe\(/, "I2: this device's writes, from the MutationCache");
  assert.match(watch, /const stopNudges = subscribeRealtime\(/, "I2: the room's nudges, from the one socket");
  assert.match(watch, /stopWrites\(\);\s*stopNudges\(\);/, "I2: the teardown unsubscribes both");
});
