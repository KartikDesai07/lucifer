import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  CAFE_UTC_OFFSET_MINUTES,
  MOBILE_MASK_CHAR,
  MOBILE_VISIBLE_PREFIX,
} from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Escape user input before interpolating it into a RegExp (search-by-name/mobile).
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A customer's mobile as anyone below admin may see it: the first
// MOBILE_VISIBLE_PREFIX characters, every remaining character replaced by
// MOBILE_MASK_CHAR — "9876543210" → "98765*****".
//
// Fail-closed on anything at or under the prefix length: a value that short is
// masked ENTIRELY rather than handed over in full.
//
// Length is preserved on purpose. A masked number still passes the 10-character
// minimum in customer.schema.ts, so the edit form can hold one in a read-only
// field without the resolver rejecting a value the operator cannot even edit.
// Note the limit of that guarantee: the minimum is enforced by the ZOD schema
// on API writes, NOT by models/Customer.ts (which sets no minlength). A record
// written around the API with a shorter number masks to all-stars, and a staff
// member then cannot submit that customer's edit form at all — an admin has to
// make the change. Tightening the Mongoose model would reject those rows on
// every save, so the dead end is left visible rather than papered over.
export function maskMobile(mobile: string): string {
  if (mobile.length <= MOBILE_VISIBLE_PREFIX) {
    return MOBILE_MASK_CHAR.repeat(mobile.length);
  }
  return (
    mobile.slice(0, MOBILE_VISIBLE_PREFIX) +
    MOBILE_MASK_CHAR.repeat(mobile.length - MOBILE_VISIBLE_PREFIX)
  );
}

export function inr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Render integer PAISE as ₹x.xx — the v2 money display helper (build-rule #45).
// Order/line amounts are stored as Int32 paise (F2c #6); render them through this,
// NEVER inr() (which forces whole rupees and would drop the paise). A lint gate
// (P2) forbids raw inr() on a paise field. Decimal scaling stays integer until the
// final divide so 12050 paise → "₹120.50" with no float drift.
export function inrPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100);
  const fraction = abs % 100;
  const whole = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rupees);
  // `whole` is e.g. "₹1,20,500"; append the two paise digits explicitly so the
  // fraction is exact (never an Intl float-rounded value).
  return `${sign}${whole}.${String(fraction).padStart(2, "0")}`;
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  return `${hour > 12 ? hour - 12 : hour}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

// "5m ago" / "2h ago" / "3d ago" relative-time label for recent activity feeds.
export function timeAgo(date: string | Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function generateOrderId(sequence: number): string {
  const date = cafeDateString().replace(/-/g, "");
  return `ORD-${date}-${String(sequence).padStart(3, "0")}`;
}

// Stable identity of ONE line on an order, for the void payload's echo (CR1.3).
// Embedded item rows carry no `_id` (F2c keeps them `{_id:false}`), and the same
// product legitimately appears on a tab more than once — a second round, or two
// covers with different instructions. So a line is identified by its whole tuple,
// not by its product: with a bare productId echo, another device splicing a line out
// shifts the indices and the echo still passes against a DIFFERENT line of the same
// dish, voiding the wrong one (arbiter live-probe, CR1.3 review). Including `qty`
// means a concurrent qty-reduce also invalidates the key, which is what we want —
// the operator was looking at a line that no longer exists in that form. Modifiers
// are sorted so a re-ordered array is still the same line. Any two lines that
// collide on this key are interchangeable: same dish, round, qty, and preparation.
// ASCII record/unit separators, written as escapes (never literal control chars in
// source): a cashier cannot type either into an instructions or modifier field, so no
// free text can forge a field boundary and make two different lines share a key — a
// "|" separator would allow exactly that via instructions like "no ice|extra hot".
const LINE_KEY_SEP = "\u001e";
const MODIFIER_SEP = "\u001f";
export function orderLineKey(item: {
  productId: string;
  qty: number;
  kotRound?: number;
  instructions?: string;
  modifiers?: string[];
  variation?: string;
}): string {
  const base = [
    item.productId,
    item.kotRound ?? 0,
    item.qty,
    item.instructions ?? "",
    [...(item.modifiers ?? [])].sort().join(MODIFIER_SEP),
  ];
  // The variation is part of a line's identity — a Small and a Large of the same
  // dish, same round, same qty are NOT interchangeable, and a void must not be
  // able to take the wrong one off the tab. Appended ONLY when the line has one,
  // so every key for an item sold one way stays byte-identical to the pre-
  // variations format: a tab opened before this shipped keeps matching its own
  // void echoes across the deploy instead of 409ing on the first void.
  return (item.variation ? [...base, item.variation] : base).join(LINE_KEY_SEP);
}

// The one place a line's display name is built: the product name, plus the
// variation it was sold as when it has one. Used by the cart, both receipts, the
// void slip and the order sheet — a second hand-written `${name} (${variation})`
// anywhere is how the bill and the kitchen ticket start disagreeing.
export function orderItemLabel(item: { name: string; variation?: string }): string {
  return item.variation ? `${item.name} (${item.variation})` : item.name;
}

const CAFE_OFFSET_MS = CAFE_UTC_OFFSET_MINUTES * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// The cafe-local (IST) calendar date of an instant, as "YYYY-MM-DD".
// Independent of the server timezone (works on a UTC host).
export function cafeDateString(date: Date = new Date()): string {
  return new Date(date.getTime() + CAFE_OFFSET_MS).toISOString().slice(0, 10);
}

// Start/end UTC instants of the cafe-local (IST) day containing `date`.
// Used for createdAt range queries so "today" matches the cafe's business day.
export function dayRange(date: Date = new Date()): { start: Date; end: Date } {
  const shifted = new Date(date.getTime() + CAFE_OFFSET_MS);
  const cafeMidnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  const start = new Date(cafeMidnightUtc - CAFE_OFFSET_MS);
  const end = new Date(cafeMidnightUtc - CAFE_OFFSET_MS + ONE_DAY_MS - 1);
  return { start, end };
}

// Per-day cache key for the dashboard order summary, keyed by the cafe-local
// date (shared by the summary endpoint and order writes that invalidate it).
export function orderSummaryCacheKey(date: Date = new Date()): string {
  return `order-summary-${cafeDateString(date)}`;
}

// Cafe-local (IST) hour-of-day (0-23) of an instant. Used to bucket today's
// sales into hourly slots for the dashboard peak-hours chart, independent of
// the server timezone (works on a UTC host, same as cafeDateString/dayRange).
export function cafeHourOf(date: Date = new Date()): number {
  return new Date(date.getTime() + CAFE_OFFSET_MS).getUTCHours();
}
