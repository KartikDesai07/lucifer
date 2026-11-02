import { isRealtimeHealthy } from "@/lib/realtime-client";

// ─────────────────────────────────────────────────────────────────────────────
// Perf P1 F6 (the owner's D3, 2026-11-02) — the safety-net polls step back while
// the realtime room is PROVEN up.
//
// The live lists, the tables, the dashboard, the day summary, the Kitchen board
// and the token board poll so a device converges even when nothing nudges it.
// While the room is proven healthy every write already reaches every visible
// device in ~1 s through a nudge, so those polls only cover a lost frame: they
// step back to 120 s. The moment the room is not proven up (flag off, Worker
// down, mid-reconnect, a missed pong, a missed echo of this device's own write)
// they are exactly today's 30 s / 10 s.
//
// The print host's idiom (hooks/use-print-host-wake.ts): `livePoll(n)` is a
// refetchInterval FUNCTION, so realtimeTrusted() is re-read, never a cached
// boolean, and it fails closed. TanStack re-reads it whenever it re-arms the
// interval: each fetch's query update and each render of the hook — never
// from the running timer. So the two changes that come with no query update,
// a drop of the socket and an overdue echo (below), each run ONE catch-up
// round (hooks/use-realtime.ts useRealtimeCatchUp, spaced by
// lib/realtime-catch-up.ts), whose refetch re-arms every poll at today's
// rate at once (perf P1 deep review I-2). The pulse
// (REFETCH_INTERVALS.POS_PULSE) is not a safety net — it feeds printing and
// alerts — and never goes through here; the print host keeps its own socket
// proof (isRealtimeHealthy).
// ─────────────────────────────────────────────────────────────────────────────

/** D3: a safety-net poll's cadence while the room is proven up. */
export const REALTIME_RELAXED_POLL_MS = 120_000;

/** The cadence for one tick: room proven up → at least 120 s; otherwise today's `normalMs`, unchanged. */
export function livePollMs(normalMs: number, healthy: boolean): number {
  return healthy ? Math.max(normalMs, REALTIME_RELAXED_POLL_MS) : normalMs;
}

/** A refetchInterval function over today's interval; reads realtimeTrusted() on every call. */
export function livePoll(normalMs: number): () => number {
  return () => livePollMs(normalMs, realtimeTrusted());
}

/** How old a polled board's answer may be before it reads "Stale" (perf P1 fix I1): while the room is proven up the
 *  board polls every 120 s, so one relaxed poll later than today's `baseMs`; otherwise `baseMs`, unchanged. The caller
 *  reads realtimeTrusted() at render (the Now Serving chip, the Kitchen page's strip). */
export function liveStaleMs(baseMs: number, healthy: boolean): number {
  return healthy ? REALTIME_RELAXED_POLL_MS + baseMs : baseMs;
}

// ── The echo of this device's own write (final review I2; the owner's D3) ────────────────────────────────────────────
//
// isRealtimeHealthy() proves the SOCKET (it pongs), not the server's publish to the room. With the publish path
// broken (a rotated secret, the Worker refusing publishes) every socket still pongs, every poll above would sit at
// 120 s and no nudge would ever come. This device's own writes prove the path: the server publishes a nudge for every
// order or Kitchen write it accepts, before it answers (lib/realtime-publish.ts publishCafeEvent), and the room fans
// it out to every socket, this device's too. So:
//   - a nudge seen at any time after a write STARTED is its echo (it can beat the HTTP answer);
//   - a write that settles OK with no nudge since it started owes one within REALTIME_ECHO_MS;
//   - past that deadline with none, the room is UNPROVEN (today's polls) until the next nudge arrives, and the
//     deadline itself runs one catch-up round (deep review I-2: the timer is armed at echoDueAt());
//   - a failed write owes nothing.
// A device that never writes (a wall display) relies on the socket proof alone. Fed by hooks/use-realtime.ts
// (watchRealtimeEcho, mounted in useRealtimeCatchUp).

/** I2: how long after this device's own write settles OK the room has to echo it. */
export const REALTIME_ECHO_MS = 8000;

export interface EchoGuard {
  /** A live nudge arrived (a live-state, Kitchen or dashboard kind). */
  nudge(): void;
  /** One of this device's order / Kitchen writes started. */
  started(): void;
  /** A started write settled. Writes carry no id here: the oldest in-flight start is paired with it. */
  settled(ok: boolean, nowMs: number): void;
  /** True while an echo is overdue: an OK write saw no nudge since it started and REALTIME_ECHO_MS has passed. */
  missed(nowMs: number): boolean;
  /** The earliest owed echo's deadline (Unix ms), or null when nothing is owed. */
  dueAt(): number | null;
}

/** The guard's pure state (one per device below; the tests make their own). */
export function createEchoGuard(): EchoGuard {
  let nudges = 0; // live nudges seen so far
  const starts: number[] = []; // `nudges` when each in-flight write started, oldest first
  let dueBy: number | null = null; // the earliest owed echo's deadline; any nudge pays every one
  return {
    nudge() {
      nudges++;
      dueBy = null;
    },
    started() {
      starts.push(nudges);
    },
    settled(ok, nowMs) {
      const at = starts.shift();
      if (at === undefined || !ok || nudges > at) return; // unknown, failed, or already echoed
      dueBy ??= nowMs + REALTIME_ECHO_MS;
    },
    missed(nowMs) {
      return dueBy !== null && nowMs >= dueBy;
    },
    dueAt() {
      return dueBy;
    },
  };
}

const echo = createEchoGuard();

/** I2: a live nudge reached this device. */
export function noteLiveNudge(): void {
  echo.nudge();
}

/** I2: one of this device's order / Kitchen writes started. */
export function noteOwnWriteStarted(): void {
  echo.started();
}

/** I2: that write settled; an OK one owes an echo unless a nudge came since it started. */
export function noteOwnWriteSettled(ok: boolean, nowMs: number = Date.now()): void {
  echo.settled(ok, nowMs);
}

/** Deep review I-2: when the earliest owed echo falls due (null: nothing owed) — watchRealtimeEcho arms its timer here. */
export function echoDueAt(): number | null {
  return echo.dueAt();
}

/** Deep review I-2: is an echo of this device's own write overdue right now? */
export function echoMissed(nowMs: number = Date.now()): boolean {
  return echo.missed(nowMs);
}

/** May the safety-net polls step back? The socket is proven up AND no echo of this device's own write is overdue
 *  (I2). Fails closed: re-read it per tick, never cache it. */
export function realtimeTrusted(nowMs: number = Date.now()): boolean {
  return isRealtimeHealthy() && !echo.missed(nowMs);
}
