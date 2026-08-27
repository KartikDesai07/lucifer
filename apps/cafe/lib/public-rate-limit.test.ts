import { test } from "node:test";
import assert from "node:assert/strict";

import { PUBLIC_ORDER_RATE_WINDOW_MS } from "@pos/shared/public";
import { assertSchemaTtlAllowed } from "./ttl-guard";
import { publicRateLimitSchema } from "@/models/PublicRateLimit";
import {
  rateWindowIndex,
  rateWindowKey,
  rateLimitDecision,
} from "./public-rate-limit";

// CR2.2 SLICE 3 — the fixed-window rate limiter's PURE math, proven DB-free
// (rateLimitDecision takes an already-incremented counter value, so the
// atomic-upsert half of hitRateLimit is exercised only by the live leg).

// ── rateWindowIndex / rateWindowKey ─────────────────────────────────────────

test("rateWindowIndex: two timestamps in the same window produce the same index", () => {
  const start = 10 * PUBLIC_ORDER_RATE_WINDOW_MS;
  assert.equal(rateWindowIndex(start), rateWindowIndex(start + 1));
  assert.equal(
    rateWindowIndex(start),
    rateWindowIndex(start + PUBLIC_ORDER_RATE_WINDOW_MS - 1),
  );
});

test("rateWindowIndex: the boundary millisecond belongs to the NEXT window", () => {
  const start = 10 * PUBLIC_ORDER_RATE_WINDOW_MS;
  const boundary = start + PUBLIC_ORDER_RATE_WINDOW_MS;
  assert.equal(rateWindowIndex(boundary), rateWindowIndex(start) + 1);
});

test("rateWindowKey: composes bucket and window index, and two different buckets in the same window never collide", () => {
  const now = 42 * PUBLIC_ORDER_RATE_WINDOW_MS + 5;
  assert.equal(rateWindowKey("TABLE_A", now), `TABLE_A:${rateWindowIndex(now)}`);
  assert.notEqual(rateWindowKey("TABLE_A", now), rateWindowKey("parcel", now));
});

// ── rateLimitDecision: allowed / freshWindow / retryAfterSec ───────────────

test("rateLimitDecision: allowed while n <= max, rejected the moment n exceeds max", () => {
  const now = 5 * PUBLIC_ORDER_RATE_WINDOW_MS;
  assert.equal(rateLimitDecision(8, 8, now).allowed, true);
  assert.equal(rateLimitDecision(9, 8, now).allowed, false);
});

test("rateLimitDecision: freshWindow is true only when n === 1", () => {
  const now = 5 * PUBLIC_ORDER_RATE_WINDOW_MS;
  assert.equal(rateLimitDecision(1, 8, now).freshWindow, true);
  assert.equal(rateLimitDecision(2, 8, now).freshWindow, false);
  // Mutation this catches: a truthy-n check (n >= 1) that treats every hit in
  // a window as "fresh" — the prune/observability callers rely on this firing
  // exactly once per window.
  assert.equal(rateLimitDecision(0, 8, now).freshWindow, false);
});

test("rateLimitDecision: retryAfterSec is a ceil'd countdown to the window boundary, floored at 1 right at the edge", () => {
  const windowStart = 7 * PUBLIC_ORDER_RATE_WINDOW_MS;
  const nearEnd = windowStart + PUBLIC_ORDER_RATE_WINDOW_MS - 1; // 1ms before rollover
  assert.equal(rateLimitDecision(1, 8, nearEnd).retryAfterSec, 1);

  const midWindow = windowStart + 1_000; // 1s into the window
  const expectedSeconds = Math.ceil((PUBLIC_ORDER_RATE_WINDOW_MS - 1_000) / 1000);
  assert.equal(rateLimitDecision(1, 8, midWindow).retryAfterSec, expectedSeconds);

  // Mutation this catches: retryAfterSec reaching 0 exactly at the boundary
  // millisecond — a client told "retry in 0s" retries immediately into the
  // same still-active window.
  assert.ok(rateLimitDecision(1, 8, nearEnd).retryAfterSec >= 1);
});

// ── ttl-guard: PublicRateLimit is a plain (non-TTL) schema ─────────────────

test("PIN: publicRateLimitSchema passes assertSchemaTtlAllowed without throwing — this model is never federated/registry-swept, so it never reaches the registry's TTL allowlist at runtime; this only proves it declares no TTL index for the guard to ever object to", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("PublicRateLimit", publicRateLimitSchema));
});
