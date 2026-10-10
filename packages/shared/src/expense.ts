// Expense management (Step EXP, owner 2026-10-10): the constants every side of
// the feature reads, plus the ₹-text → paise parser the add/edit sheet uses.
// Pure (no Mongoose, no React) — imported by the cafe's routes, models, pages
// and by node:test suites directly.
//
// Forward-compatible with phase P12's ExpenseEntry ledger
// (.claude/plan/v2/phase-P12-accounting.md, P12-EX): Int32 paise, an IST
// business-day `date`, a flat owner-editable category list, `createdBy`, a
// schema version `v`, no TTL and no hard delete. P12's `paidFrom: cash|bank`
// derives from `paymentMode` (cash → cash; upi / card / bank → bank) with no
// migration — see expensePaidFrom below.

export const EXPENSE_PAYMENT_MODES = ["cash", "upi", "card", "bank"] as const;
export type ExpensePaymentMode = (typeof EXPENSE_PAYMENT_MODES)[number];

export const EXPENSE_PAYMENT_MODE_LABELS: Record<ExpensePaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank transfer",
};

export const EXPENSE_DEFAULT_PAYMENT_MODE: ExpensePaymentMode = "cash";

/** P12's account split, derived on read (never stored twice). */
export function expensePaidFrom(mode: ExpensePaymentMode): "cash" | "bank" {
  return mode === "cash" ? "cash" : "bank";
}

// The 8 categories a new cafe starts with (owner popup 2026-10-10: P12's six
// plus Gas and Packaging; "Misc" reads as "Other"). Seeded once, when the
// category collection is empty; the owner can add, rename and hide after that.
export const EXPENSE_DEFAULT_CATEGORIES = [
  "Ingredients",
  "Gas",
  "Salaries",
  "Rent",
  "Utilities",
  "Maintenance",
  "Packaging",
  "Other",
] as const;

export const EXPENSE_NAME_MAX_LEN = 80;
export const EXPENSE_NOTE_MAX_LEN = 200;
export const EXPENSE_CATEGORY_NAME_MAX_LEN = 40;
/** Visible + hidden together; keeps the add sheet's chip grid short. */
export const EXPENSE_CATEGORIES_MAX = 30;

const PAISE_PER_RUPEE = 100;
/** One expense of at most ₹10,00,000 — 10^8 paise, far inside Int32. */
export const EXPENSE_AMOUNT_MAX_RUPEES = 1_000_000;
export const EXPENSE_AMOUNT_MAX_PAISE = EXPENSE_AMOUNT_MAX_RUPEES * PAISE_PER_RUPEE;

/** How far back an expense may be dated (IST days before today). Never in the future. */
export const EXPENSE_BACKDATE_MAX_DAYS = 366;

/** List page size, and the most rows one list read (or one CSV) may return. */
export const EXPENSE_LIST_PAGE = 100;
export const EXPENSE_LIST_MAX = 1000;

/** Stored on every row as `v` (P12 extends the shape behind it). */
export const EXPENSE_SCHEMA_VERSION = 1;

/** Pages. "/expenses/categories" is also in ADMIN_ROUTES (constants.ts). */
export const EXPENSES_PATH = "/expenses";
export const EXPENSE_CATEGORIES_PATH = "/expenses/categories";
export const EXPENSE_REPORT_PATH = "/reports/expenses";

// ── ₹ text ⇄ paise (string math, never a float multiply) ────────────────────

// Whole rupees (up to 9 digits) and an optional 1–2 digit fraction. Commas and
// spaces are dropped first so "1,200" and "1 200" read as 1200.
const RUPEES_TEXT = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
const RUPEES_TEXT_STRIP = /[,\s]/g;
const FRACTION_DIGITS = 2;

/** "450" → 45000, "450.5" → 45050, "1,200.25" → 120025; anything else → null. */
export function rupeesTextToPaise(text: string): number | null {
  const match = RUPEES_TEXT.exec(text.replace(RUPEES_TEXT_STRIP, ""));
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(FRACTION_DIGITS, "0"));
  return whole * PAISE_PER_RUPEE + fraction;
}

/** 45000 → "450", 45050 → "450.50" — the edit sheet's prefill (no ₹, no commas). */
export function paiseToRupeesText(paise: number): string {
  const whole = Math.trunc(paise / PAISE_PER_RUPEE);
  const fraction = paise % PAISE_PER_RUPEE;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(FRACTION_DIGITS, "0")}`;
}
