// Product / brand. The per-cafe name is configured in Settings (Settings.restaurantName)
// and shown across the app; APP_NAME is the generic product label, used as the
// UI chrome fallback before a cafe sets its own name from the Settings page.
// The product is restaurant-agnostic — never hard-code a specific cafe's name
// (it lives only in each tenant's Settings).
export const APP_NAME = "POS Software";

// SEED DEFAULT ONLY (CR1.1). Tables are dynamic — a cafe defines its own via the
// admin Tables page, and `tableNo` is validated against the live Table collection,
// never against this list. This array exists solely so `seed:tables` can bootstrap
// an empty DB with a sensible eight. A grep-pin test asserts it has no other
// runtime consumer; adding one would re-freeze the floor plan.
export const TABLE_NUMBERS = ["T-1", "T-2", "T-3", "T-4", "T-5", "T-6", "T-7", "T-8"] as const;

// A tableNo is a URL path segment (/api/tables/[tableNo]) as well as a display
// label, so the charset excludes "/" and "\" — a name carrying either would split
// into extra segments and route to nothing. Leading character is alphanumeric so a
// name can never be whitespace that trims away to empty.
export const TABLE_NO_MAX_LEN = 24;
export const TABLE_NO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
export const TABLE_NO_MESSAGE =
  "Use letters, numbers, spaces, hyphens or underscores (no slashes)";
export const TABLE_CAPACITY_MIN = 1;
export const TABLE_CAPACITY_MAX = 99;

// "Unpaid" is the held/open-tab state: a running order fired to the kitchen but
// not yet settled (status Pending, paidAmount 0). It is NOT a way a bill gets
// paid — settlement always picks a real mode from SETTLEMENT_PAY_MODES below.
export const PAYMENT_MODES = ["Cash", "Online", "Due", "Split", "Credit", "Unpaid"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

// The modes a bill can actually be SETTLED with (everything except the held
// "Unpaid" open-tab state). Drives the payment modal grid + the dashboard
// payment-mix breakdown, so an unpaid open tab never appears as collected money.
export const SETTLEMENT_PAY_MODES = ["Cash", "Online", "Due", "Split", "Credit"] as const;
export type SettlementPayMode = (typeof SETTLEMENT_PAY_MODES)[number];

// The modes a customer DUE can actually be RECEIVED with (G7). A dues payment
// is money ARRIVING at the till right now, so only the modes that represent
// money arriving are valid: "Due"/"Credit" mean the exact opposite on an
// ORDER (lib/order.ts: "nothing collected now"), and "Split" has no
// cash/online split fields on this path, making a Split dues receipt an
// unattributable lump — exactly what a drawer tally cannot afford. Narrower
// than SETTLEMENT_PAY_MODES on purpose; the stored DuePayment history stays
// on the wide enum (see models/DuePayment.ts) — only the RECEIPT surface
// (the Zod input schema + the UI tiles + the fold) is narrowed here.
export const DUES_RECEIPT_MODES = ["Cash", "Online"] as const;
export type DuesReceiptMode = (typeof DUES_RECEIPT_MODES)[number];

// Subset of PAYMENT_MODES valid for event advance payments (no Due/Split).
export const EVENT_PAY_MODES = ["Cash", "Online", "Credit"] as const;
export type EventPayMode = (typeof EVENT_PAY_MODES)[number];

export const STAFF_ROLES = ["admin", "staff"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

// "Cancelled" (CR1.3) is a TERMINAL, admin-only state. A cancelled order STAYS in
// the ledger — with who cancelled it, when, and why — but it is not a sale: every
// money surface counts "Completed" only, so a cancelled bill leaves sales, the
// payment mix and its customer's ledger contribution (see lib/order.ts
// ledgerContribution). It replaces the destructive delete a cashier used to have.
// APPEND new statuses at the END and never derive meaning from the position: the
// codec stores the status as a string, and a pin test asserts "Cancelled" stays
// last so no future writer starts encoding an ordinal.
export const ORDER_STATUSES = ["Pending", "Completed", "Cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Cancelling an order or voiding a fired line must say WHY — the reason IS the
// audit trail, so it is required, not optional. Bounded so a pasted essay can't
// ride into every ledger row on a 512MB M0.
export const ORDER_REASON_MIN_LEN = 3;
export const ORDER_REASON_MAX_LEN = 200;

// Free-text note on an order (e.g. a special request). Optional, but bounded
// for the same reason as the reason fields above — unbounded text in every
// ledger row adds up on a 512MB M0.
export const ORDER_NOTES_MAX_LEN = 200;

export const RESERVATION_STATUSES = ["Booked", "Seated", "Completed", "Cancelled"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const EVENT_STATUSES = ["Booked", "Completed", "Cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const CUSTOMER_NOTES = ["Regular", "VIP"] as const;
export type CustomerNote = (typeof CUSTOMER_NOTES)[number];

export const TABLE_STATUSES = ["Available", "Occupied", "Reserved"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

// Page route prefixes only an admin may open. Enforced in middleware
// (auth.config.ts) and again client-side via <AdminGuard>.
export const ADMIN_ROUTES = ["/staff", "/reports", "/settings"] as const;

// How GST is applied to a bill (admin-configurable in Settings):
// - "inclusive": menu prices already include GST; the receipt breaks the GST
//   component out of the total (the total the customer pays is unchanged).
// - "exclusive": GST is added on top of the discounted subtotal, raising the
//   total; the GST amount is persisted on the order (Order.gstAmount).
export const GST_MODES = ["inclusive", "exclusive"] as const;
export type GstMode = (typeof GST_MODES)[number];

// Common Indian restaurant GST rates, offered as quick picks in Settings.
export const GST_RATES = [0, 5, 12, 18, 28] as const;

// FSSAI license number (Indian food-safety registration), shown on the
// receipt when set. Bounded to a plausible license-number length.
export const SETTINGS_FSSAI_MAX_LEN = 20;

// Fallback category assigned to products whose category is deleted, so menu
// items never become orphaned with a dangling category name.
export const UNCATEGORIZED = "Uncategorized";

// The cafe operates in a single fixed timezone (India, no DST). Day boundaries
// for "today's sales" / reports are anchored here so they stay correct even
// when the server runs in UTC (e.g. Cloudflare Workers).
export const CAFE_TIMEZONE = "Asia/Kolkata";
export const CAFE_UTC_OFFSET_MINUTES = 330; // IST = UTC+5:30

// Shape of a cafe date-string field (reservations/events/reports use this
// format, not a Date object, so a day stays IST-anchored regardless of server
// TZ — see cafeDateString/dayRange in lib/utils).
export const CAFE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// bcrypt cost factor for password hashing (CLAUDE.md §8).
export const BCRYPT_ROUNDS = 12;

// JWT session lifetime. A cafe shift is ~8h, so a token outlives one shift and
// no more — a deactivated/forgotten login can't linger indefinitely (CLAUDE.md §8).
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours

// Throttle for re-checking a session's account against the DB (role/isActive).
// The Node auth instance re-validates at most this often (per account, per
// worker isolate — see the node-cache marker in lib/auth.ts), so a deactivated
// or role-changed staff member is locked out within ~a minute.
export const SESSION_REVALIDATE_MS = 60 * 1000; // 1 minute

// ── Product images (asset plane, F2.11) ─────────────────────────────────────
// Hard cap on one product image upload; enforced client-side before upload AND
// server-side when the presigned-PUT grant is issued (the grant signs the exact
// Content-Length, so R2 rejects a mismatched body).
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB

// Bound on a stored opaque image ref ("r2:<key>" or a legacy Cloudinary
// public_id) — long enough for either format, short enough to keep a rogue
// value from bloating a document on a 512MB M0.
export const IMAGE_REF_MAX_LEN = 300;

// The only content types an upload grant is issued for, with the object-key
// extension each maps to. The client's canvas re-encode normalises every image
// to webp (or png where webp encoding is unsupported) before requesting a grant.
export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Presigned-PUT validity. Short: the client PUTs immediately after the grant.
export const IMAGE_UPLOAD_TTL_SECONDS = 300;

// Client-side downscale bound (longest edge). R2 serves objects as-is (no
// transform tier), so images are stored pre-sized: 600px covers the largest
// render (300px at 2× DPR).
export const IMAGE_MAX_DIMENSION_PX = 600;

export const PAY_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  Cash: { color: "text-yellow-600", bg: "bg-yellow-50", label: "Cash" },
  Online: { color: "text-blue-600", bg: "bg-blue-50", label: "Online" },
  Due: { color: "text-red-600", bg: "bg-red-50", label: "Due" },
  Split: { color: "text-purple-600", bg: "bg-purple-50", label: "Split" },
  Credit: { color: "text-orange-600", bg: "bg-orange-50", label: "Credit" },
  // Held open tab — fired to the kitchen, payment not yet taken.
  Unpaid: { color: "text-slate-600", bg: "bg-slate-100", label: "Open" },
};

// Hex equivalents of the PAY_STYLES -600 shades, for recharts (which can't use
// Tailwind classes). Keep these in sync with PAY_STYLES above.
export const PAYMENT_COLORS: Record<string, string> = {
  Cash: "#ca8a04", // yellow-600
  Online: "#2563eb", // blue-600
  Due: "#dc2626", // red-600
  Split: "#9333ea", // purple-600
  Credit: "#ea580c", // orange-600
  Unpaid: "#475569", // slate-600 (held open tab; never plotted in the paid mix)
};
