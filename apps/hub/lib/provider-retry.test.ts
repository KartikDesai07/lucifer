import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createRetryingFetch,
  createSerialQueue,
  RATE_LIMIT_MAX_RETRIES,
  rateLimitRemaining,
  resetWaitMs,
  RETRY_AFTER_DEFAULT_MS,
  RETRY_AFTER_MAX_MS,
  retryAfterMs,
  type RetryDeps,
} from "./provider-retry";

// DB-free tests for the F3.5 shared rate-limit layer. All time is virtual
// (injectable sleep/now — the F3.4 rate-limit test precedent): fake sleeps are
// RECORDED and advance the clock, so "backs off the exact Retry-After" is an
// exact assertion, not a wall-clock race.

const NOW = 1_750_000_000_000; // an arbitrary fixed epoch-ms origin

function makeDeps(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const sleeps: number[] = [];
  let clock = NOW;
  const deps: RetryDeps = {
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    }) as typeof fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, sleeps, advance: (ms: number) => void (clock += ms) };
}

function res(status: number, headers?: Record<string, string>): Response {
  return new Response(status === 204 ? null : "{}", { status, headers });
}

// ── retryAfterMs ──────────────────────────────────────────────────────────────

test("retryAfterMs: delta-seconds is exact, HTTP-date is relative, garbage defaults", () => {
  assert.equal(retryAfterMs("7", NOW), 7_000);
  assert.equal(retryAfterMs("0", NOW), 0);
  assert.equal(retryAfterMs(new Date(NOW + 30_000).toUTCString(), NOW), 30_000);
  assert.equal(retryAfterMs("soon", NOW), RETRY_AFTER_DEFAULT_MS);
  assert.equal(retryAfterMs(null, NOW), RETRY_AFTER_DEFAULT_MS);
  assert.equal(retryAfterMs("  ", NOW), RETRY_AFTER_DEFAULT_MS);
});

test("retryAfterMs: clamped to [0, RETRY_AFTER_MAX_MS]", () => {
  assert.equal(retryAfterMs("3600", NOW), RETRY_AFTER_MAX_MS);
  // an HTTP date in the past → 0, never negative
  assert.equal(retryAfterMs(new Date(NOW - 5_000).toUTCString(), NOW), 0);
});

// ── resetWaitMs (the three dialects by shape) ────────────────────────────────

test("resetWaitMs: IETF delta-seconds (Atlas), epoch s / epoch ms (Vercel), HTTP date (Cloudinary)", () => {
  assert.equal(resetWaitMs("30", NOW), 30_000); // delta seconds
  assert.equal(resetWaitMs(String(Math.floor(NOW / 1000) + 25), NOW), 25_000); // epoch s
  assert.equal(resetWaitMs(String(NOW + 12_000), NOW), 12_000); // epoch ms
  assert.equal(resetWaitMs(new Date(NOW + 45_000).toUTCString(), NOW), 45_000); // HTTP date
});

test("resetWaitMs: clamped, and null on absent/garbage", () => {
  assert.equal(resetWaitMs("999", NOW), RETRY_AFTER_MAX_MS); // 999s delta → clamp
  assert.equal(resetWaitMs(String(NOW - 60_000), NOW), 0); // past epoch → 0
  assert.equal(resetWaitMs(null, NOW), null);
  assert.equal(resetWaitMs("", NOW), null);
  assert.equal(resetWaitMs("whenever", NOW), null);
});

// ── rateLimitRemaining ────────────────────────────────────────────────────────

test("rateLimitRemaining reads all three header dialects; non-numeric → null", () => {
  assert.equal(rateLimitRemaining(new Headers({ "RateLimit-Remaining": "3" })), 3);
  assert.equal(rateLimitRemaining(new Headers({ "X-RateLimit-Remaining": "0" })), 0);
  assert.equal(rateLimitRemaining(new Headers({ "X-FeatureRateLimit-Remaining": "499" })), 499);
  assert.equal(rateLimitRemaining(new Headers({ "X-RateLimit-Remaining": "lots" })), null);
  assert.equal(rateLimitRemaining(new Headers()), null);
});

// ── createRetryingFetch ───────────────────────────────────────────────────────

test("a 429 backs off the EXACT Retry-After, then succeeds", async () => {
  const responses = [res(429, { "Retry-After": "7" }), res(200)];
  const { deps, calls, sleeps } = makeDeps(() => responses.shift()!);
  const rfetch = createRetryingFetch(deps, { label: "t" });
  const out = await rfetch("https://api.example/x");
  assert.equal(out.status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [7_000]); // the exact header value, nothing else
});

test("a 429 without Retry-After falls back to the reset header, then the default", async () => {
  const responses = [
    res(429, { "RateLimit-Reset": "3" }), // Atlas dialect: delta seconds
    res(429), // no hint at all
    res(200),
  ];
  const { deps, sleeps } = makeDeps(() => responses.shift()!);
  const rfetch = createRetryingFetch(deps, { label: "t" });
  assert.equal((await rfetch("https://api.example/x")).status, 200);
  assert.deepEqual(sleeps, [3_000, RETRY_AFTER_DEFAULT_MS]);
});

test("a persistent 429 throws after the bounded retries (never infinite)", async () => {
  const { deps, calls } = makeDeps(() => res(429, { "Retry-After": "1" }));
  const rfetch = createRetryingFetch(deps, { label: "hub-x" });
  await assert.rejects(rfetch("https://api.example/x"), /\[hub-x\] still rate-limited \(HTTP 429\)/);
  assert.equal(calls.length, RATE_LIMIT_MAX_RETRIES + 1);
});

test("420 is retried only when configured (the Cloudinary dialect)", async () => {
  // default statuses: a 420 passes straight through
  const plain = makeDeps(() => res(420));
  const passthrough = createRetryingFetch(plain.deps, { label: "t" });
  assert.equal((await passthrough("https://api.example/x")).status, 420);
  assert.equal(plain.sleeps.length, 0);

  // Cloudinary config: 420 retried like a 429
  const responses = [res(420, { "Retry-After": "5" }), res(200)];
  const cld = makeDeps(() => responses.shift()!);
  const rfetch = createRetryingFetch(cld.deps, { label: "t", rateLimitStatuses: [420, 429] });
  assert.equal((await rfetch("https://api.example/x")).status, 200);
  assert.deepEqual(cld.sleeps, [5_000]);
});

test("a SUCCESS reporting an empty bucket arms a proactive wait for the next call", async () => {
  let n = 0;
  const { deps, sleeps } = makeDeps(() => {
    n += 1;
    if (n === 1) return res(200, { "RateLimit-Remaining": "0", "RateLimit-Reset": "10" });
    return res(200, { "RateLimit-Remaining": "5" });
  });
  const rfetch = createRetryingFetch(deps, { label: "t" });
  await rfetch("https://api.example/a"); // arms the gate — no sleep yet
  assert.deepEqual(sleeps, []);
  await rfetch("https://api.example/b"); // waits out the reset BEFORE fetching
  assert.deepEqual(sleeps, [10_000]);
  await rfetch("https://api.example/c"); // gate passed — no further waiting
  assert.deepEqual(sleeps, [10_000]);
});

test("a fetchImpl rejection (network error) propagates immediately — no retry", async () => {
  const { deps, calls, sleeps } = makeDeps(() => {
    throw new TypeError("fetch failed");
  });
  const rfetch = createRetryingFetch(deps, { label: "t" });
  await assert.rejects(rfetch("https://api.example/x"), /fetch failed/);
  assert.equal(calls.length, 1, "a network error is not a rate limit — no blind retries");
  assert.deepEqual(sleeps, []);
});

test("a healthy remaining count arms nothing", async () => {
  const { deps, sleeps } = makeDeps(() =>
    res(200, { "RateLimit-Remaining": "7", "RateLimit-Reset": "10" }),
  );
  const rfetch = createRetryingFetch(deps, { label: "t" });
  await rfetch("https://api.example/a");
  await rfetch("https://api.example/b");
  assert.deepEqual(sleeps, []);
});

// ── createSerialQueue ─────────────────────────────────────────────────────────

test("serial queue runs tasks one-at-a-time in submission order", async () => {
  const serialize = createSerialQueue();
  const events: string[] = [];
  let active = 0;
  let maxActive = 0;
  const task = (id: string) => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${id}`);
    await new Promise((resolve) => setImmediate(resolve));
    events.push(`end:${id}`);
    active -= 1;
    return id;
  };
  const [a, b, c] = await Promise.all([
    serialize(task("a")),
    serialize(task("b")),
    serialize(task("c")),
  ]);
  assert.deepEqual([a, b, c], ["a", "b", "c"]);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
});

test("serial queue: a rejection reaches its caller and does not wedge the queue", async () => {
  const serialize = createSerialQueue();
  const failing = serialize(async () => {
    throw new Error("boom");
  });
  const following = serialize(async () => "ok");
  await assert.rejects(failing, /boom/);
  assert.equal(await following, "ok");
});
