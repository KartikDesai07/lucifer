// Promo codes (CR2.2c, phase-CR2-public-ordering.md §17.E) — split out of
// public.ts only to keep that file under this repo's ~300-line budget; no
// semantic change. Pure and client-safe, same as public.ts.

// ── Promo codes (CR2.2c, phase-CR2-public-ordering.md §17.E) ───────────────
// Embedded on Settings (no new collection) — a cafe configures up to
// PROMO_CODE_MAX named codes, staff-facing only until a diner types one in.
export const PROMO_CODE_MAX = 20; // codes per cafe
export const PROMO_CODE_PATTERN = /^[A-Z0-9]{3,16}$/; // stored UPPERCASE

export const PROMO_KINDS = ["percent", "flat"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export interface PromoCodeConfig {
  code: string; // uppercase, unique within the array
  label?: string; // optional human note, staff-facing only
  kind: PromoKind;
  value: number; // percent: 1..100 · flat: a money amount > 0
  minSubtotal?: number; // gate compared against the SUBTOTAL (pre-charge, pre-GST)
  active: boolean;
  // SPEC P4 (CR2.2c follow-up) — absent/false = unlimited (today's behavior).
  // true = one MOBILE NUMBER may have this code on at most ONE accepted order,
  // ever. "Customer" = the normalized mobile on the request — the only
  // identity a public (unauthenticated) surface has. Enforced by
  // models/PromoRedemption.ts's unique {code,mobile} index (the fence) plus a
  // quote-time courtesy check ahead of it — resolvePromoDiscount itself stays
  // DB-free and only reports the flag back to its callers.
  oncePerCustomer?: boolean;
}

export const PROMO_INVALID = "That code isn't valid";
// SPEC P4 — the diner-facing copy for BOTH the quote-time courtesy 422 (create
// and edit) and the meaning behind a staff-actionable PROMO_USED_ERROR
// rejection at accept time (lib/order-request-accept-promo.ts).
// The FENCE identity for a once-per-customer code (review MAJOR #2,
// 2026-08-20): normalizePublicMobile deliberately keeps a leading `+`/`0`
// exactly as typed (customer matching must never mangle a number), but a
// MONEY fence keyed on the raw string is defeated by re-typing the same
// number as `+91…` or `0…`. Digits-only, LAST 10 kept: every Indian-format
// variant of one number collapses to one key, and a number long enough to
// carry a country code still keeps its unique subscriber part. Used ONLY for
// PromoRedemption keys — never for storage, matching, or display.
export function canonicalPromoMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export const PROMO_ALREADY_USED = "This code was already used with this mobile number";
// A promo belongs to a table's FIRST order of a session, exactly like the
// table charge — otherwise one "₹500 off" code re-applies to every round and
// the whole tab walks out free (review 2026-08-20). The gate is SERVER-side;
// the client hiding the control is a courtesy, never the defence.
export const PROMO_SESSION_OPEN = "This code works on your first order — ask the staff about this one";
export const PROMO_INACTIVE = "That code is no longer active";
export const PROMO_MIN_SUBTOTAL = (short: number) => `Add ₹${short} more to use this code`;

// trim + uppercase — the ONE normalization a code goes through before it's
// ever compared or stored, so "save10", " SAVE10 " and "SAVE10" all resolve
// to the same row.
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

// The ONE place a code becomes money — a diner never sends or sees an
// amount (client money must encode INTENT), so this is what turns their
// typed CODE into a FLAT discount the shared computeOrderTotals({discount})
// contract already knows how to apply. Percent FLOORS (never rounds up — the
// cafe must never give away more than it configured) and the result is
// CLAMPED to `subtotal` so a total can never go negative. Prototype-safe by
// construction: `codes` is searched via Array.prototype.find, never a keyed
// object lookup, so a code literally named "constructor" (or any other
// Object.prototype key) is judged purely by array membership.
export function resolvePromoDiscount(
  codes: PromoCodeConfig[] | undefined,
  rawCode: string,
  subtotal: number,
): { discount: number; code: string; oncePerCustomer?: boolean } | { error: string } {
  const code = normalizePromoCode(rawCode);
  const match = (codes ?? []).find((c) => c.code === code);
  if (!match) return { error: PROMO_INVALID };
  if (match.active === false) return { error: PROMO_INACTIVE };
  if (match.minSubtotal !== undefined && subtotal < match.minSubtotal) {
    return { error: PROMO_MIN_SUBTOTAL(match.minSubtotal - subtotal) };
  }
  const raw = match.kind === "percent" ? Math.floor((subtotal * match.value) / 100) : match.value;
  // Omit-empty (SPEC P4): callers that never configured `oncePerCustomer`
  // (or set it false) get a result shaped exactly like before this feature —
  // no key at all, never an explicit `false`.
  return {
    discount: Math.min(raw, subtotal),
    code,
    ...(match.oncePerCustomer ? { oncePerCustomer: true } : {}),
  };
}
