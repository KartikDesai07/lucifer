// The calm pulse wired (Printing Phase 5, spec 5.11; plan Task 16): the pulse's interval is re-read from the page's
// own inputs (realtime proven, offline, the outbox, the last answer, this device's own slip in the last 2 minutes) and
// the last answer; a change of a local input tells the provider to re-render (TanStack re-reads the interval only on a
// query update or a render), with no request.

import { test } from "node:test";
import assert from "node:assert/strict";

import { REFETCH_INTERVALS } from "@pos/shared/query";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { cadenceInputsOf, createOwnSlips } from "@/lib/pulse-cadence-now";
import { pulseIntervalMs } from "@/lib/pos-pulse-cadence";

const QUIET = { trusted: true, offline: false, pulseMisses: 0, outboxEntries: 0, lastOwnSlipAt: null };
const data = (over: Partial<PosPulseData> = {}): PosPulseData => ({ openCount: 0, ...over }) as PosPulseData;

test("quiet and realtime proven: calm 60 s; each lively condition: 20 s", () => {
  const now = 1_000_000;
  const calm = pulseIntervalMs(cadenceInputsOf(data(), QUIET, now));
  assert.equal(calm, REFETCH_INTERVALS.POS_PULSE_CALM, "calm");
  const lively = (inputs: ReturnType<typeof cadenceInputsOf>) => pulseIntervalMs(inputs) === REFETCH_INTERVALS.POS_PULSE;
  assert.ok(lively(cadenceInputsOf(data(), { ...QUIET, trusted: false }, now)), "realtime not proven");
  assert.ok(lively(cadenceInputsOf(data(), { ...QUIET, offline: true }, now)), "offline");
  assert.ok(lively(cadenceInputsOf(data(), { ...QUIET, pulseMisses: 1 }, now)), "a pulse missed (the owner's answer after 5C)");
  assert.ok(lively(cadenceInputsOf(data(), { ...QUIET, outboxEntries: 1 }, now)), "an offline order waits");
  assert.ok(lively(cadenceInputsOf(data({ openCount: 1 }), QUIET, now)), "a QR request is open");
  assert.ok(lively(cadenceInputsOf(data({ printAttention: [{} as never] }), QUIET, now)), "a slip waits");
  assert.ok(lively(cadenceInputsOf(data({ printJobsForMe: { count: 1 } as never }), QUIET, now)), "a job for this device");
  assert.ok(lively(cadenceInputsOf(data(), { ...QUIET, lastOwnSlipAt: now - 60_000 }, now)), "its own slip a minute ago");
  assert.ok(!lively(cadenceInputsOf(data(), { ...QUIET, lastOwnSlipAt: now - 121_000 }, now)), "two minutes on: calm again");
  assert.ok(lively(cadenceInputsOf(undefined, QUIET, now)), "no answer yet: nothing proves it quiet");
});

test("this device's own slip-making writes are noted, and the provider is told (a version: no time in the snapshot)", () => {
  const own = createOwnSlips();
  let told = 0;
  const off = own.subscribe(() => (told += 1));
  const before = own.version();
  own.mark(5_000);
  assert.equal(own.lastAt(), 5_000, "noted");
  assert.equal(told, 1, "told once");
  assert.notEqual(own.version(), before, "the snapshot moved");
  off();
});
