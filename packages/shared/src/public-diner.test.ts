import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DINER_PIN_BANNED,
  isBannedDinerPin,
  isValidDinerPin,
  dinerPinBucket,
  dinerSourceBucket,
  stampsRemaining,
  rewardsAvailable,
} from "./public-diner";
import { SELF_ORDER_MODES, selfOrderingAllowed } from "./public";

// CB-4 — the diner ACCOUNT + stamp-loyalty PURE contract. DB-free unit tests
// over public-diner.ts's own math/predicates, mirroring public-rate-limit's
// "PURE math proven DB-free" split (the DB-touching half — hitRateLimit,
// Customer.findOne — is pinned separately by lib/diner-paths.test.ts's
// source pins and exercised live by the *-live.ts leg).

// ── stampsRemaining / rewardsAvailable ──────────────────────────────────────

test("stampsRemaining/rewardsAvailable: 0 stamps needs the full card and has zero rewards", () => {
  assert.equal(stampsRemaining(0, 8), 8);
  assert.equal(rewardsAvailable(0, 8), 0);
});

test("stampsRemaining/rewardsAvailable: a partial card (3 of 8) needs the remainder and has zero rewards", () => {
  assert.equal(stampsRemaining(3, 8), 5);
  assert.equal(rewardsAvailable(3, 8), 0);
});

test("stampsRemaining/rewardsAvailable: exactly one full card (8 of 8) resets toNextReward to a FULL card and yields one reward", () => {
  // Mutation this catches: a naive `stampsPerReward - stamps` at the exact
  // boundary would return 0 (nothing left to earn) instead of a fresh 8 —
  // stampsRemaining must read as "how far to the NEXT reward", not "how far
  // to zero".
  assert.equal(stampsRemaining(8, 8), 8);
  assert.equal(rewardsAvailable(8, 8), 1);
});

test("stampsRemaining/rewardsAvailable: multiple full cards (17 of 8) — 2 rewards ready, 7 stamps into the third", () => {
  assert.equal(stampsRemaining(17, 8), 7);
  assert.equal(rewardsAvailable(17, 8), 2);
});

test("stampsRemaining/rewardsAvailable: a zero or negative stampsPerReward must never divide by zero — both return 0, never NaN/Infinity", () => {
  for (const bad of [0, -1, -8]) {
    const remaining = stampsRemaining(5, bad);
    const rewards = rewardsAvailable(5, bad);
    // Mutation this catches: a config read straight from a corrupted/legacy
    // Settings doc reaching the modulo/division operators unguarded — that
    // would hand the diner-facing Rewards tab a NaN or Infinity to render.
    assert.equal(remaining, 0, `stampsRemaining(5, ${bad}) must be 0, not NaN/Infinity`);
    assert.equal(rewards, 0, `rewardsAvailable(5, ${bad}) must be 0, not NaN/Infinity`);
    assert.ok(Number.isFinite(remaining), `stampsRemaining(5, ${bad}) must be finite`);
    assert.ok(Number.isFinite(rewards), `rewardsAvailable(5, ${bad}) must be finite`);
    assert.ok(!Number.isNaN(remaining), `stampsRemaining(5, ${bad}) must not be NaN`);
    assert.ok(!Number.isNaN(rewards), `rewardsAvailable(5, ${bad}) must not be NaN`);
  }
});

// ── isValidDinerPin ──────────────────────────────────────────────────────────

test("isValidDinerPin: accepts exactly 4 digits", () => {
  assert.equal(isValidDinerPin("0000"), true);
  assert.equal(isValidDinerPin("1234"), true);
  assert.equal(isValidDinerPin("9999"), true);
});

test("isValidDinerPin: rejects 3 digits, 5 digits, non-digit characters, and the empty string", () => {
  assert.equal(isValidDinerPin("123"), false);
  assert.equal(isValidDinerPin("12345"), false);
  assert.equal(isValidDinerPin("12a4"), false);
  assert.equal(isValidDinerPin("12 4"), false);
  assert.equal(isValidDinerPin(""), false);
});

test("isValidDinerPin: rejects non-string values (number, null, undefined, objects) — a type-widened caller must never slip past the type guard", () => {
  // Mutation this catches: dropping the `typeof value === "string"` guard and
  // relying on the regex's implicit ToString coercion, which would let a
  // numeric 1234 (JSON.parse of a badly-typed body) through as if it were the
  // string "1234".
  assert.equal(isValidDinerPin(1234), false);
  assert.equal(isValidDinerPin(null), false);
  assert.equal(isValidDinerPin(undefined), false);
  assert.equal(isValidDinerPin({}), false);
  assert.equal(isValidDinerPin({ pin: "1234" }), false);
});

// ── isBannedDinerPin ─────────────────────────────────────────────────────────

test("isBannedDinerPin: true for every entry in DINER_PIN_BANNED", () => {
  for (const banned of DINER_PIN_BANNED) {
    assert.equal(isBannedDinerPin(banned), true, `${banned} must be banned`);
  }
});

test('isBannedDinerPin: false for a normal PIN like "3947"', () => {
  assert.equal(isBannedDinerPin("3947"), false);
});

// ── dinerPinBucket / dinerSourceBucket — distinct prefixes ──────────────────

test("dinerPinBucket and dinerSourceBucket produce DISTINCT prefixes for the SAME input — a mobile bucket must never collide with a source bucket", () => {
  // This matters: a collision would let one attack consume the other's
  // metering budget — e.g. a horizontal spray (many mobiles, one source key)
  // could exhaust a victim mobile's vertical brute-force budget just by
  // choosing a sourceKey equal to that mobile number, or vice versa.
  const sharedInputs = ["9876543210", "unknown", "", "dinerpin:9876543210", "dinersrc:unknown"];
  for (const input of sharedInputs) {
    const pinKey = dinerPinBucket(input);
    const sourceKey = dinerSourceBucket(input);
    assert.notEqual(
      pinKey,
      sourceKey,
      `dinerPinBucket(${JSON.stringify(input)}) must never equal dinerSourceBucket(${JSON.stringify(input)})`,
    );
  }
});

test("dinerPinBucket and dinerSourceBucket: no pin-bucket key for ANY input can ever equal a source-bucket key for ANY (possibly different) input, given the prefixes are fixed and distinct literal strings", () => {
  // Stronger than the same-input check above: prove the prefixes themselves
  // can never overlap by construction, not just for the sample inputs tried.
  // Mutation this catches: DINER_SOURCE_BUCKET_PREFIX accidentally starting
  // with DINER_PIN_BUCKET_PREFIX's exact text (or vice versa) — a crafted
  // input could then align enough is that one bucket key literally equals
  // the other bucket's key for some other input.
  const pinPrefixSample = dinerPinBucket("");
  const sourcePrefixSample = dinerSourceBucket("");
  assert.ok(
    !sourcePrefixSample.startsWith(pinPrefixSample) && !pinPrefixSample.startsWith(sourcePrefixSample),
    "the pin-bucket and source-bucket prefixes must not be a prefix of one another",
  );
});

// ── selfOrderingAllowed / SELF_ORDER_MODES ──────────────────────────────────

test('selfOrderingAllowed: false ONLY for "menu"; true for "approve" and "auto"', () => {
  assert.equal(selfOrderingAllowed("menu"), false);
  assert.equal(selfOrderingAllowed("approve"), true);
  assert.equal(selfOrderingAllowed("auto"), true);
});

test("selfOrderingAllowed: true for undefined — a legacy Settings doc with no selfOrderMode value must keep ordering ON (back-compat: every cafe that pre-dates CB-4 ordered fine before this field existed, so an absent value must not silently switch ordering off)", () => {
  assert.equal(selfOrderingAllowed(undefined), true);
});

test('PIN: SELF_ORDER_MODES contains exactly ["approve","auto","menu"] — order and membership both pinned, since selfOrderingAllowed is written against the DENY value ("menu") and a 4th mode added here without updating that predicate would silently inherit "allowed"', () => {
  assert.deepEqual(SELF_ORDER_MODES, ["approve", "auto", "menu"]);
});
