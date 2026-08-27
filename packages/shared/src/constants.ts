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

// Upper bound on ONE floor-plan arrangement request (PATCH /api/tables). The
// plan itself is operator data with no global cap (CR1.1), but a reorder payload
// names EVERY table at once, so the body needs a bound — and a cafe arranging
// more than this by hand is not the case this screen serves.
export const TABLE_REORDER_MAX = 200;

// A menu item sold in named sizes/portions, each with its OWN price (Small /
// Medium / Large, Half / Full). The name lands on the customer's bill AND on the
// kitchen ticket, so the charset bars control characters (they corrupt a thermal
// print stream) but is otherwise permissive — unlike a table name, a variation
// name is never a URL segment. The count is capped because the whole set is
// embedded in the product document and re-sent on every menu load.
export const MAX_VARIATIONS = 20;
export const VARIATION_NAME_MAX_LEN = 24;
export const VARIATION_NAME_PATTERN = /^[\x20-\x7E\u00A0-\uFFFF]+$/;
export const VARIATION_NAME_MESSAGE =
  'Name the variation as it should print, e.g. "Large"';
// A variation IS the price the item sells at, so it carries a price ceiling of
// its own rather than borrowing the table-charge one.
export const VARIATION_PRICE_MAX = 100000;

// A per-table extra charge (cover / AC / rooftop / service …). Two fields, not
// one: the AMOUNT is what lands on the bill, and the LABEL is what the customer
// reads on the slip. The label is operator text with no product-supplied
// default on purpose — cafes call this different things, and a hardcoded
// "Additional charge" would print on someone's receipt as a lie.
// Whole rupees, bounded: this rides onto EVERY bill of that table until an
// admin changes it, so a fat-fingered entry is expensive.
export const TABLE_CHARGE_MAX = 10000;
export const TABLE_CHARGE_LABEL_MAX_LEN = 24;
// Display-only text — it is printed on an 80mm slip and never used as a URL
// segment (unlike tableNo), so the charset is permissive. It bars only control
// characters, which would corrupt the thermal print stream.
export const TABLE_CHARGE_LABEL_PATTERN = /^[\x20-\x7E\u00A0-\uFFFF]+$/;
export const TABLE_CHARGE_LABEL_MESSAGE =
  'Name the charge as it should print, e.g. "Rooftop charge"';

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

// Rows the admin per-customer dues-history read returns at most (newest
// first). Bounded like CUSTOMER_SEARCH_LIMIT — a customer with a long payment
// history must not hand back an unbounded list on a 512MB M0.
export const DUE_PAYMENT_HISTORY_LIMIT = 100;

// A soft-deleted DuePayment keeps the row but must say WHY it was un-recorded
// (the governing reason a delete exists at all) — bounded below like
// ORDER_REASON_MIN_LEN so a one-character note can't satisfy "required".
export const DUE_PAYMENT_DELETE_NOTE_MIN_LEN = 3;

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

// How much of a customer's mobile number anyone below admin may see. The
// remaining characters are replaced 1:1 with MOBILE_MASK_CHAR, so a masked
// number keeps the original LENGTH — which is what lets it still satisfy the
// 10-character minimum the customer schema enforces (see maskMobile).
export const MOBILE_VISIBLE_PREFIX = 5;
export const MOBILE_MASK_CHAR = "*";

// Rows the customer search returns at most. Shared by the API's `.limit()` and
// the customers page, which warns when a result set hits it: staff searching a
// masked number see rows that all LOOK alike, so a silently truncated list
// reads as "this customer is not registered" and ends in a duplicate record.
export const CUSTOMER_SEARCH_LIMIT = 50;

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

// ── Print customization (bill + kitchen ticket) ──────────────────────────────
// Two printed surfaces, each independently configurable: what appears on it,
// how wide the paper is, and how large the type runs. Kept as FLAT settings
// fields rather than nested objects because PUT /api/settings applies a partial
// $set — a nested object would replace its whole subdocument, so saving one
// toggle would silently reset every other toggle beside it.

// Thermal paper the slip is laid out for. 80mm is the common counter printer;
// 58mm is the narrow handheld/portable one. This drives BOTH the on-screen
// width of the print source and the @page size handed to the browser, so the
// two can never disagree about how much room there is.
export const PAPER_WIDTHS = ["58mm", "80mm"] as const;
export type PaperWidth = (typeof PAPER_WIDTHS)[number];

// Base type size for a slip. Inner elements size themselves relative to this
// (em), so one setting scales the whole slip instead of only its body text.
export const PRINT_FONT_SIZES = ["small", "normal", "large"] as const;
export type PrintFontSize = (typeof PRINT_FONT_SIZES)[number];

export const PRINT_LOGO_SIZES = ["small", "medium", "large"] as const;
export type PrintLogoSize = (typeof PRINT_LOGO_SIZES)[number];

// Daily-resetting slip numbers (bill and kitchen ticket each get their own
// series). The cafe chooses where each morning starts — some carry a number
// forward from a previous book, some restart at 1 every day. The stored counter
// always counts 1,2,3…; the PRINTED number is `start + count - 1`, so changing
// the start tomorrow never rewrites a slip already handed to a customer.
export const PRINT_NUMBER_START_MIN = 1;
export const PRINT_NUMBER_START_MAX = 999999;

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

// ── Branding assets (logos + hero image, stored in the cafe's OWN database) ──
// These must work on a deployment with NO asset-plane config at all (no R2
// bucket, no Cloudinary account): a cafe that cannot show its logo on a bill
// is not shippable, and the browser tab must not fall back to the framework's
// default icon. So branding bytes live in the cafe's Mongo as a `BrandingAsset`
// doc per slot — separate from `Settings` on purpose, because GET /api/settings
// is fetched by every screen for every signed-in user and must stay small.
//
// CR2.4 adds `heroImage` (the Appearance hero banner, referenced from
// Settings.appearance.heroImage — S4/S5) alongside the two logos. Product
// images keep following IMAGE_STORE (r2/cloudinary) — a whole MENU of images
// is a different storage-budget question from these three slots (owner
// decision 2026-08-17), and nothing here changes that path.
export const BRANDING_SLOTS = ["logo", "productLogo", "heroImage"] as const;
export type BrandingSlot = (typeof BRANDING_SLOTS)[number];

// Client-side downscale bound for the Appearance hero banner (longest edge) —
// the same discipline as IMAGE_MAX_DIMENSION_PX, but a hero banner is shown
// full-width above the menu (never a ~80px tile), so it earns a taller cap.
export const HERO_MAX_DIMENSION_PX = 1200;

// Per-slot downscale bound, keyed the same way the upload UI resolves it
// (Object.hasOwn — CR2.4 S4). The two logos keep today's product-image
// dimension; heroImage gets its own, larger one above.
export const BRANDING_SLOT_MAX_DIMENSION_PX: Record<BrandingSlot, number> = {
  logo: IMAGE_MAX_DIMENSION_PX,
  productLogo: IMAGE_MAX_DIMENSION_PX,
  heroImage: HERO_MAX_DIMENSION_PX,
};

// Hard cap per branding asset, keyed the same way (A16). The client downscales
// to BRANDING_SLOT_MAX_DIMENSION_PX[slot] and re-encodes to webp first, which
// puts a real logo at ~20-60KB and a hero banner somewhat more; this ceiling
// only has to stop a pathological upload from sitting in a 512MB M0 forever.
// See MAX_BRANDING_BYTES below for the worst-case storage math across all
// three slots.
export const BRANDING_SLOT_MAX_BYTES: Record<BrandingSlot, number> = {
  logo: 512 * 1024,
  productLogo: 512 * 1024,
  heroImage: 1024 * 1024,
};

// Kept for the two logo slots' existing call sites (S4 narrows these to read
// BRANDING_SLOT_MAX_BYTES[slot] instead) — same value as
// BRANDING_SLOT_MAX_BYTES.logo/.productLogo above, restated as its own named
// constant so neither slot's cap is a bare literal at the call site.
//
// Worst-case storage math (A16, CR2.4, post-review count-bound amendment):
// 3 slots × at most (2 kept + BRANDING_PRUNE_MAX_PENDING pending) documents
// per slot × each doc's own BRANDING_SLOT_MAX_BYTES cap × 1.33 (base64
// storage overhead) ≈ (512KB + 512KB + 1024KB) × 5 × 1.33 ≈ ~13.3MB worst
// case on a 512MB M0 — comfortably inside budget even at every slot's
// ceiling simultaneously.
export const MAX_BRANDING_BYTES = 512 * 1024; // 512KB

// Grace window a branding-asset prune must respect (A14, CR2.4): a fresh
// upload's document must survive even if the request that will SAVE its ref
// hasn't landed yet, because putBrandingAsset reads the "active" ref UNCACHED
// but a concurrent Settings PUT could still be mid-flight against the up-to-
// 45s-stale TTL.SETTINGS cache elsewhere. ~15 minutes comfortably outlasts any
// realistic gap between "upload" and "Save" in the Appearance tab.
export const BRANDING_PRUNE_GRACE_MS = 15 * 60 * 1000;

// Hard per-slot ceiling on documents NOT in the keep-list, independent of age
// (post-review fix — the grace window above only collects OLD orphans, so a
// burst of same-slot uploads inside that window, e.g. auditioning several
// hero images before ever saving, previously grew a slot's document count
// without bound). putBrandingAsset keeps the newest this-many non-kept
// documents regardless of age (headroom for uploads plausibly mid-save) and
// collects anything beyond that on every put.
export const BRANDING_PRUNE_MAX_PENDING = 3;

// Hex chars of the content hash carried in a branding ref and served as the
// ETag. Long enough that two successive versions of one slot cannot collide (a
// collision would leave a browser holding an immutable URL for stale bytes).
export const BRANDING_VERSION_LEN = 12;

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
