import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  INGEST_TS_TOLERANCE_S,
  ingestMessageToSign,
} from "@pos/shared/heartbeat";

// ─────────────────────────────────────────────────────────────────────────────
// F3.7 — the ingest HMAC (PURE; no IO). The CF Worker signs `${ts}.${rawBody}`
// with the platform-wide HUB_INGEST_SECRET (its own `wrangler secret`; the
// Worker mirrors this scheme with crypto.subtle — the parity test in
// heartbeat-hmac.test.ts pins the literals in the Worker source). Verification
// is FAIL-CLOSED: an unset secret refuses everything (503 at the route), never
// falls open. Timestamp binding bounds replay to ±INGEST_TS_TOLERANCE_S.
//
// No-console gate (eslint override + scan test): the shared secret flows
// through both functions.
// ─────────────────────────────────────────────────────────────────────────────

export type IngestVerifyResult =
  | { ok: true }
  | { ok: false; reason: "no-secret" | "missing-headers" | "stale-ts" | "bad-signature" };

/** Lowercase-hex HMAC-SHA256 over the timestamp-bound message. Exported for the
 *  live-verify script + tests (the Worker has its own crypto.subtle mirror). */
export function signIngest(secret: string, tsSeconds: string, rawBody: string): string {
  return createHmac("sha256", secret)
    .update(ingestMessageToSign(tsSeconds, rawBody))
    .digest("hex");
}

/** Constant-time string compare — hash both sides first so `timingSafeEqual`
 *  is length-safe (the statsTokenMatches precedent in the cafe runtime). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Strict unix-seconds parse: decimal digits only (no floats, hex, signs). */
function parseTsSeconds(ts: string): number | null {
  if (!/^\d{1,12}$/.test(ts)) return null;
  return Number(ts);
}

/**
 * Verify a forwarded heartbeat. `tsHeader`/`sigHeader` are the raw header
 * values (null when absent); `rawBody` MUST be the exact bytes-as-text the
 * signature was computed over (verify BEFORE JSON.parse). The check order is
 * deliberate: secret presence → header presence → timestamp window → signature,
 * so an attacker learns nothing beyond "unauthorized" (the route maps every
 * failure except no-secret to one terse 401).
 */
export function verifyIngest(
  secret: string | undefined,
  tsHeader: string | null,
  sigHeader: string | null,
  rawBody: string,
  nowMs: number,
): IngestVerifyResult {
  if (!secret) return { ok: false, reason: "no-secret" };
  if (!tsHeader || !sigHeader) return { ok: false, reason: "missing-headers" };

  const ts = parseTsSeconds(tsHeader);
  if (ts === null || Math.abs(nowMs / 1000 - ts) > INGEST_TS_TOLERANCE_S) {
    return { ok: false, reason: "stale-ts" };
  }

  const expected = signIngest(secret, tsHeader, rawBody);
  if (!safeEqual(expected, sigHeader.toLowerCase())) {
    return { ok: false, reason: "bad-signature" };
  }
  return { ok: true };
}
