import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { sameOriginOk } from "@/lib/public-origin-gate";
import { stripComments } from "@/lib/source-pin-utils";

// S11 — cheap same-origin check for the public order-intake path, DEFENCE IN
// DEPTH behind Vercel BotID (the PRIMARY fence; arbitrated 2026-09-13 — a
// cross-site POST already gets a 403 from BotID's client-side challenge
// before this ever runs). These pins cover sameOriginOk's own truth table
// plus (§7) the ordering of its call site in public-order-intake.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Same technique as lib/order-request-paths.test.ts / lib/diner-paths.test.ts:
// asserts the needle was actually found — a bare indexOf() comparison passes
// vacuously when both sides are -1.
function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}

const HOST = "cafe.example.com";

test("sameOriginOk: same host, origin present -> true", () => {
  assert.equal(sameOriginOk(`https://${HOST}`, null, HOST), true);
});

test("sameOriginOk: different host -> false", () => {
  assert.equal(sameOriginOk("https://evil.example.com", null, HOST), false);
});

test("sameOriginOk: both origin and referer absent -> true (QR-camera-app case: a phone camera app's scan navigation, and some in-app browsers, legitimately send neither header — failing closed here would block real diners, not attackers)", () => {
  assert.equal(sameOriginOk(null, null, HOST), true);
});

test("sameOriginOk: origin wins over referer — a mismatching origin plus a matching referer -> false", () => {
  assert.equal(sameOriginOk("https://evil.example.com", `https://${HOST}/menu`, HOST), false);
});

test("sameOriginOk: malformed origin -> false, does not throw", () => {
  assert.doesNotThrow(() => {
    assert.equal(sameOriginOk("not a url", null, HOST), false);
  });
});

test("sameOriginOk: host comparison is case-insensitive", () => {
  assert.equal(sameOriginOk(`https://${HOST.toUpperCase()}`, null, HOST), true);
  assert.equal(sameOriginOk(`https://${HOST}`, null, HOST.toUpperCase()), true);
});

// ── Ordering pin on public-order-intake.ts ──────────────────────────────────

const PUBLIC_ORDER_INTAKE_LIB = "apps/cafe/lib/public-order-intake.ts";

test("public-order-intake.ts: sameOriginOk runs AFTER the bot check and BEFORE hitRateLimit is ever reached", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_INTAKE_LIB));

  // Positive landmarks first — each must actually be found, or the ordering
  // comparison below would be comparing against a vacuous -1.
  const botCheckIdx = mustIndexOf(src, "await checkBotId()", "the bot check (step 1)");
  const originGateIdx = mustIndexOf(src, "sameOriginOk(", "the sameOriginOk call");

  assert.ok(
    originGateIdx > botCheckIdx,
    "sameOriginOk must be called AFTER the bot check",
  );

  // hitRateLimit itself lives in route.ts (this lib only owns steps 1-5 of
  // the route's control flow), so "before hitRateLimit" is pinned as: this
  // whole file — and therefore the origin gate inside it — never calls
  // hitRateLimit at all. A future merge that pulled step 7 into this file
  // would have to place it after the origin gate to satisfy the ordering
  // rule, so asserting absence here is the correct, non-vacuous pin for a
  // cross-file ordering contract.
  assert.ok(!src.includes("hitRateLimit"), "public-order-intake.ts must not call hitRateLimit (that step lives in route.ts, after this file returns)");
});
