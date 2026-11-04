// The calm pulse's cadence (Printing Phase 5, spec 5.11): 20 s while anything is going on, 60 s when quiet.

import { test } from "node:test";
import assert from "node:assert/strict";

import { REFETCH_INTERVALS } from "@pos/shared/query";
import { PULSE_OWN_SLIP_WINDOW_MS, pulseIntervalMs } from "./pos-pulse-cadence";

const NOW = 1_000_000_000;
const quiet = { realtimeTrusted: true, offline: false, pulseMissed: false, outboxEntries: 0, printAttention: 0, printJobsForMe: 0, openRequests: 0, lastOwnSlipAt: null, nowMs: NOW };

test("the two intervals are 20 s and 60 s", () => {
  assert.equal(REFETCH_INTERVALS.POS_PULSE, 20_000, "lively");
  assert.equal(REFETCH_INTERVALS.POS_PULSE_CALM, 60_000, "calm");
  assert.equal(PULSE_OWN_SLIP_WINDOW_MS, 120_000, "a device's own slip keeps the pulse lively for 2 minutes");
});

test("quiet with realtime proven is calm (60 s)", () => {
  assert.equal(pulseIntervalMs(quiet), 60_000, "nothing going on");
  assert.equal(pulseIntervalMs({ ...quiet, lastOwnSlipAt: NOW - 10 * 60_000 }), 60_000, "an old own slip does not matter");
});

test("realtime not proven is lively", () => {
  assert.equal(pulseIntervalMs({ ...quiet, realtimeTrusted: false }), 20_000, "the pulse is the safety net then");
});

test("offline is lively", () => {
  assert.equal(pulseIntervalMs({ ...quiet, offline: true }), 20_000, "the first pulse that reaches the server ends offline");
});

// The owner's answer after 5C (2026-11-04, "the server smooth and the process fast"): a calm screen that missed one
// pulse checks again in 20 s, so an outage is found at the second miss sooner (no request while the server answers).
test("a pulse that got no answer is lively until one reaches the server", () => {
  assert.equal(pulseIntervalMs({ ...quiet, pulseMissed: true }), 20_000, "one miss: the next check comes in 20 s");
});

test("an entry waits in the outbox is lively", () => {
  assert.equal(pulseIntervalMs({ ...quiet, outboxEntries: 1 }), 20_000, "waiting entries are sent soon");
});

test("a slip waits is lively", () => {
  assert.equal(pulseIntervalMs({ ...quiet, printAttention: 1 }), 20_000, "a waiting slip");
});

test("a job for this device is lively", () => {
  assert.equal(pulseIntervalMs({ ...quiet, printJobsForMe: 1 }), 20_000, "a job to print here");
});

test("an open QR request is lively", () => {
  assert.equal(pulseIntervalMs({ ...quiet, openRequests: 1 }), 20_000, "a diner is waiting");
});

test("this device made a slip 119 s ago is lively, 121 s ago is calm", () => {
  assert.equal(pulseIntervalMs({ ...quiet, lastOwnSlipAt: NOW - 119_000 }), 20_000, "inside the window");
  assert.equal(pulseIntervalMs({ ...quiet, lastOwnSlipAt: NOW - 121_000 }), 60_000, "outside the window");
});
