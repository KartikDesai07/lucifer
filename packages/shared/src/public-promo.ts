// Promo codes (CR2.2c, phase-CR2-public-ordering.md §17.E) — split out of
// public.ts only to keep that file under this repo's ~300-line budget; no
// semantic change. Pure and client-safe, same as public.ts.

// ── Promo codes (CR2.2c, phase-CR2-public-ordering.md §17.E) ───────────────
// Embedded on Settings (no new collection) — a cafe configures up to
// PROMO_CODE_MAX named codes, staff-facing only until a diner types one in.
export const PROMO_CODE_MAX = 20; // codes per cafe
export const PROMO_CODE_PATTERN = /^[A-Z0-9]{3,16}$/; // stored UPPERCASE

// CB-5D — the box's three options (discount / item / amount) all map onto one
// promo kind enum: "percent" and "flat" ARE the two discount/amount shapes,
// and "item" is additive so every stored percent/flat code keeps validating
// and resolving exactly as before (closed-enum widening must narrow nothing).
export const PROMO_KINDS = ["percent", "flat", "item"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export interface PromoCodeConfig {
  code: string; // uppercase, unique within the array
  label?: string; // optional human note, staff-facing only
  kind: PromoKind;
  value: number; // percent: 1..100 · flat: a money amount > 0 · item: unused
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
  // CB-5D — a kind:"item" code's free dish, same D8 shape as the loyalty
  // milestone's own item rung (loyalty-rules.ts's LoyaltyMilestoneLike):
  // `itemProductId` is the REAL reference the server resolves the free line
  // from; `item` is a display-only NAME SNAPSHOT taken when the code was
  // configured, so the promo list still reads correctly without a menu
  // lookup. Both OPTIONAL — every stored code predates them, and only an
  // "item" code ever carries them.
  itemProductId?: string;
  item?: string;
  // CB-5D — how many of that dish one use of the code grants. Absent means
  // one, mirroring the milestone's own qty default (LOYALTY_REWARD_QTY_DEFAULT).
  qty?: number;
  // CB-5D — how many days an ASSIGNED (claimed) code stays usable, counted
  // from the moment it is assigned to a customer — never from when it was
  // configured. Absent = no expiry (today's behavior for every existing
  // code). Pure day math only; see `promoExpiryFrom` below — the SERVER is
  // what enforces the deadline (a client-only money gate is not a gate).
  validDays?: number;
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

// ── CB-5B S8 — diner-facing reward-claim refusals ──────────────────────────
// SINGLE-HOMED HERE deliberately. Two consumers need the exact same strings
// and cannot import each other: the SERVER gate (apps/cafe/lib/
// order-request-reward.ts) pulls in Mongoose, and the CLIENT classifier
// (components/public/public-submit.ts) is bundled onto a diner's phone. This
// package is the one place both may import from, so the copy lives here
// instead of being hand-copied into both — a wording change on a money path
// must never be able to land on one side only.
//
// Plain English per this repo's UI-copy rule (Hinglish is chat-only), and
// each one says what the diner can DO about it.
export const REWARD_NEEDS_SIGN_IN = "Sign in to use your stamps for a reward";
export const REWARD_NOT_ON_CARD = "That reward is no longer on the loyalty card";
export const REWARD_NOT_ENOUGH_STAMPS = "You do not have enough stamps for that reward yet";
export const REWARD_BILL_TOO_SMALL = "This order is too small for that reward";
export const REWARD_PROMO_EXCLUSIVE =
  "Use either a promo code or a stamp reward on one order, not both";
// A reward can only be claimed when the order OPENS a bill. Once a table has
// a bill running, an accepted request adds a round to it, and a round cannot
// carry its own reward — the bill has one discount and one reason for it.
// Told to the diner at submit, because the accept path silently drops it.
export const REWARD_ON_OPEN_TAB =
  "Ask the counter to add a reward to your running bill";
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
  // CB-5D part 2 FINAL — codes MINTED by a loyalty milestone (owner decision,
  // 2026-09-15): "code sirf usi customer ka, ek baar" — a minted reward code
  // is inherently single-use, whether or not the owner remembered to tick
  // `oncePerCustomer` on its Settings row. Optional and trailing so every
  // existing caller keeps compiling unchanged; absent = today's behaviour
  // exactly (the tick alone decides). Build this with `mintedPromoCodes`
  // (loyalty-rules.ts); compared NORMALIZED below regardless, so a
  // differently-cased/spaced entry still matches.
  mintedCodes?: ReadonlySet<string> | readonly string[],
): { discount: number; code: string; kind: PromoKind; oncePerCustomer?: boolean } | { error: string } {
  const code = normalizePromoCode(rawCode);
  const match = (codes ?? []).find((c) => c.code === code);
  if (!match) return { error: PROMO_INVALID };
  if (match.active === false) return { error: PROMO_INACTIVE };
  if (match.minSubtotal !== undefined && subtotal < match.minSubtotal) {
    return { error: PROMO_MIN_SUBTOTAL(match.minSubtotal - subtotal) };
  }
  // CB-5D — an "item" code's benefit is the free LINE itself, never rupees
  // off (the same single-skip discipline as a reward item, lib/receipt.ts):
  // it resolves to 0 discount and must NOT be rejected as invalid — a diner
  // applying it sees the code accepted, the bill total simply does not move
  // by this path (the free line is what removes the dish's own price).
  const raw =
    match.kind === "item" ? 0 : match.kind === "percent" ? Math.floor((subtotal * match.value) / 100) : match.value;
  // CB-5D part 2 FINAL — a minted code is single-use REGARDLESS of the row's
  // own tick. `mintedCodes` is expected pre-normalized (mintedPromoCodes
  // already runs normalizePromoCode), but this re-normalizes each entry
  // anyway — a defensive membership test costs nothing at this array size
  // and means a future caller who forgets to pre-normalize fails safe
  // (single-use) rather than silently missing the fence. Spread to a plain
  // array up front (works for both the Set and array shapes of the param)
  // so the membership test below is a single expression, not a branch.
  const mintedList: readonly string[] = mintedCodes === undefined ? [] : [...mintedCodes];
  const minted = mintedList.some((m) => normalizePromoCode(m) === code);
  // Omit-empty (SPEC P4): callers that never configured `oncePerCustomer`
  // (or set it false) AND whose code isn't milestone-minted get a result
  // shaped exactly like before this feature — no key at all, never an
  // explicit `false`.
  return {
    discount: Math.min(raw, subtotal),
    code,
    // CB-5D — the resolved KIND travels with the amount. A caller deciding
    // whether a fence must be burned cannot infer it from `discount` alone:
    // an "item" promo is worth 0 by construction, and so is a percent promo
    // floored to nothing on a tiny bill, but only the first is a real benefit
    // that must be spent once.
    kind: match.kind,
    ...(match.oncePerCustomer || minted ? { oncePerCustomer: true } : {}),
  };
}

// CB-5D — one day, in milliseconds. Local to this module (utils.ts's own
// ONE_DAY_MS is unexported and this file must not reach across for it) — a
// named constant so the day math below is never a bare magic number.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// CB-5D — the ONE place an assigned code's expiry timestamp is computed, so
// no caller re-rolls this date math. `validDays` is whole days counted from
// the moment of ASSIGNMENT (claim), never from when the code was configured.
// Pure and client-safe: it is used to SHOW an expiry, but the SERVER is what
// enforces it at claim/use time — a client-only money gate is not a gate.
// Returns null for "never expires" (validDays absent), matching every
// existing code's behavior today.
export function promoExpiryFrom(assignedAtMs: number, validDays: number | undefined): number | null {
  if (validDays === undefined) return null;
  return assignedAtMs + validDays * ONE_DAY_MS;
}

// CB-5D part 2 — the two deadline PREDICATES. Both are pure and take `now`
// as an argument (the house convention: diner-pin.ts, diner-session.ts,
// order-request-accept-core.ts all inject it), so a test can drive a deadline
// without touching the clock and so the SERVER is always the one deciding —
// a client-only money gate is not a gate.

/** Has an ASSIGNED code passed its own expiry? `expiresAt` absent/null means
 *  "never expires" (the code carried no validDays), which is every code that
 *  predates this feature. Boundary: a code expiring exactly NOW is still
 *  usable — the deadline is the last usable instant, not the first dead one,
 *  which is the reading a diner gets from "valid for N days". */
export function isAssignedRewardExpired(expiresAtMs: number | null | undefined, now: number): boolean {
  if (expiresAtMs == null) return false;
  return now > expiresAtMs;
}

/** Has the window to CLAIM an earned rung closed? Distinct from the above:
 *  this one runs BEFORE a code is ever assigned, counted from when the rung
 *  was EARNED. `earnedAtMs` absent means the rung's earn moment was never
 *  recorded — every customer who crossed a rung before this feature shipped —
 *  and an unrecorded earn time can never be a reason to refuse a claim, so it
 *  reads as "no deadline" rather than as an expired one. `claimWithinDays`
 *  absent/null is likewise "no deadline" (today's behaviour for every rung). */
export function isRungClaimWindowClosed(
  earnedAtMs: number | null | undefined,
  claimWithinDays: number | null | undefined,
  now: number,
): boolean {
  if (claimWithinDays == null || earnedAtMs == null) return false;
  return now > earnedAtMs + claimWithinDays * ONE_DAY_MS;
}

// CB-5D part 2 — the two diner-facing deadline refusals. Plain English, and
// each says what the diner can still DO, matching every constant above.
export const REWARD_CLAIM_WINDOW_CLOSED =
  "The time to claim that reward has passed — keep collecting for the next one";
export const PROMO_EXPIRED = "That code has expired";
