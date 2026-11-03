// The offline state (Printing Phase 5, spec 5.1): pure transitions. Offline starts when the browser says so, after
// two pulses with no answer, or after a write with no answer followed by a failed check; any answer that reached
// OUR server ends it, and the browser coming back alone does not.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@pos/shared/api-client";
import { OFFLINE_PULSE_MISSES, ONLINE_STATE, nextOfflineState, reachOf, type OfflineEvent, type OfflineState } from "./offline-state";

const run = (events: OfflineEvent[], from: OfflineState = ONLINE_STATE): OfflineState => events.reduce(nextOfflineState, from);
const missed: OfflineEvent = { type: "pulse", reach: "unreached" };

test("reachOf: our 4xx is reached; a 5xx, a timeout, a network error and a host page are not", () => {
  assert.equal(reachOf(new ApiError("x", "http", 409, true)), "reached", "our 409 reached us");
  assert.equal(reachOf(new ApiError("x", "http", 401, true)), "reached", "our 401 reached us");
  assert.equal(reachOf(new ApiError("x", "http", 402, false)), "unreached", "a host's 402 (not our envelope) did not");
  assert.equal(reachOf(new ApiError("x", "http", 502, true)), "unreached", "a 5xx did not");
  assert.equal(reachOf(new ApiError("x", "http", 503, true)), "unreached", "our 503 with our envelope is unreached");
  assert.equal(reachOf(new ApiError("x", "timeout", null)), "unreached", "a timeout did not");
  assert.equal(reachOf(new ApiError("x", "network", null)), "unreached", "a network error did not");
  assert.equal(reachOf(new Error("boom")), "unreached", "a plain error did not");
  assert.equal(reachOf(null), "unreached", "null did not");
});

test("the browser going offline is offline at once", () => {
  assert.deepEqual(run([{ type: "browser", online: false }]), { offline: true, pulseMisses: 0, writeMissed: false }, "offline at once");
});

test("two pulses with no answer are offline, one is not", () => {
  assert.equal(OFFLINE_PULSE_MISSES, 2, "two misses");
  assert.deepEqual(run([missed]), { offline: false, pulseMisses: 1, writeMissed: false }, "one miss is counted, not offline");
  assert.equal(run([missed, missed]).offline, true, "two in a row are offline");
  const reset = run([missed, { type: "pulse", reach: "reached" }, missed]);
  assert.deepEqual([reset.offline, reset.pulseMisses], [false, 1], "an answer in between resets the count");
});

test("a write with no answer is not offline until the check fails too", () => {
  const afterWrite = run([{ type: "write", reach: "unreached" }]);
  assert.deepEqual(afterWrite, { offline: false, pulseMisses: 0, writeMissed: true }, "the write miss is remembered");
  assert.equal(nextOfflineState(afterWrite, { type: "check", reach: "unreached" }).offline, true, "the failed check makes it offline");
  const cleared = nextOfflineState(afterWrite, { type: "check", reach: "reached" });
  assert.deepEqual([cleared.offline, cleared.writeMissed], [false, false], "a reached check clears the miss");
  assert.equal(run([{ type: "check", reach: "unreached" }]).offline, false, "a failed check with no write miss is not offline");
});

test("any answer that reached us is online again", () => {
  const offline: OfflineState = { offline: true, pulseMisses: 2, writeMissed: true };
  for (const type of ["pulse", "write", "check"] as const) {
    assert.deepEqual(nextOfflineState(offline, { type, reach: "reached" }), ONLINE_STATE, `a reached ${type} ends offline`);
  }
  // Online too, any reached answer is proof: a pulse miss, then a write that reached us, then a miss is not two in a row.
  assert.deepEqual(run([missed, { type: "write", reach: "reached" }, missed]), { offline: false, pulseMisses: 1, writeMissed: false }, "a reached write resets the pulse misses");
  assert.deepEqual(run([{ type: "write", reach: "unreached" }, { type: "pulse", reach: "reached" }, { type: "check", reach: "unreached" }]), ONLINE_STATE, "a pulse that reached us clears a write miss");
});

test("the browser coming online stays offline until an answer reaches us", () => {
  const offline = run([{ type: "browser", online: false }]);
  assert.equal(nextOfflineState(offline, { type: "browser", online: true }).offline, true, "still offline after the browser says online");
  assert.equal(nextOfflineState(ONLINE_STATE, { type: "browser", online: true }), ONLINE_STATE, "online stays as it is");
  assert.equal(nextOfflineState(offline, { type: "pulse", reach: "unreached" }).offline, true, "a missed pulse keeps it offline");
});
