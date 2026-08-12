import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  INGEST_SIG_HEADER,
  INGEST_TS_HEADER,
  INGEST_TS_TOLERANCE_S,
  ingestMessageToSign,
} from "@pos/shared/heartbeat";

import { signIngest, verifyIngest } from "./heartbeat-hmac";

const SECRET = "test-ingest-secret";
const BODY = '{"tenant":"verify-cafe","hostOk":true,"at":"2026-07-14T10:00:00.000Z"}';
const NOW = 1_784_000_000_000; // fixed clock (ms)
const TS = String(Math.floor(NOW / 1000));

test("hmac: sign then verify round-trips", () => {
  const sig = signIngest(SECRET, TS, BODY);
  assert.match(sig, /^[0-9a-f]{64}$/, "lowercase hex sha256 length");
  assert.deepEqual(verifyIngest(SECRET, TS, sig, BODY, NOW), { ok: true });
});

test("hmac: the message binds the timestamp (ts dot body)", () => {
  assert.equal(ingestMessageToSign("123", "x"), "123.x");
  // A signature minted for one ts cannot be presented under another.
  const sig = signIngest(SECRET, TS, BODY);
  const otherTs = String(Math.floor(NOW / 1000) - 60);
  const res = verifyIngest(SECRET, otherTs, sig, BODY, NOW);
  assert.deepEqual(res, { ok: false, reason: "bad-signature" });
});

test("hmac: wrong secret / tampered body / tampered sig all refuse", () => {
  const sig = signIngest(SECRET, TS, BODY);
  assert.equal(verifyIngest("other-secret", TS, sig, BODY, NOW).ok, false);
  assert.equal(verifyIngest(SECRET, TS, sig, BODY.replace("true", "false"), NOW).ok, false);
  const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
  assert.equal(verifyIngest(SECRET, TS, flipped, BODY, NOW).ok, false);
});

test("hmac: uppercase hex from a signer is accepted (lowercased before compare)", () => {
  const sig = signIngest(SECRET, TS, BODY).toUpperCase();
  assert.deepEqual(verifyIngest(SECRET, TS, sig, BODY, NOW), { ok: true });
});

test("hmac: stale/future timestamps outside the tolerance refuse; the boundary passes", () => {
  const mk = (tsNum: number) => {
    const ts = String(tsNum);
    return verifyIngest(SECRET, ts, signIngest(SECRET, ts, BODY), BODY, NOW);
  };
  const nowS = Math.floor(NOW / 1000);
  assert.deepEqual(mk(nowS - INGEST_TS_TOLERANCE_S), { ok: true }, "exact lower boundary");
  assert.deepEqual(mk(nowS + INGEST_TS_TOLERANCE_S), { ok: true }, "exact upper boundary");
  assert.deepEqual(mk(nowS - INGEST_TS_TOLERANCE_S - 1), { ok: false, reason: "stale-ts" });
  assert.deepEqual(mk(nowS + INGEST_TS_TOLERANCE_S + 1), { ok: false, reason: "stale-ts" });
});

test("hmac: garbage timestamps refuse as stale (strict decimal-seconds parse)", () => {
  for (const ts of ["abc", "-5", "12.5", "0x10", "1e9", " 123", String(10 ** 13)]) {
    const res = verifyIngest(SECRET, ts, signIngest(SECRET, ts, BODY), BODY, NOW);
    assert.deepEqual(res, { ok: false, reason: "stale-ts" }, `ts=${JSON.stringify(ts)}`);
  }
  // An EMPTY ts header is treated as absent (falsy) — missing-headers, not stale.
  const empty = verifyIngest(SECRET, "", signIngest(SECRET, "", BODY), BODY, NOW);
  assert.deepEqual(empty, { ok: false, reason: "missing-headers" });
});

test("hmac: missing headers / missing secret fail closed with distinct reasons", () => {
  const sig = signIngest(SECRET, TS, BODY);
  assert.deepEqual(verifyIngest(SECRET, null, sig, BODY, NOW), {
    ok: false,
    reason: "missing-headers",
  });
  assert.deepEqual(verifyIngest(SECRET, TS, null, BODY, NOW), {
    ok: false,
    reason: "missing-headers",
  });
  assert.deepEqual(verifyIngest(undefined, TS, sig, BODY, NOW), { ok: false, reason: "no-secret" });
  assert.deepEqual(verifyIngest("", TS, sig, BODY, NOW), { ok: false, reason: "no-secret" });
});

// ── Worker parity (the provisioner-plan RESERVED_SUBDOMAINS precedent) ────────
// workers/failover sits OUTSIDE the npm workspace and cannot import
// @pos/shared, so it MIRRORS the scheme literals. Pin them against the Worker
// source — drift would silently break every forwarded heartbeat.
test("parity: the Worker source mirrors the shared ingest scheme literals", () => {
  const src = readFileSync(
    new URL("../../../workers/failover/src/index.ts", import.meta.url),
    "utf8",
  );
  assert.ok(src.includes(`"${INGEST_SIG_HEADER}"`), "sig header literal");
  assert.ok(src.includes(`"${INGEST_TS_HEADER}"`), "ts header literal");
  assert.ok(src.includes("${ts}.${raw}"), "timestamp-bound message shape");
  assert.ok(src.includes("HUB_INGEST_SECRET"), "shared secret env name");
  assert.ok(src.includes("/api/health?stats=1"), "the stats poll target");
  assert.ok(src.includes("x-stats-token"), "the F2.9 stats-token header");
  assert.ok(src.includes("15 * 60 * 1000"), "the 15-min forward cadence");
  assert.ok(/HMAC[\s\S]{0,60}SHA-256/.test(src), "HMAC-SHA256 via crypto.subtle");
});

// ── Grep gate (the vault.test.ts precedent): the ingest secret flows through
// these modules — none may console-log. ───────────────────────────────────────
test("hmac: grep gate — no console.* in heartbeat-hmac.ts or ingest-gate.ts", () => {
  for (const rel of ["./heartbeat-hmac.ts", "./ingest-gate.ts"]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.ok(!/\bconsole\s*\./.test(src), `${rel} must never log (secret flows through)`);
  }
});
