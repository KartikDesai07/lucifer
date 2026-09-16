import bcrypt from "bcryptjs";

import { normalizePublicMobile } from "@pos/shared/public";
import {
  DINER_PIN_RATE_MAX,
  DINER_SOURCE_RATE_MAX,
  dinerPinBucket,
  dinerSourceBucket,
  isBannedDinerPin,
  isValidDinerPin,
} from "@pos/shared/public-diner";
import { BCRYPT_ROUNDS } from "@/lib/constants";
import { Customer } from "@/models/Customer";
import { hitRateLimit } from "@/lib/public-rate-limit";

// CB-4 — diner PIN verification. A 4-digit PIN is 10,000 combinations, so the
// rate limits below are a CORRECTNESS requirement, not a hardening nicety, and
// they live here rather than at the route so no future caller can skip them.

// A real bcrypt hash of a value no diner can enter (the PIN shape is exactly 4
// digits). Compared against whenever there is no stored hash to compare with,
// so "no such mobile" and "wrong PIN" cost the SAME ~250ms of bcrypt work.
// Without this, the two are trivially told apart by latency (~5ms vs ~250ms),
// which turns this route into an oracle for which mobile numbers hold an
// account at this cafe. Computed once at module load, never per request.
const DUMMY_PIN_HASH = bcrypt.hashSync("no-such-account", BCRYPT_ROUNDS);

export type DinerPinResult =
  | { ok: true; customerId: string; mobile: string; name: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate-limited"; retryAfterSec: number };

export async function hashDinerPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

export type DinerPinShapeError = "shape" | "weak" | null;

// Shape + strength, in the order the diner should hear about them. Used by
// BOTH the diner's own set-PIN path and the staff counter reset, so the two can
// never drift on what counts as an acceptable PIN.
export function checkDinerPinShape(pin: unknown): DinerPinShapeError {
  if (!isValidDinerPin(pin)) return "shape";
  if (isBannedDinerPin(pin)) return "weak";
  return null;
}

/**
 * Verify a mobile + PIN, metered against BOTH rate-limit buckets.
 *
 * TWO buckets because there are two genuinely different attacks:
 *   A. VERTICAL — brute-forcing ONE known mobile's PIN. Fenced by the
 *      per-mobile bucket (tight: DINER_PIN_RATE_MAX per window).
 *   B. HORIZONTAL — spraying one popular PIN across many mobiles, or probing
 *      which mobiles even have an account. Fenced by the per-source bucket
 *      (deliberately loose: a cafe's diners all share ONE WiFi egress, so a
 *      tight source limit would lock the whole room out — the same reasoning
 *      already written into the public order-request route's step 7).
 *
 * The per-mobile bucket is charged FIRST and on EVERY attempt including ones
 * that fail on shape, so an attacker cannot probe for free by sending a
 * malformed PIN. Both buckets are charged before any DB read of the customer.
 */
export async function verifyDinerPin(
  rawMobile: string,
  pin: string,
  sourceKey: string,
  now: number = Date.now(),
): Promise<DinerPinResult> {
  const mobile = normalizePublicMobile(rawMobile);

  const perMobile = await hitRateLimit(dinerPinBucket(mobile), DINER_PIN_RATE_MAX, now);
  if (!perMobile.allowed) {
    return { ok: false, reason: "rate-limited", retryAfterSec: perMobile.retryAfterSec };
  }
  const perSource = await hitRateLimit(dinerSourceBucket(sourceKey), DINER_SOURCE_RATE_MAX, now);
  if (!perSource.allowed) {
    return { ok: false, reason: "rate-limited", retryAfterSec: perSource.retryAfterSec };
  }

  // `+pinHash` — the field is `select: false` on the schema (the Staff.password
  // discipline), so it has to be asked for explicitly. This is the ONLY place
  // in the app that does so.
  const customer = await Customer.findOne({ mobile }).select("+pinHash name mobile").lean();

  // Unconditional compare, even with no customer and no stored hash: the
  // dummy-hash branch is what makes "no such mobile" indistinguishable from
  // "wrong PIN" by TIMING as well as by response shape. Never short-circuit
  // this, and never return early above it.
  const storedHash = customer?.pinHash ?? DUMMY_PIN_HASH;
  const matches = await bcrypt.compare(pin, storedHash);

  if (!customer || !customer.pinHash || !matches) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    customerId: String(customer._id),
    mobile: customer.mobile,
    name: customer.name,
  };
}
