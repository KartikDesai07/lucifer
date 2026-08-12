import { test } from "node:test";
import assert from "node:assert/strict";

import { _resetRateLimit, rateLimit } from "./rate-limit";

// DB-free tests for the F3.4 fixed-window limiter (§E-5 "5/IP/min"). Uses the
// injectable clock so no real time passes.

test("allows exactly `max` hits per window, then blocks with a retry hint", () => {
  _resetRateLimit();
  const opts = { max: 5, windowMs: 60_000, now: 1_000_000 };
  for (let i = 0; i < 5; i += 1) {
    const r = rateLimit("login:ip", opts);
    assert.ok(r.allowed, `hit ${i + 1} allowed`);
    assert.equal(r.remaining, 4 - i);
    assert.equal(r.retryAfterMs, 0);
  }
  const blocked = rateLimit("login:ip", opts);
  assert.ok(!blocked.allowed);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterMs, 60_000); // full window remains (same `now`)
});

test("the window resets after windowMs elapses", () => {
  _resetRateLimit();
  const base = 5_000_000;
  for (let i = 0; i < 5; i += 1) rateLimit("k", { max: 5, windowMs: 60_000, now: base });
  assert.ok(!rateLimit("k", { max: 5, windowMs: 60_000, now: base + 59_999 }).allowed);
  // one ms past the window → fresh allowance
  const after = rateLimit("k", { max: 5, windowMs: 60_000, now: base + 60_000 });
  assert.ok(after.allowed);
  assert.equal(after.remaining, 4);
});

test("distinct keys have independent windows", () => {
  _resetRateLimit();
  const opts = { max: 2, windowMs: 1000, now: 42 };
  assert.ok(rateLimit("a", opts).allowed);
  assert.ok(rateLimit("a", opts).allowed);
  assert.ok(!rateLimit("a", opts).allowed);
  // key "b" is untouched
  assert.ok(rateLimit("b", opts).allowed);
  assert.ok(rateLimit("b", opts).allowed);
  assert.ok(!rateLimit("b", opts).allowed);
});

test("retryAfterMs shrinks as the window ages", () => {
  _resetRateLimit();
  const base = 100_000;
  for (let i = 0; i < 5; i += 1) rateLimit("x", { max: 5, windowMs: 60_000, now: base });
  const mid = rateLimit("x", { max: 5, windowMs: 60_000, now: base + 20_000 });
  assert.ok(!mid.allowed);
  assert.equal(mid.retryAfterMs, 40_000);
});
