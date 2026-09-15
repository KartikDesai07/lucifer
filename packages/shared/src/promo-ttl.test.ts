// CB-5D part 2 — DB-free boundary unit suite for the two TTL predicates in
// public-promo.ts: isAssignedRewardExpired and isRungClaimWindowClosed, plus
// promoExpiryFrom's day math. No Date.now()/new Date() anywhere here — every
// timestamp is a fixed number so the suite is deterministic.
//
// New file: promo-ttl.test.ts, not public-promo.test.ts, because no such
// suite already existed for public-promo.ts's exports — this is the first
// dedicated test file for that module, scoped narrowly to the part-2 TTL
// predicates per the task.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAssignedRewardExpired,
  isRungClaimWindowClosed,
  promoExpiryFrom,
} from "./public-promo";

// Derived explicitly here (not imported from the unexported ONE_DAY_MS in
// public-promo.ts) so this suite would still catch a broken day constant in
// the source rather than trivially agreeing with it.
const DAY_MS = 86400000;

const NOW = 1_700_000_000_000; // fixed arbitrary instant, no wall clock involved

// ── isRungClaimWindowClosed ─────────────────────────────────────────────────

test("isRungClaimWindowClosed: undefined earnedAt + a real window -> false (MOST IMPORTANT: pre-feature customers have no recorded earn time, and an unrecorded earn time must never refuse a claim)", () => {
  assert.equal(isRungClaimWindowClosed(undefined, 7, NOW), false);
});

test("isRungClaimWindowClosed: null earnedAt + a real window -> false (same reason as undefined)", () => {
  assert.equal(isRungClaimWindowClosed(null, 7, NOW), false);
});

test("isRungClaimWindowClosed: earnedAt === 0 -> true for a real window (CONTRAST case: 0 reads as the 1970 epoch and, unlike undefined, IS a real earn time that can be past its window — this is why callers must pass `earnedAt?.getTime()`, which yields undefined for an unset date, never 0/NaN; apps/cafe/lib/order-request-reward.ts line 162 relies on exactly this optional-chaining behavior)", () => {
  assert.equal(isRungClaimWindowClosed(0, 7, NOW), true);
});

test("isRungClaimWindowClosed: null claimWithinDays -> false even for an ancient earnedAt (no configured window = no deadline)", () => {
  assert.equal(isRungClaimWindowClosed(0, null, NOW), false);
});

test("isRungClaimWindowClosed: undefined claimWithinDays -> false even for an ancient earnedAt (no configured window = no deadline)", () => {
  assert.equal(isRungClaimWindowClosed(0, undefined, NOW), false);
});

test("isRungClaimWindowClosed: inside the window -> false", () => {
  const earnedAt = NOW - 3 * DAY_MS; // earned 3 days ago
  assert.equal(isRungClaimWindowClosed(earnedAt, 7, NOW), false);
});

test("isRungClaimWindowClosed: past the window -> true", () => {
  const earnedAt = NOW - 10 * DAY_MS; // earned 10 days ago, window is 7
  assert.equal(isRungClaimWindowClosed(earnedAt, 7, NOW), true);
});

test("isRungClaimWindowClosed: EXACTLY at the deadline (now === earnedAt + days*DAY) -> false (the deadline is the last usable instant, not the first dead one — matches how a diner reads 'valid for N days')", () => {
  const earnedAt = 1_000_000_000_000;
  const claimWithinDays = 5;
  const deadline = 1_000_000_000_000 + 5 * 86400000; // written out explicitly, not derived from DAY_MS, as an independent check on the day math
  assert.equal(isRungClaimWindowClosed(earnedAt, claimWithinDays, deadline), false);
});

test("isRungClaimWindowClosed: one millisecond past the deadline -> true", () => {
  const earnedAt = 1_000_000_000_000;
  const claimWithinDays = 5;
  const oneMsPastDeadline = 1_000_000_000_000 + 5 * 86400000 + 1;
  assert.equal(isRungClaimWindowClosed(earnedAt, claimWithinDays, oneMsPastDeadline), true);
});

// ── isAssignedRewardExpired ──────────────────────────────────────────────────

test("isAssignedRewardExpired: undefined expiresAt -> false (never expires; every code predating validDays)", () => {
  assert.equal(isAssignedRewardExpired(undefined, NOW), false);
});

test("isAssignedRewardExpired: null expiresAt -> false (never expires; every code predating validDays)", () => {
  assert.equal(isAssignedRewardExpired(null, NOW), false);
});

test("isAssignedRewardExpired: expiresAt exactly === now -> false (still usable, same last-usable-instant boundary rule as the claim window)", () => {
  const expiresAt = 1_234_567_890_000;
  assert.equal(isAssignedRewardExpired(expiresAt, expiresAt), false);
});

test("isAssignedRewardExpired: expiresAt one ms before now -> true", () => {
  const expiresAt = 1_234_567_890_000;
  assert.equal(isAssignedRewardExpired(expiresAt, expiresAt + 1), true);
});

// ── promoExpiryFrom ──────────────────────────────────────────────────────────

test("promoExpiryFrom: undefined validDays -> null (never expires)", () => {
  assert.equal(promoExpiryFrom(1_600_000_000_000, undefined), null);
});

test("promoExpiryFrom: a real validDays -> exactly assignedAtMs + validDays * 86400000 (exact number asserted, not re-derived, so day-math drift cannot silently pass)", () => {
  const assignedAtMs = 1_600_000_000_000;
  const validDays = 10;
  // Written out by hand: 1,600,000,000,000 + 864,000,000 = 1,600,864,000,000
  assert.equal(promoExpiryFrom(assignedAtMs, validDays), 1_600_864_000_000);
});
