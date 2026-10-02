import { test } from "node:test";
import assert from "node:assert/strict";

import { createReportDebouncer } from "@/lib/printer/report-debounce";

// A manual clock: nothing here sleeps.
function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    schedule: (fn: () => void, ms: number): number => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    cancel: (handle: number): void => void timers.delete(handle),
    advance(ms: number): void {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
      }
      now = target;
    },
    pending: (): number => timers.size,
  };
}

const DELAY = 1000;

function setup(initial?: string) {
  const clock = makeClock();
  const state: { value: string | undefined; sent: string[]; reads: number } = { value: "connected", sent: [], reads: 0 };
  const debouncer = createReportDebouncer<string, number>({
    delayMs: DELAY,
    schedule: clock.schedule,
    cancel: clock.cancel,
    read: () => {
      state.reads += 1;
      return state.value;
    },
    send: (v) => state.sent.push(v),
    initial,
  });
  return { clock, state, debouncer };
}

test("nothing is sent before the delay, then the current value is sent once", () => {
  const { clock, state, debouncer } = setup();
  debouncer.poke();
  clock.advance(DELAY - 1);
  assert.deepEqual(state.sent, []);
  clock.advance(1);
  assert.deepEqual(state.sent, ["connected"]);
});

test("pokes inside the window coalesce into one send of the LAST value", () => {
  const { clock, state, debouncer } = setup();
  debouncer.poke();
  clock.advance(400);
  state.value = "disconnected";
  debouncer.poke();
  clock.advance(400);
  state.value = "unknown";
  debouncer.poke();
  clock.advance(DELAY - 1);
  assert.deepEqual(state.sent, [], "each poke restarts the timer");
  clock.advance(1);
  assert.deepEqual(state.sent, ["unknown"]);
  assert.equal(state.reads, 1);
  assert.equal(clock.pending(), 0);
});

test("a flap that settles where it started sends nothing", () => {
  const { clock, state, debouncer } = setup("connected");
  state.value = "disconnected";
  debouncer.poke();
  clock.advance(300);
  state.value = "connected";
  debouncer.poke();
  clock.advance(DELAY);
  assert.deepEqual(state.sent, []);
});

test("the same value is never sent twice in a row; a change is", () => {
  const { clock, state, debouncer } = setup();
  debouncer.poke();
  clock.advance(DELAY);
  debouncer.poke();
  clock.advance(DELAY);
  assert.deepEqual(state.sent, ["connected"]);
  state.value = "disconnected";
  debouncer.poke();
  clock.advance(DELAY);
  assert.deepEqual(state.sent, ["connected", "disconnected"]);
});

test("an undefined read sends nothing and keeps the last value", () => {
  const { clock, state, debouncer } = setup();
  debouncer.poke();
  clock.advance(DELAY);
  state.value = undefined;
  debouncer.poke();
  clock.advance(DELAY);
  assert.deepEqual(state.sent, ["connected"]);
  state.value = "connected";
  debouncer.poke();
  clock.advance(DELAY);
  assert.deepEqual(state.sent, ["connected"], "still the last sent value, so no repeat");
});

test("dispose cancels the pending send and ignores later pokes", () => {
  const { clock, state, debouncer } = setup();
  debouncer.poke();
  debouncer.dispose();
  assert.equal(clock.pending(), 0);
  clock.advance(DELAY * 5);
  debouncer.poke();
  clock.advance(DELAY * 5);
  assert.deepEqual(state.sent, []);
  assert.equal(state.reads, 0);
});
