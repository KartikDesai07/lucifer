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
// down, mid-reconnect, a missed pong) they are exactly today's 30 s / 10 s, and
// the drop itself runs one catch-up round (hooks/use-realtime.ts
// useRealtimeCatchUp) — whose refetch also re-arms every interval at today's
// rate (TanStack re-reads refetchInterval on every query update).
//
// The print host's idiom (hooks/use-print-host-wake.ts): `livePoll(n)` is a
// refetchInterval FUNCTION, so isRealtimeHealthy() is re-read on every tick,
// never a cached boolean, and it fails closed. The pulse
// (REFETCH_INTERVALS.POS_PULSE) is not a safety net — it feeds printing and
// alerts — and never goes through here.
// ─────────────────────────────────────────────────────────────────────────────

/** D3: a safety-net poll's cadence while the room is proven up. */
export const REALTIME_RELAXED_POLL_MS = 120_000;

/** The cadence for one tick: room proven up → at least 120 s; otherwise today's `normalMs`, unchanged. */
export function livePollMs(normalMs: number, healthy: boolean): number {
  return healthy ? Math.max(normalMs, REALTIME_RELAXED_POLL_MS) : normalMs;
}

/** A refetchInterval function over today's interval; reads isRealtimeHealthy() on every call. */
export function livePoll(normalMs: number): () => number {
  return () => livePollMs(normalMs, isRealtimeHealthy());
}
