export const TABLE_NUMBERS = ["T-1", "T-2", "T-3", "T-4", "T-5", "T-6", "T-7", "T-8"] as const;
export type TableNumber = (typeof TABLE_NUMBERS)[number];

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

// Subset of PAYMENT_MODES valid for event advance payments (no Due/Split).
export const EVENT_PAY_MODES = ["Cash", "Online", "Credit"] as const;
export type EventPayMode = (typeof EVENT_PAY_MODES)[number];

export const STAFF_ROLES = ["admin", "staff"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ORDER_STATUSES = ["Pending", "Completed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

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

// Fallback category assigned to products whose category is deleted, so menu
// items never become orphaned with a dangling category name.
export const UNCATEGORIZED = "Uncategorized";

// The cafe operates in a single fixed timezone (India, no DST). Day boundaries
// for "today's sales" / reports are anchored here so they stay correct even
// when the server runs in UTC (e.g. Cloudflare Workers).
export const CAFE_TIMEZONE = "Asia/Kolkata";
export const CAFE_UTC_OFFSET_MINUTES = 330; // IST = UTC+5:30

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
