import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pulseArrival,
  autoPrintCandidate,
  AUTO_PRINT_MAX_AGE_MS,
  type PosPulseData,
  type PulseSelfOrder,
} from "./self-order-alert";

// Helper: a minimally-valid empty pulse tick, overridable per-test.
function pulse(overrides: Partial<PosPulseData> = {}): PosPulseData {
  return {
    openCount: 0,
    openTruncated: false,
    selfOrdersTruncated: false,
    newestOpenId: null,
    newestOpenAt: null,
    openRev: null,
    selfOrders: [],
    ...overrides,
  };
}

function selfOrder(overrides: Partial<PulseSelfOrder> = {}): PulseSelfOrder {
  return {
    requestId: "r1",
    orderId: "o1",
    kotRound: 1,
    acceptedAt: "2026-08-22T10:00:00.000Z",
    printed: false,
    ...overrides,
  };
}

// -- pulseArrival ---------------------------------------------------------

test("pulseArrival: prev === null (first tick after mount/reload) seeds silently — all false", () => {
  const next = pulse({ openCount: 3, newestOpenId: "req1", newestOpenAt: "2026-08-22T10:00:00.000Z" });
  assert.deepEqual(pulseArrival(null, next), {
    ring: false,
    requestsChanged: false,
    selfOrdersChanged: false,
  });
});

test("pulseArrival: count-flat-but-newer-arrival RINGS (an accept + a new open arrival in one beat)", () => {
  const prev = pulse({ openCount: 2, newestOpenId: "reqA", newestOpenAt: "2026-08-22T10:00:00.000Z" });
  // reqA got accepted (removed) and a brand-new reqB arrived in the same tick — count stays 2.
  const next = pulse({ openCount: 2, newestOpenId: "reqB", newestOpenAt: "2026-08-22T10:05:00.000Z" });
  const delta = pulseArrival(prev, next);
  assert.equal(delta.ring, true);
  assert.equal(delta.requestsChanged, true);
});

test("pulseArrival: accept-of-the-newest request (newestOpenAt goes OLDER) does NOT ring but requestsChanged is true", () => {
  const prev = pulse({ openCount: 3, newestOpenId: "reqNew", newestOpenAt: "2026-08-22T10:10:00.000Z" });
  // reqNew (the newest) got accepted; the next-newest pending row is now reported, which is OLDER.
  const next = pulse({ openCount: 2, newestOpenId: "reqOld", newestOpenAt: "2026-08-22T09:00:00.000Z" });
  const delta = pulseArrival(prev, next);
  assert.equal(delta.ring, false);
  assert.equal(delta.requestsChanged, true);
});

test("pulseArrival: openRev-only change (a diner PATCHing their own open request) — requestsChanged true, ring false", () => {
  const prev = pulse({
    openCount: 1,
    newestOpenId: "req1",
    newestOpenAt: "2026-08-22T10:00:00.000Z",
    openRev: "2026-08-22T10:00:00.000Z",
  });
  const next = pulse({
    openCount: 1,
    newestOpenId: "req1",
    newestOpenAt: "2026-08-22T10:00:00.000Z",
    openRev: "2026-08-22T10:03:00.000Z", // edited in place
  });
  const delta = pulseArrival(prev, next);
  assert.equal(delta.ring, false);
  assert.equal(delta.requestsChanged, true);
  assert.equal(delta.selfOrdersChanged, false);
});

test("pulseArrival: a self-order arrival (newer acceptedAt at index 0) rings", () => {
  const prev = pulse({ selfOrders: [selfOrder({ requestId: "s1", acceptedAt: "2026-08-22T10:00:00.000Z" })] });
  const next = pulse({
    selfOrders: [
      selfOrder({ requestId: "s2", acceptedAt: "2026-08-22T10:05:00.000Z" }),
      selfOrder({ requestId: "s1", acceptedAt: "2026-08-22T10:00:00.000Z" }),
    ],
  });
  const delta = pulseArrival(prev, next);
  assert.equal(delta.ring, true);
  assert.equal(delta.selfOrdersChanged, true);
});

test("pulseArrival: a printed-flag flip (same requestId, same acceptedAt) — selfOrdersChanged true, ring false", () => {
  const prev = pulse({ selfOrders: [selfOrder({ requestId: "s1", printed: false })] });
  const next = pulse({ selfOrders: [selfOrder({ requestId: "s1", printed: true })] });
  const delta = pulseArrival(prev, next);
  assert.equal(delta.ring, false);
  assert.equal(delta.selfOrdersChanged, true);
  assert.equal(delta.requestsChanged, false);
});

test("pulseArrival: empty poll -> empty poll stays all-false", () => {
  const delta = pulseArrival(pulse(), pulse());
  assert.deepEqual(delta, { ring: false, requestsChanged: false, selfOrdersChanged: false });
});

test("pulseArrival: malformed date strings never throw and never ring", () => {
  const prev = pulse({ newestOpenId: "req1", newestOpenAt: "not-a-date" });
  const next = pulse({ newestOpenId: "req2", newestOpenAt: "also-not-a-date" });
  assert.doesNotThrow(() => pulseArrival(prev, next));
  const delta = pulseArrival(prev, next);
  assert.equal(delta.ring, false);

  // Malformed selfOrders[0].acceptedAt must not ring or throw either.
  const prevSelf = pulse({ selfOrders: [selfOrder({ acceptedAt: "garbage" })] });
  const nextSelf = pulse({ selfOrders: [selfOrder({ requestId: "s2", acceptedAt: "also-garbage" })] });
  assert.doesNotThrow(() => pulseArrival(prevSelf, nextSelf));
  assert.equal(pulseArrival(prevSelf, nextSelf).ring, false);

  // A valid prev with a malformed next must not ring (next untrustworthy).
  const validPrev = pulse({ newestOpenId: "req1", newestOpenAt: "2026-08-22T10:00:00.000Z" });
  const malformedNext = pulse({ newestOpenId: "req2", newestOpenAt: "still-garbage" });
  assert.equal(pulseArrival(validPrev, malformedNext).ring, false);

  // A malformed prev with a valid next must not false-ring off an untrusted comparison.
  const malformedPrev = pulse({ newestOpenId: "req1", newestOpenAt: "garbage-prev" });
  const validNext = pulse({ newestOpenId: "req2", newestOpenAt: "2026-08-22T10:00:00.000Z" });
  assert.equal(pulseArrival(malformedPrev, validNext).ring, false);
});

// -- autoPrintCandidate -----------------------------------------------------

test("autoPrintCandidate: skips printed rows", () => {
  const now = Date.parse("2026-08-22T10:05:00.000Z");
  const rows = [selfOrder({ requestId: "s1", printed: true, acceptedAt: "2026-08-22T10:00:00.000Z" })];
  assert.equal(autoPrintCandidate(rows, now), null);
});

test("autoPrintCandidate: skips entries older than AUTO_PRINT_MAX_AGE_MS", () => {
  const acceptedAt = "2026-08-22T10:00:00.000Z";
  const now = Date.parse(acceptedAt) + AUTO_PRINT_MAX_AGE_MS + 1;
  const rows = [selfOrder({ requestId: "s1", printed: false, acceptedAt })];
  assert.equal(autoPrintCandidate(rows, now), null);
});

test("autoPrintCandidate: returns the OLDEST eligible unprinted row (kitchen ticket order)", () => {
  const now = Date.parse("2026-08-22T10:09:00.000Z");
  const rows = [
    selfOrder({ requestId: "s-newer", printed: false, acceptedAt: "2026-08-22T10:05:00.000Z" }),
    selfOrder({ requestId: "s-oldest", printed: false, acceptedAt: "2026-08-22T10:01:00.000Z" }),
    selfOrder({ requestId: "s-printed", printed: true, acceptedAt: "2026-08-22T10:00:00.000Z" }),
  ];
  const candidate = autoPrintCandidate(rows, now);
  assert.equal(candidate?.requestId, "s-oldest");
});

test("autoPrintCandidate: null when disabled (empty list)", () => {
  assert.equal(autoPrintCandidate([], Date.now()), null);
});

test("autoPrintCandidate: a NaN/malformed acceptedAt is skipped, not thrown on", () => {
  const now = Date.parse("2026-08-22T10:05:00.000Z");
  const rows = [
    selfOrder({ requestId: "s-bad", printed: false, acceptedAt: "not-a-real-date" }),
    selfOrder({ requestId: "s-good", printed: false, acceptedAt: "2026-08-22T10:01:00.000Z" }),
  ];
  assert.doesNotThrow(() => autoPrintCandidate(rows, now));
  const candidate = autoPrintCandidate(rows, now);
  assert.equal(candidate?.requestId, "s-good");
});
