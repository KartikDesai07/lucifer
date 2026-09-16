import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { effectiveSummaryDate, parseSummaryDateParam } from "./summary-date";
import { cafeDateString, dayRange } from "@/lib/utils";

// CR1.5 Slice 5 — the ?date param on /api/orders/summary. `summary-date.ts`
// is a thin pure wrapper over the shared cafeDateString/dayRange day math, so
// this suite is DB-free.

// ── absent/"" → today ────────────────────────────────────────────────────

test("parseSummaryDateParam(null) → today's IST day", () => {
  const result = parseSummaryDateParam(null);
  assert.ok("day" in result, "absent must not error");
  if ("day" in result) assert.equal(cafeDateString(result.day), cafeDateString());
});

test('parseSummaryDateParam("") → today\'s IST day (same as absent)', () => {
  const result = parseSummaryDateParam("");
  assert.ok("day" in result);
  if ("day" in result) assert.equal(cafeDateString(result.day), cafeDateString());
});

// ── a valid past date ────────────────────────────────────────────────────

test("a valid past date parses to that exact IST day", () => {
  const result = parseSummaryDateParam("2026-08-01");
  assert.ok("day" in result);
  if (!("day" in result)) return; // narrow for TS — asserted above

  // Round-trips back through cafeDateString to the same string...
  assert.equal(cafeDateString(result.day), "2026-08-01");
  // ...and dayRange resolves the same IST-anchored [start,end) the summary
  // route uses for its createdAt query (IST midnight = UTC-5:30, no DST).
  const { start, end } = dayRange(result.day);
  assert.equal(start.toISOString(), "2026-07-31T18:30:00.000Z");
  assert.equal(end.toISOString(), "2026-08-01T18:29:59.999Z");
});

// ── IST (no-DST) boundary assumption ────────────────────────────────────
// CAFE_UTC_OFFSET_MINUTES is a fixed +5:30 (no daylight saving, ever) — the
// cafe-local day rolls over at 18:30 UTC, not at UTC midnight. This is the
// exact boundary the round-trip check above (and the route's dayRange call)
// depends on; pin it explicitly so a future DST-aware refactor trips a test.
test("IST day boundary: 18:29:59.999Z UTC is still the earlier day, 18:30:00.000Z rolls to the next", () => {
  assert.equal(cafeDateString(new Date("2026-08-01T18:29:59.999Z")), "2026-08-01");
  assert.equal(cafeDateString(new Date("2026-08-01T18:30:00.000Z")), "2026-08-02");
});

// ── rejected shapes ──────────────────────────────────────────────────────

test("rejects a value that doesn't match CAFE_DATE_PATTERN", () => {
  for (const raw of ["20260810", "2026-13-01", "garbage"]) {
    const result = parseSummaryDateParam(raw);
    assert.ok("error" in result, `expected an error for "${raw}"`);
  }
});

test('"2026-02-30" matches CAFE_DATE_PATTERN but fails the round-trip — rejected, not silently normalized to March 2', () => {
  // new Date("2026-02-30") does NOT throw: JS Date overflow-adjusts invalid
  // calendar dates instead of rejecting them (it becomes 2026-03-02). The
  // pattern check alone would let this through; the round-trip is what
  // actually catches it.
  const result = parseSummaryDateParam("2026-02-30");
  assert.ok("error" in result, "an invalid calendar date must be rejected, not silently shifted");
});

// ── effectiveSummaryDate — the EndOfDayButton clamp ─────────────────────────
// Arbiter-confirmed: clearing the `<input type="date">` yields raw `date=""`,
// and the server treats an absent/""  ?date as today — so an unclamped ""
// diverged into isToday=false, dateLabel="Invalid Date", documentTitle="EOD-".
// A single helper clamps it back to today before ANY other value is derived.

test("effectiveSummaryDate: an empty string clamps to today", () => {
  assert.equal(effectiveSummaryDate("", "2026-08-11"), "2026-08-11");
});

test("effectiveSummaryDate: a whitespace-only string clamps to today", () => {
  assert.equal(effectiveSummaryDate("   ", "2026-08-11"), "2026-08-11");
});

test("effectiveSummaryDate: a real date passes through unchanged", () => {
  assert.equal(effectiveSummaryDate("2026-08-01", "2026-08-11"), "2026-08-01");
});

// ── PIN: /api/orders/summary only caches TODAY's aggregation ────────────────
// Arbiter-confirmed: a user-chosen ?date mints an unbounded set of lazy-expiry
// cache keys (shared/cache.ts is a plain Map — an entry only expires on a
// same-key read, so past/future-day keys accumulate forever). The fix guards
// `cache.set` to only fire when the requested day IS today.

test("PIN: the summary route's cache.set is guarded by a today check", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../app/api/orders/summary/route.ts", import.meta.url)),
    "utf8",
  );
  const setIdx = src.indexOf("cache.set(key, summary");
  assert.ok(setIdx >= 0, "cache.set(key, summary, ...) must exist");
  const before = src.slice(0, setIdx);
  const guardIdx = before.lastIndexOf("if (");
  assert.ok(guardIdx >= 0, "cache.set must be inside an `if (...)` guard");
  const guardCond = before.slice(guardIdx, setIdx);
  assert.match(
    guardCond,
    /isToday/,
    "the guard must be a today check (an `isToday`-named identifier), so past/future days are never cached",
  );
});
