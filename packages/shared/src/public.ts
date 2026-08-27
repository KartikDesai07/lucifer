// Contracts for the PUBLIC (unauthenticated) QR-ordering surface — phase CR2.
// Pure and client-safe: the diner's menu page bundles this, so nothing here may
// reach for Mongoose, Node APIs or anything server-only.
//
// Lives in its own module rather than in constants.ts, which is already at this
// repo's ~300-line file budget.

import { TABLE_CHARGE_MAX } from "./constants";

// ── The table token ─────────────────────────────────────────────────────────
// A table's PUBLIC identity, printed into its QR sticker. Deliberately NOT the
// `tableNo`: that is operator-chosen text ("T-1", "Table 2"), sequential and
// trivially guessable, so a tableNo in a public URL would let any diner walk
// their neighbours' URLs — spamming every table at once, or reading a table's
// live state. The token is opaque and carries no meaning at all.
//
// Crockford-style base32 alphabet: no I, L, O or U, so a token can be read off a
// sticker and typed by a human without the 1/I/l and 0/O confusions, and it can
// never accidentally spell a word. Lower case is never produced; a lookup is
// case-sensitive, so what the QR encodes is what must arrive.
export const PUBLIC_TOKEN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// 14 chars over a 32-symbol alphabet = 70 bits. Sized for a printed sticker that
// must stay valid for years and can never be rate-limit-protected before it is
// resolved: brute-forcing one live table out of that space is not a threat, and
// 14 characters still fits under a QR code at sticker size.
export const PUBLIC_TOKEN_LENGTH = 14;

export const PUBLIC_TOKEN_PATTERN = /^[0-9A-HJKMNP-TV-Z]{14}$/;

// The token arrives as a URL path segment, so it is validated before it is ever
// used in a query. Shape only — that a token maps to a real table is a live
// lookup in the route layer (the same discipline as tableNo since CR1.1).
export function isPublicToken(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_TOKEN_PATTERN.test(value);
}

// ── Public paths ────────────────────────────────────────────────────────────
// The diner's menu. One tenant per deployment (the host resolves the cafe), so
// unlike the products we researched there is no restaurant slug to carry.
//   /m            → no table: the diner picks a table, or Parcel
//   /m/<token>    → that table, resolved server-side from the token alone
export const PUBLIC_MENU_PATH = "/m";

// Every public API route sits under this prefix so the middleware matcher, the
// CSP and any WAF rule can name the public surface in one piece.
export const PUBLIC_API_PREFIX = "/api/public";

// Vercel BotID serves its browser challenge (c.js / p.js and their telemetry
// calls) from this well-known same-origin prefix via the proxy rewrites
// withBotId() installs. The prefix is BotID's own fixed integration id (the
// same value Vercel's docs use), NOT ours to choose. It MUST be exempt from
// the auth middleware: Next.js runs middleware BEFORE rewrites, so without
// the exemption every anonymous diner's challenge request 307s to /login —
// the script never loads, and the protected order POST hangs or fails on
// exactly the devices with no panel session cookie (field bug 2026-08-20:
// "works on my logged-in laptop, breaks on the customer's phone").
export const BOTID_CLIENT_PATH_PREFIX = "/149e9513-01fa-4fb0-aad4-566afd725d1b/";

export function publicMenuPath(token?: string): string {
  return token ? `${PUBLIC_MENU_PATH}/${token}` : PUBLIC_MENU_PATH;
}

// ── Parcel ──────────────────────────────────────────────────────────────────
// A walk-in collecting a parcel uses the same menu with no table. An accepted
// parcel order carries NO tableNo — which is exactly what the POS already calls
// Walk-In — so no table is claimed and no table charge applies. This sentinel is
// a UI/route-level choice only and is NEVER stored on an order.
export const PARCEL_SELECTION = "parcel";

// Free-text hardening (PUBLIC_NOTE_MAX_LEN/PUBLIC_NAME_MAX_LEN, sanitizePublicText)
// lives in ./public-text — split only for the ~300-line file cap, no semantic change.
export * from "./public-text";

// ── Pricing ──────────────────────────────────────────────────────────────────
// A diner never sends or sees a price at request time — the public order route
// derives it from the live product, at this exact formula. SINGLE source of
// truth (not duplicated, despite an older comment here once claiming
// otherwise): apps/cafe/hooks/use-cart.ts's effectivePrice imports this
// directly, as do components/public/PublicMenuItem.tsx's price display and
// lib/public-pricing.ts's derivedLinePrice — every consumer of "product price
// minus discount" shares this one implementation.
export function effectiveUnitPrice(price: number, discount: number): number {
  return Math.max(0, Math.round(price - (price * discount) / 100));
}

// ── Cart totals (diner display) ─────────────────────────────────────────────
// The diner-display twin of apps/cafe/lib/receipt.ts's computeOrderTotals —
// used by the public menu/cart UI to show a total that matches what the
// kitchen will actually bill, WITHOUT importing that server-only module (it
// pulls in Mongoose-adjacent types this package must never bundle). Narrowed
// to the one case a diner's cart can ever be in: zero discount (a diner never
// applies one — that stays staff-only, see lib/order-request-intake.ts's
// buildRequestDoc). Mirrors computeOrderTotals EXACTLY for that case: the
// charge rides untaxed on top of the (GST-inclusive) bill, and both the
// subtotal and the charge round/clamp the same way. The cafe-side parity test
// (apps/cafe/lib/public-hardening-paths.test.ts) is the drift fence — keep
// both in lockstep by hand.
export interface PublicGstConfig {
  enabled: boolean;
  rate: number;
  mode: "inclusive" | "exclusive";
}

export function publicCartTotals(
  subtotal: number,
  charge: number,
  gst: PublicGstConfig,
): { gstAmount: number; total: number } {
  const base = Math.round(subtotal);
  // Inclusive/disabled: tax is either already in the price or not charged at
  // all — either way nothing is ADDED here. Exclusive: computed on the base
  // only, never on the charge (receipt.ts's own rule — a table's cover charge
  // is not taxable).
  const gstAmount =
    gst.enabled && gst.mode === "exclusive" && gst.rate > 0
      ? Math.round((base * gst.rate) / 100)
      : 0;
  const clampedCharge = Math.min(Math.max(0, Math.round(charge)), TABLE_CHARGE_MAX);
  return { gstAmount, total: base + gstAmount + clampedCharge };
}

// ── The order-status code ───────────────────────────────────────────────────
// A SEPARATE opaque identifier from the table token above: the token names a
// TABLE (reusable, printed once), the code names one ORDER (minted per order,
// handed to a diner so they can check status without an account). A shorter
// alphabet-and-length pair is enough here because a code is short-lived (one
// order's lifetime) rather than printed for years like a table sticker.
export const PUBLIC_CODE_LENGTH = 10;

export const PUBLIC_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;

// Deliberately a different length from PUBLIC_TOKEN_PATTERN (14) so the two
// identifiers can never be confused for one another by shape alone: a 10-char
// value always fails isPublicToken, a 14-char value always fails isPublicCode.
export function isPublicCode(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_CODE_PATTERN.test(value);
}

export function publicOrderStatusPath(code: string): string {
  return `/m/o/${encodeURIComponent(code)}`;
}

// ── Diner mobile number ─────────────────────────────────────────────────────
// Kept in lockstep with createCustomerSchema.mobile (customer.schema.ts) by
// hand: staff enter a customer's mobile as free text (min 10 / max 20, no
// pattern — staff are trusted), but a public, unauthenticated route needs a
// shape check too since nothing else stands between a diner and this field.
export const PUBLIC_MOBILE_MIN_LEN = 10;
export const PUBLIC_MOBILE_MAX_LEN = 20;
export const PUBLIC_MOBILE_PATTERN = /^[0-9+][0-9 -]{9,19}$/;

// Matching a diner back to a Customer only works if the SAME digits produce
// the SAME stored string regardless of how the diner happened to type them —
// "98765 43210" and "9876543210" must resolve to one record, not two. Strips
// internal spaces and hyphens ONLY; a leading `+` country prefix is left
// exactly as typed on purpose — this repo has no country-code parsing, and
// guessing one would risk silently mangling a real number rather than just
// leaving it un-normalized.
export function normalizePublicMobile(m: string): string {
  return m.trim().replace(/[ -]/g, "");
}

// ── Order body limits ───────────────────────────────────────────────────────
// Bounds on the shape of one public order request, independent of the rate
// limits below (those bound how MANY requests; these bound how BIG one is).
export const PUBLIC_ORDER_MAX_ITEMS = 30;
export const PUBLIC_ORDER_MAX_QTY = 20;
export const PUBLIC_ORDER_MODIFIER_MAX_LEN = 40;
export const PUBLIC_ORDER_MAX_MODIFIERS = 10;
export const PUBLIC_ORDER_BODY_MAX_BYTES = 16 * 1024;

// ── Public order rate limiting ──────────────────────────────────────────────
// A table is a shared resource (many diners, one QR), so the window is wide
// and the cap generous rather than per-diner-tight. Parcel gets its own,
// higher cap under its own bucket key: unlike a table it has no natural
// identity to key on, so every parcel order in a window shares one bucket and
// would starve under the table-sized cap.
export const PUBLIC_ORDER_RATE_WINDOW_MS = 600_000;
export const PUBLIC_ORDER_RATE_MAX = 8;
export const PUBLIC_ORDER_RATE_MAX_PARCEL = 20;
export const PARCEL_BUCKET_KEY = "parcel";

// PATCH /api/public/order-request/[shortCode] (CR2.2b §17.C) gets its OWN
// bucket (`edit:<shortCode>`, keyed per-request, never per-table) and its own,
// smaller cap — a diner tweaking their own still-pending order a handful of
// times before Save is normal; this is not the wide multi-diner window above.
export const PUBLIC_ORDER_EDIT_RATE_MAX = 10;

// ── Self-order provenance & operator mode ───────────────────────────────────
// Every order placed through this surface is stamped with these so the POS can
// tell a diner-placed order apart from one a staff member rang up, and print
// the correct received-by line.
export const SELF_ORDER_SOURCE = "qr";
export const SELF_ORDER_RECEIVER = "Self-order";

// "approve": every self-order lands as a pending request the staff must accept
// before it reaches the kitchen. "auto": it fires straight through, the same
// as a staff-entered order. A per-cafe Settings toggle, not a constant, because
// a cafe with adequate floor staff wants the first and a QR-only kiosk wants
// the second.
export const SELF_ORDER_MODES = ["approve", "auto"] as const;
export type SelfOrderMode = (typeof SELF_ORDER_MODES)[number];

// ── Public order request wire contracts (CR2.2 SLICE 8) ────────────────────
// The exact shapes POST/GET /api/public/order-request(s) return — pinned here
// so the diner UI (built against this contract, ahead of the routes) and the
// routes (built later, against this SAME type) can never drift. Parity is
// enforced by a test that reads both sides once the routes land.

// Response to POST /api/public/order-request: enough for the diner's
// immediate confirmation screen. `status` is "accepted" only on a cafe whose
// Settings selfOrderMode is "auto" — every other cafe always mints "pending".
export interface PublicOrderRequestCreatedData {
  shortCode: string;
  status: "pending" | "accepted";
  total: number;
  tableLabel: string | null;
  parcel: boolean;
}

// One line of a diner's request, as shown back to them on the status page
// (CR2.2b §17.B — the diner's session view gains its own item lines). Mirrors
// the stored IOrderRequestItem shape, but `productId` is always a STRING
// here (the model's own field is already a string, never a raw ObjectId —
// String(...) at the route is defensive, never a real cast).
export interface PublicStatusItem {
  productId: string;
  name: string;
  price: number; // unit price actually quoted
  qty: number;
  variation?: string; // omit-empty
  modifiers: string[];
  instructions?: string; // omit-empty
}

// Response to GET /api/public/order-request/[shortCode]: the diner's poll
// target. "accepting" is the moment staff have opened the request but not yet
// confirmed it — the UI renders it identically to "pending" (SLICE 8 §1), it
// exists only so staff-side UIs can show the in-progress state.
export interface PublicOrderRequestStatusData {
  status: "pending" | "accepting" | "accepted" | "rejected";
  shortCode: string;
  tableLabel: string | null;
  parcel: boolean;
  itemCount: number;
  total: number;
  createdAt: string;
  items: PublicStatusItem[];
  // The promo the request currently carries, so the edit UI can SHOW it and
  // offer Remove — without it a diner could never see or undo a code they
  // applied in an earlier round. Same three-way rule as `note` on the PATCH.
  promoCode?: string;
  quotedDiscount?: number;
  // The diner's own kitchen note, so the edit UI can round-trip/amend it —
  // on the PATCH side "absent" keeps it, "" clears it, text replaces it.
  note?: string;
  rejectedReason?: string;
  acceptedAt?: string;
}

// Response to PATCH /api/public/order-request/[shortCode] (CR2.2b §17.C — the
// diner editing a still-pending request): deliberately narrow, mirroring the
// POST route's own create-response contract — always "pending" (a successful
// edit can never itself accept/reject the request), never the item lines back
// (the client already holds its own just-saved draft).
export interface PublicOrderRequestUpdatedData {
  shortCode: string;
  status: "pending";
  total: number;
  itemCount: number;
}

// Promo codes (CR2.2c, phase-CR2-public-ordering.md §17.E) live in
// ./public-promo — split only for the ~300-line file cap, no semantic change.
export * from "./public-promo";

// ── Diner self-cancel (field-feedback 2026-08-20) ───────────────────────────
// POST /api/public/order-request/[shortCode]/cancel reuses the ordinary
// "rejected" status (the staff tray already fetches open-only, so a
// diner-cancelled request disappears from it exactly like a staff reject) —
// these two constants are what tell the two apart afterwards: the diner's own
// status page renders THIS exact reason as "Cancelled by you" instead of the
// scary staff-rejected copy, and the staff tray/history can do the same.
export const DINER_CANCELLED_REASON = "Cancelled by the customer";
export const DINER_ACTOR = "diner";
