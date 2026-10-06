// Print customization S3: what a slip's QR line may encode. Pure and client-safe. The write gate
// (schemas/print-template-blocks.schema.ts) and the renderers (apps/cafe components/print/slip) share these rules,
// so a link the editor refuses is also one a slip never prints, whatever an older save let through.

// Visible ASCII only: no spaces, control or zero-width characters, nothing outside ASCII. Pasted links often
// carry an invisible character that makes the printed QR code open nothing; this also bounds the QR's density
// in bytes, which a 58 mm paper roll can only just hold.
export const PRINT_QR_URL_CHARS = /^[\x21-\x7E]+$/;
const HTTPS_PREFIX = "https://";

// The rule for a QR link. The text must literally start with "https://" in lowercase (the URL parser would also
// accept "https:example.com", "https:\\host" and an upper-case scheme, which a person did not mean), carry no
// backslash, parse as an https URL with a real host, and hold no login ("user:pass@") in it.
export function isSafeHttpsLink(value: string): boolean {
  if (!value.startsWith(HTTPS_PREFIX) || value.includes("\\") || !PRINT_QR_URL_CHARS.test(value)) return false;
  // "https:///host" parses to host, but there is no host in what the person typed.
  if (/^[/?#]/.test(value.slice(HTTPS_PREFIX.length))) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

// ── UPI ("Scan to pay") ──────────────────────────────────────────────────────
// A UPI ID (virtual payment address) is "<handle>@<bank>": letters, digits, dot, hyphen and underscore before
// the "@", letters and digits after it (lenient on purpose: a real ID the form refused would leave a cafe with no
// pay QR, while an ID the bank does not know only fails at the payer's app, visibly). The settings form saves only
// this shape (or ""), and a bill prints a pay QR only for an ID that still matches it.
export const UPI_ID_MAX_LEN = 100;
const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9]{2,32}$/;

export function isValidUpiId(value: string): boolean {
  return value.length <= UPI_ID_MAX_LEN && UPI_ID_RE.test(value);
}

export interface UpiPayLink {
  /** A valid UPI ID (isValidUpiId). Its characters need no escaping, so it is written as is. */
  upiId: string;
  /** Shown to the payer by their UPI app: the cafe's name. */
  payee: string;
  /** Rupees, > 0. Two decimals, as UPI apps expect. */
  amount: number;
  /** The payment's note in the payer's app, e.g. "Bill 128". */
  note: string;
}

const UPI_AMOUNT_DECIMALS = 2;
// The payee name is the one unbounded-in-bytes part of the link: each non-Latin character escapes to up to 9 bytes,
// and a 60-character Devanagari name alone would grow the code past a 58 mm slip. Capped in ESCAPED length, cut at
// whole characters; the payer's app shows the name only as a label.
export const UPI_PAYEE_ESCAPED_MAX = 90;

function payeeParam(payee: string): string {
  let out = "";
  for (const ch of Array.from(payee)) {
    const next = out + encodeURIComponent(ch);
    if (next.length > UPI_PAYEE_ESCAPED_MAX) break;
    out = next;
  }
  return out;
}

/** The NPCI "upi://pay" link a pay QR encodes: payee address, name (capped), amount in INR, and a note. */
export function upiPayUri({ upiId, payee, amount, note }: UpiPayLink): string {
  const params = [
    `pa=${upiId}`,
    `pn=${payeeParam(payee)}`,
    `am=${amount.toFixed(UPI_AMOUNT_DECIMALS)}`,
    "cu=INR",
    `tn=${encodeURIComponent(note)}`,
  ];
  return `upi://pay?${params.join("&")}`;
}

// ── Pay QR policy (S3b, owner decisions 01-PLAN Amendment A4) ─────────────────
// When a bill's "Scan to pay" QR prints, for how much, and until when. A printed UPI QR cannot truly expire (UPI
// apps check no time; real expiry needs a payment gateway), so "valid till" is a PRINT-side rule only: the window
// starts at the bill's FIRST print (stored once by the server, Order.billFirstPrintedAt), the slip shows
// "Valid till <time>", and a reprint after that time leaves the QR off.
export const PAY_QR_MODES = ["always", "owed", "never"] as const;
export type PayQrMode = (typeof PAY_QR_MODES)[number];
export const PAY_QR_MODE_DEFAULT: PayQrMode = "always";
/** Stored as `payQrValidMinutes: 0`: the QR has no "valid till" and prints on every reprint. 0, not null or absent:
 *  JSON cannot send undefined, and `null ?? default` would silently turn "No limit" back into the default. */
export const PAY_QR_NO_LIMIT = 0;
export const PAY_QR_MINUTES_MIN = 5;
export const PAY_QR_MINUTES_MAX = 1440;
export const PAY_QR_MINUTES_DEFAULT = 60;
export const MS_PER_MINUTE = 60 * 1000;
const PAISE_PER_RUPEE = 100;

export function isPayQrMinutes(value: number): boolean {
  return (
    Number.isInteger(value) &&
    (value === PAY_QR_NO_LIMIT || (value >= PAY_QR_MINUTES_MIN && value <= PAY_QR_MINUTES_MAX))
  );
}

/** A stored mode, or the default for an older document (lean reads carry no model default) or a foreign value. */
export function payQrModeOf(value: unknown): PayQrMode {
  return (PAY_QR_MODES as readonly unknown[]).includes(value) ? (value as PayQrMode) : PAY_QR_MODE_DEFAULT;
}

/** Stored minutes, or the default for an absent or out-of-range value. 0 (No limit) is kept. */
export function payQrMinutesOf(value: unknown): number {
  return typeof value === "number" && isPayQrMinutes(value) ? value : PAY_QR_MINUTES_DEFAULT;
}

export interface PayQrInput {
  mode: PayQrMode;
  /** Minutes the QR stays valid after the first print; PAY_QR_NO_LIMIT = no limit. */
  minutes: number;
  upiId: string;
  cancelled: boolean;
  /** Rupees, the order's own units. */
  total: number;
  paid: number;
  /** ISO time of the bill's first print as the server stored it; absent = this print is the first. */
  firstPrintedAt?: string;
  /** The printing device's clock at render time. */
  nowMs: number;
}

export interface PayQr {
  /** Rupees to ask for: what is still owed, or the full total once the bill is fully paid. Always > 0. */
  amount: number;
  /** Epoch ms the slip prints as "Valid till"; null = No limit (no line). */
  validTillMs: number | null;
}

/** The whole pay-QR rule; null = this slip prints no pay QR. Each check is its own owner decision (A4). */
export function payQrPlan(input: PayQrInput): PayQr | null {
  if (input.cancelled) return null;
  if (input.mode === "never") return null;
  if (!isValidUpiId(input.upiId)) return null;
  // Whole paise, so float dust in total - paid neither prints "Scan to pay ₹0.00" nor counts as owed.
  const due = Math.round((input.total - input.paid) * PAISE_PER_RUPEE) / PAISE_PER_RUPEE;
  if (input.mode === "owed" && due <= 0) return null;
  // A partly paid bill never asks for more than is owed; a fully (or over-) paid one asks for the full total.
  const amount = due > 0 ? due : input.total;
  if (!(amount > 0)) return null;
  if (input.minutes === PAY_QR_NO_LIMIT) return { amount, validTillMs: null };
  const stamped = input.firstPrintedAt !== undefined ? Date.parse(input.firstPrintedAt) : Number.NaN;
  const start = Number.isFinite(stamped) ? stamped : input.nowMs;
  const validTillMs = start + input.minutes * MS_PER_MINUTE;
  // A reprint after the window leaves the QR off; at exactly "valid till" it still prints.
  if (input.nowMs > validTillMs) return null;
  return { amount, validTillMs };
}
