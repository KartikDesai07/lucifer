// Perf P1 deep review I-1 (2026-11-02) — the catch-up rounds are spaced. A drop of the room runs one catch-up round
// (5–7 requests); a link that flaps open → close every few seconds, or a room that closes right after it accepts, would
// otherwise run one round per cycle, more than today's 30 s polls ever cost. lib/realtime-catch-up.ts createRoundSpacer:
// the first request at once, a request inside the window folded into ONE round at the window's end. Then the wiring
// pin (hooks/use-realtime.ts useRealtimeCatchUp feeds the drop AND the overdue echo through the one spacer).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/source-pin-utils";
import { REFETCH_INTERVALS } from "@/lib/query";
import type { NudgeTimers } from "@/lib/realtime-invalidate";
import { REALTIME_CATCH_UP_SPACING_MS, createRoundSpacer } from "@/lib/realtime-catch-up";

/** A hand clock: `advance` runs every armed timer whose time has come, in order, with the clock at its time. */
function handClock(start = 1_800_000_000_000) {
  let now = start;
  let nextId = 1;
  const armed = new Map<number, { at: number; fn: () => void }>();
  const timers: NudgeTimers = {
    setTimeout: (fn, ms) => (armed.set(nextId, { at: now + ms, fn }), nextId++),
    clearTimeout: (handle) => void armed.delete(handle as number),
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const next = [...armed.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      armed.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = target;
  };
  return { timers, advance, now: () => now, set: (ms: number) => void (now = ms), armed: () => armed.size };
}

test("I-1: the rounds are at least 30 s apart — today's live-list poll", () => {
  assert.equal(REALTIME_CATCH_UP_SPACING_MS, 30_000);
  assert.equal(REALTIME_CATCH_UP_SPACING_MS, REFETCH_INTERVALS.LIVE_LISTS, "never behind a drop by more than today's 30 s poll");
});

test("I-1: the first request runs at once; requests inside the window fold into ONE round at its end; after the window, at once again", () => {
  const clock = handClock();
  let rounds = 0;
  const spacer = createRoundSpacer(() => rounds++, REALTIME_CATCH_UP_SPACING_MS, clock.timers, clock.now);
  spacer.request();
  assert.equal(rounds, 1, "the first drop: its round at once (the invalidator then coalesces 1 s)");
  clock.advance(2_000);
  spacer.request(); // a flap: open → close 2 s later
  clock.advance(2_000);
  spacer.request();
  assert.equal(rounds, 1, "inside the window: no round yet");
  assert.equal(clock.armed(), 1, "ONE deferred round, however many drops");
  clock.advance(25_999);
  assert.equal(rounds, 1, "29.999 s after the first round: still waiting");
  clock.advance(1);
  assert.equal(rounds, 2, "the window's end: the folded round");
  clock.advance(30_000);
  spacer.request();
  assert.equal(rounds, 3, "a drop a full window after the last round: at once");
});

test("I-1: a flap every 2 s for 5 minutes costs one round per window, never one per cycle", () => {
  const clock = handClock();
  let rounds = 0;
  const spacer = createRoundSpacer(() => rounds++, REALTIME_CATCH_UP_SPACING_MS, clock.timers, clock.now);
  for (let t = 0; t < 300_000; t += 2_000) {
    spacer.request();
    clock.advance(2_000);
  }
  assert.ok(rounds <= 11, `at most one round per 30 s window over 300 s (got ${rounds}; was 150 before the spacing)`);
  assert.ok(rounds >= 10, "and never fewer than one per window while drops keep coming");
});

test("I-1: a clock set back never pushes the round past one window; dispose drops a deferred round", () => {
  const clock = handClock();
  let rounds = 0;
  const spacer = createRoundSpacer(() => rounds++, REALTIME_CATCH_UP_SPACING_MS, clock.timers, clock.now);
  spacer.request();
  clock.set(clock.now() - 3_600_000); // the device clock jumps an hour back
  spacer.request();
  clock.advance(REALTIME_CATCH_UP_SPACING_MS);
  assert.equal(rounds, 2, "capped at one window, not an hour");
  spacer.request();
  spacer.dispose();
  clock.advance(REALTIME_CATCH_UP_SPACING_MS);
  assert.equal(rounds, 2, "disposed: the deferred round never runs");
  spacer.request();
  assert.equal(rounds, 2, "disposed: a later request is ignored");
});

test("PIN (I-1, I-2): useRealtimeCatchUp feeds the drop AND the overdue echo through one spacer into the one invalidator", () => {
  const src = stripComments(readFileSync(fileURLToPath(new URL("../hooks/use-realtime.ts", import.meta.url)), "utf8"));
  const hook = src.slice(src.indexOf("export function useRealtimeCatchUp(): void {"));
  assert.ok(hook.startsWith("export function useRealtimeCatchUp"), "positive landmark: the catch-up hook");
  assert.match(hook, /const spacer = createRoundSpacer\(\(\) => invalidator\.onKind\(REALTIME_DOWN_KIND\)\);/, "I-1: one spacer per tab");
  assert.match(hook, /subscribeRealtimeDown\(spacer\.request\)/, "I-1: a drop asks the spacer");
  assert.match(hook, /watchRealtimeEcho\(qc, spacer\.request\)/, "I-2: an overdue echo asks the same spacer");
  assert.match(hook, /spacer\.dispose\(\);/, "the teardown drops a deferred round");
  assert.equal((src.match(/createRoundSpacer\(/g) ?? []).length, 1, "the only spacer in the realtime hooks");
});
