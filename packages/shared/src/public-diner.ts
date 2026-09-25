// CB-4 — the diner ACCOUNT + stamp-loyalty contract, shared by the cafe
// runtime's public routes, its staff-side settings UI, and the diner surface.
// Split out of `public.ts` (which sits at this repo's ~300-line budget) rather
// than grown there; `public.ts` keeps the ORDER contract, this file keeps the
// IDENTITY + REWARD contract.
//
// Nothing here touches money units. The one money comparison this feature
// makes (`minBillForStamp` vs an order total) happens in the cafe app against
// the v1 RUPEE `models/Order.ts` — see LOYALTY_MIN_BILL_* below.

// ── Diner session cookie ────────────────────────────────────────────────────
// An OPAQUE handle, never a signed stateless claim. The whole recovery story
// for a forgotten PIN is "staff reset it at the counter" (no OTP — the phase
// brief's cost decision), and a reset MUST kill every live session for that
// mobile instantly. A stateless token cannot be revoked before it expires, so
// the handle is looked up server-side on every use.
export const DINER_COOKIE_NAME = "pos_diner";

// 24 chars over public.ts's 32-symbol alphabet = 120 bits. Longer than a table
// token (14) because a table token is printed on a sticker and rate-limited by
// the routes that resolve it, whereas this value IS the bearer of an account.
export const DINER_SESSION_TOKEN_LENGTH = 24;

// 30 days, matching the staff session's own rolling window (CB-U1) so a cafe
// never has to explain two different "you were signed out" behaviours.
export const DINER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// ── Diner PIN ───────────────────────────────────────────────────────────────
// 4 digits: the length a diner will actually accept at a counter. 10,000
// combinations is NOT secure on its own — the rate limits below are what make
// it safe, and they are a correctness requirement, not a nicety.
export const DINER_PIN_LENGTH = 4;
export const DINER_PIN_PATTERN = /^[0-9]{4}$/;

// Rejected at SET time. These few values cover a wildly disproportionate share
// of real-world 4-digit choices, so refusing them buys more than any rate
// limit: an attacker's first guesses are exactly this list.
export const DINER_PIN_BANNED = [
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "0123", "1122", "2580", "1212",
] as const;

export function isBannedDinerPin(pin: string): boolean {
  return (DINER_PIN_BANNED as readonly string[]).includes(pin);
}

export function isValidDinerPin(value: unknown): value is string {
  return typeof value === "string" && DINER_PIN_PATTERN.test(value);
}

// ── PIN rate limiting ───────────────────────────────────────────────────────
// TWO buckets, because there are two genuinely different attacks and a single
// bucket fails one of them:
//   A. VERTICAL — brute-force ONE known mobile's PIN (10,000 combos).
//   B. HORIZONTAL — spray one popular PIN across many mobiles, or probe which
//      mobiles even have accounts.
// The window is public.ts's PUBLIC_ORDER_RATE_WINDOW_MS (600s) reused verbatim
// so `pruneRateWindows` already reaps these rows with no new cleanup code.
//
// Keyed on the MOBILE first, never on IP alone: a cafe's diners all exit
// through ONE WiFi egress, so an IP-keyed limit would either starve the whole
// room over one attacker or (behind CGNAT) do nothing. This is the same
// reasoning already written into the public order-request route's step 7.
export const DINER_PIN_BUCKET_PREFIX = "dinerpin:";
export const DINER_PIN_RATE_MAX = 5;

// The SECONDARY, deliberately loose ceiling on enumeration. Loose on purpose:
// it is keyed on a shared egress, so it must never be tight enough to lock a
// busy cafe out of its own accounts.
export const DINER_SOURCE_BUCKET_PREFIX = "dinersrc:";
export const DINER_SOURCE_RATE_MAX = 25;

// GET /api/public/diner/me is a READ, but an uncached one: it costs two DB
// round-trips (the session row + the customer) on a 512MB M0, on a route with
// no session required to call it. So it gets its own bucket — generous enough
// that a real diner never meets it (the shell calls this once per page load
// plus once per sign-in), tight enough that it cannot be used to hammer Mongo.
// Keyed on the SESSION TOKEN when there is one, falling back to the source, so
// one diner's polling can never spend another diner's budget.
export const DINER_ME_BUCKET_PREFIX = "dinerme:";
export const DINER_ME_RATE_MAX = 60;

export function dinerPinBucket(normalizedMobile: string): string {
  return `${DINER_PIN_BUCKET_PREFIX}${normalizedMobile}`;
}

export function dinerMeBucket(key: string): string {
  return `${DINER_ME_BUCKET_PREFIX}${key}`;
}

export function dinerSourceBucket(sourceKey: string): string {
  return `${DINER_SOURCE_BUCKET_PREFIX}${sourceKey}`;
}

// ── Diner-facing copy ───────────────────────────────────────────────────────
// ONE message for "no such mobile" AND "wrong PIN". Telling them apart would
// turn this route into an oracle for which mobile numbers hold an account at
// this cafe. The route additionally spends the SAME bcrypt work on both paths
// so the two cannot be told apart by timing either.
export const DINER_LOGIN_FAILED = "That mobile number and PIN don't match.";
export const DINER_LOGIN_RATE_LIMITED =
  "Too many tries. Wait a few minutes, or ask at the counter to reset your PIN.";
export const DINER_PIN_WEAK = "Pick a different 4 digits — that one is too easy to guess.";
export const DINER_PIN_SHAPE = "Your PIN must be exactly 4 digits.";
export const DINER_SESSION_REQUIRED = "Please sign in to see this.";

// ── Stamp loyalty ───────────────────────────────────────────────────────────
// The owner configures four things (the phase brief's §F), every one of them
// pre-filled with a safe default so a non-technical owner never faces a blank
// box. 8 is the industry sweet spot (6-10) and the #1 small-owner mistake is
// setting the target too high, so the DEFAULT must be safe, not ambitious.
export const LOYALTY_STAMPS_DEFAULT = 8;
export const LOYALTY_STAMPS_MIN = 2;
export const LOYALTY_STAMPS_MAX = 30;

// RUPEES — not paise. The earn site compares this against the v1
// `models/Order.ts` total, which is a plain `Number` in rupees. (The Int32
// paise shape lives in `models/order.ledger.ts` and the settle route never
// imports it.) When P5's Customer v:2 paise migration lands, this comparison
// flips WITH it — do not "fix" the unit before that migration.
export const LOYALTY_MIN_BILL_DEFAULT = 100;
export const LOYALTY_MIN_BILL_MIN = 0;
export const LOYALTY_MIN_BILL_MAX = 100_000;

// What the completed card is worth. Deliberately its OWN enum, NOT a reuse of
// public-promo.ts's PROMO_KINDS (which is ["percent","flat"] and has no
// free-item concept): reusing an enum across opposite semantics is how a
// sentinel ends up meaning two things.
//
// CB-5B D8 (owner, 2026-09-13) CHANGED what "item" carries. It used to be a
// free-text name the staff honoured by eye, which needed no product link.
// It is now a PRODUCT REFERENCE (`itemProductId`) picked from the menu, with
// `item` demoted to a display-only NAME SNAPSHOT of that product at config
// time. The reason is not cosmetic: D5's reversal puts the free dish on the
// bill AND on the KOT at its real price, so the server has to resolve an
// actual Product row — and resolving by name breaks the moment a dish is
// renamed, deleted, or shares its name with another (the closed-enum-to-
// free-text hazard). CB-7's product-scoped discount needs the same reference.
export const LOYALTY_REWARD_KINDS = ["flat", "percent", "item"] as const;
export type LoyaltyRewardKind = (typeof LOYALTY_REWARD_KINDS)[number];

export const LOYALTY_REWARD_KIND_DEFAULT: LoyaltyRewardKind = "flat";
export const LOYALTY_REWARD_VALUE_DEFAULT = 50;
export const LOYALTY_REWARD_PERCENT_MAX = 100;
export const LOYALTY_REWARD_FLAT_MAX = 100_000;
export const LOYALTY_REWARD_ITEM_MAX_LEN = 60;

// CB-5B D11 (owner, 2026-09-13) — how many of the free dish ONE claim grants.
// The ladder had no qty at all and the builder hardcoded 1; the owner chose a
// configurable count instead. ABSENT means 1 (every pre-D11 row stored on a
// live cafe has no qty key), so the default is the identity, never 0.
export const LOYALTY_REWARD_QTY_DEFAULT = 1;
export const LOYALTY_REWARD_QTY_MIN = 1;
export const LOYALTY_REWARD_QTY_MAX = 10;

// A Mongo ObjectId as it travels over JSON: 24 lowercase hex characters. The
// milestone's product reference is validated against this rather than a bare
// non-empty string, so a malformed ref is refused at the settings boundary
// instead of failing later at resolve time on a real bill.
export const LOYALTY_REWARD_PRODUCT_ID_RE = /^[0-9a-f]{24}$/;

// How many earned-stamp order markers a Customer keeps. Mirrors
// APPLIED_ORDERS_MAX's own reasoning in lib/customer-rollup.ts: the horizon
// only has to outlive a duplicate-apply window, not the customer's lifetime.
export const LOYALTY_STAMP_ORDERS_MAX = 200;

// A reward is ISSUED at a cost, and that cost is STORED on the issued row —
// never re-derived from the live setting. If an owner later changes
// stampsPerReward from 8 to 5, a diner who already spent an 8-stamp reward
// must not have their balance retroactively rewritten.
export function stampsRemaining(stamps: number, stampsPerReward: number): number {
  if (stampsPerReward <= 0) return 0;
  return Math.max(0, stampsPerReward - (stamps % stampsPerReward));
}

export function rewardsAvailable(stamps: number, stampsPerReward: number): number {
  if (stampsPerReward <= 0) return 0;
  return Math.floor(stamps / stampsPerReward);
}

// ── CB-6C — owner-written banners on the diner Home tab ─────────────────────
// Settings.dinerBanners (Zod: schemas/settings-diner.schema.ts; Mongoose:
// apps/cafe/models/settings.subschemas.ts). Title + one line of body, at most
// DINER_BANNER_MAX — a phone-width carousel, not a CMS. Plain text only: the
// diner surface renders data as text nodes, never markup.
export const DINER_BANNER_MAX = 3;
export const DINER_BANNER_TITLE_MAX_LEN = 40;
export const DINER_BANNER_BODY_MAX_LEN = 90;

export interface PublicDinerBanner {
  title: string;
  body: string;
}

// The READ-side normaliser the /m server pages run the stored value through
// (lib/public-diner-config.ts): accepts `unknown` because a lean Settings doc
// may predate the field or carry a shape an older admin bundle wrote. Trims,
// drops rows with no title, clamps both lengths, caps the count, and returns
// FRESH objects — never the stored array or its rows — so a caller can never
// mutate the cached settings document through this value.
export function publicDinerBanners(raw: unknown): PublicDinerBanner[] {
  if (!Array.isArray(raw)) return [];
  const banners: PublicDinerBanner[] = [];
  for (const entry of raw) {
    if (banners.length === DINER_BANNER_MAX) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { title, body } = entry as { title?: unknown; body?: unknown };
    if (typeof title !== "string") continue;
    const cleanTitle = title.trim().slice(0, DINER_BANNER_TITLE_MAX_LEN);
    if (cleanTitle.length === 0) continue;
    const cleanBody = typeof body === "string" ? body.trim().slice(0, DINER_BANNER_BODY_MAX_LEN) : "";
    banners.push({ title: cleanTitle, body: cleanBody });
  }
  return banners;
}
