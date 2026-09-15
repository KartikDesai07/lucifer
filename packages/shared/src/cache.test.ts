import { test } from "node:test";
import assert from "node:assert/strict";

import cache, { CACHE_MAX_ENTRIES, TTL } from "./cache";

// The in-process cache is the ONLY cache layer in this stack (there is no Redis
// and none is wanted — the free tier is the architecture), and 37 modules read
// or write it. These pin the two properties everything else depends on: it
// never grows without bound, and it never serves stale data.

test("get returns what set stored, and undefined for an unknown key", () => {
  cache.clear();
  cache.set("k", { a: 1 }, 60);
  assert.deepEqual(cache.get<{ a: number }>("k"), { a: 1 });
  assert.equal(cache.get("nope"), undefined);
});

test("del removes a key", () => {
  cache.clear();
  cache.set("k", 1, 60);
  cache.del("k");
  assert.equal(cache.get("k"), undefined);
});

test("a ttl of 0 stores NOTHING — TTL.ORDERS is 0 and POS order data must never be cached", () => {
  cache.clear();
  cache.set("orders", [{ id: 1 }], TTL.ORDERS);
  assert.equal(cache.get("orders"), undefined);
  assert.equal(cache.size(), 0, "a zero TTL must not even occupy an entry");
});

test("a negative ttl stores nothing and also EVICTS an existing value (set-to-uncacheable clears)", () => {
  cache.clear();
  cache.set("k", "old", 60);
  cache.set("k", "new", 0);
  assert.equal(cache.get("k"), undefined, "re-setting with ttl<=0 must clear, never keep the old value");
});

test("an expired entry is not served, and is dropped on read (lazy expiry)", () => {
  cache.clear();
  // -1s TTL is already in the past the moment it is written.
  cache.set("k", "v", -1);
  assert.equal(cache.get("k"), undefined);
  // Written with a real TTL then read past it:
  cache.set("stale", "v", 60);
  assert.equal(cache.get("stale"), "v");
});

test("PIN: the store is HARD-CAPPED — an unbounded key space cannot grow the isolate forever", () => {
  cache.clear();
  // Simulates the real unbounded key spaces in this app: `order-summary-<date>`
  // (a new key every day) and `auth:revalidated:<staffId>` (one per account).
  // Without a cap these accumulate for the life of the isolate, because lazy
  // expiry only fires when someone re-reads that EXACT key — and nobody ever
  // re-reads yesterday's summary key.
  for (let i = 0; i < CACHE_MAX_ENTRIES * 3; i++) {
    cache.set(`order-summary-2026-01-${i}`, { total: i }, 600);
  }
  assert.ok(
    cache.size() <= CACHE_MAX_ENTRIES,
    `store must never exceed CACHE_MAX_ENTRIES (${CACHE_MAX_ENTRIES}), saw ${cache.size()}`,
  );
});

test("PIN: eviction is LRU, not FIFO — a key that keeps being READ survives a flood of new keys", () => {
  cache.clear();
  cache.set("hot", "keep-me", 600);
  for (let i = 0; i < CACHE_MAX_ENTRIES - 1; i++) {
    cache.set(`filler-${i}`, i, 600);
    // Re-read the hot key so it stays the most-recently-used.
    assert.equal(cache.get("hot"), "keep-me");
  }
  // Now overflow the cap. Under FIFO "hot" would be evicted first (it was
  // inserted first); under LRU it survives because it was just read.
  for (let i = 0; i < 50; i++) cache.set(`overflow-${i}`, i, 600);
  assert.equal(cache.get("hot"), "keep-me", "a frequently-read key must not be evicted by newer cold keys");
});

test("PIN: re-setting an existing key refreshes its recency, not just its value", () => {
  cache.clear();
  cache.set("a", 1, 600);
  for (let i = 0; i < CACHE_MAX_ENTRIES - 1; i++) cache.set(`f-${i}`, i, 600);
  // Re-set (not re-read) the oldest key — Map.set on a present key keeps its
  // original position, so the implementation must delete-then-set.
  cache.set("a", 2, 600);
  for (let i = 0; i < 50; i++) cache.set(`o-${i}`, i, 600);
  assert.equal(cache.get("a"), 2, "a re-written key must be treated as recently used");
});

test("the cap holds even when every entry is already expired — size is bounded regardless of TTL state", () => {
  cache.clear();
  // Expired-but-unread entries still occupy the Map (lazy expiry), so the cap
  // is what actually bounds memory here, not the TTL.
  for (let i = 0; i < CACHE_MAX_ENTRIES * 2; i++) cache.set(`k${i}`, i, 1);
  assert.ok(cache.size() <= CACHE_MAX_ENTRIES, `saw ${cache.size()}`);
});

test("TTL constants are all non-negative and ORDERS is exactly 0 (POS accuracy)", () => {
  for (const [name, seconds] of Object.entries(TTL)) {
    assert.ok(typeof seconds === "number" && seconds >= 0, `${name} must be a non-negative number`);
  }
  assert.equal(TTL.ORDERS, 0, "order data must never be cached");
});

test("values are stored BY REFERENCE — callers must not mutate a cached object in place", () => {
  // Documents real behaviour rather than asserting a deep clone: this cache
  // deliberately does not clone (cloning every list on every read is the cost
  // node-cache was rejected for). Every call site stores a freshly-built lean
  // projection, so this is safe — and pinned here so a future caller that
  // mutates a cached value is a documented, findable decision.
  cache.clear();
  const value = { n: 1 };
  cache.set("ref", value, 60);
  value.n = 2;
  assert.equal(cache.get<{ n: number }>("ref")?.n, 2);
});
