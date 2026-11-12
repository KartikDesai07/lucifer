// Inventory lite, Slice 5: the purchase sheet's form, as pure functions (no React). Quantity and rate boxes hold TEXT; they
// become integer milli-units (parseQtyText) and integer paise (rupeesTextToPaise) here, once. A line's amount and the
// total always come from the SHARED purchaseLineAmountPaise / purchaseTotalPaise, the very helpers the server stores
// with, so the preview can never disagree with what is saved.
import { rupeesTextToPaise } from "@pos/shared/expense";
import {
  STOCK_ENTRY_BACKDATE_MAX_DAYS,
  STOCK_ENTRY_MAX_TOTAL_PAISE,
  STOCK_ENTRY_NOTE_MAX_LEN,
  STOCK_RATE_MAX_PAISE,
  purchaseLineAmountPaise,
  purchaseTotalPaise,
} from "@pos/shared/inventory";
import { stockEntryDateBounds } from "@/lib/inventory/stock-adjust-form";
import { parseQtyText } from "@/lib/inventory/stock-item-form";
import { DUE_NEEDS_SUPPLIER_ERROR, PAID_OVER_TOTAL_ERROR } from "@/schemas";
import type { PurchaseEntryInput } from "@/schemas";

export type PaidMode = "full" | "part" | "nothing";

export interface PurchaseLineValues {
  /** A stable React key; never sent. */
  key: string;
  itemId: string;
  qtyText: string;
  /** What ONE unit cost, in rupees as typed. */
  rateText: string;
}

export interface PurchaseValues {
  /** "" = no supplier. */
  supplierId: string;
  /** "YYYY-MM-DD". */
  date: string;
  lines: PurchaseLineValues[];
  paidMode: PaidMode;
  /** The amount typed when paidMode is "part". */
  paidText: string;
  note: string;
}

export interface PurchaseLineErrors {
  item?: string;
  qty?: string;
  rate?: string;
}

export interface PurchaseErrors {
  supplier?: string;
  date?: string;
  /** About the lines as a whole (none left, or the total too big). */
  lines?: string;
  /** Per line, by its key. */
  lineErrors: Record<string, PurchaseLineErrors>;
  paid?: string;
  note?: string;
}

const PAISE_PER_RUPEE = 100;
const PICK_ITEM = "Pick a stock item";
const LISTED_TWICE = "This item is already listed above";
const QTY_EMPTY = "Enter how much you bought";
const QTY_ABOVE_ZERO = "Enter an amount above 0";
const RATE_EMPTY = "Enter the price for one unit (0 if it was free)";
const RATE_INVALID = "Enter a price like 40 or 40.50";
const RATE_TOO_HIGH = `Enter at most ₹${(STOCK_RATE_MAX_PAISE / PAISE_PER_RUPEE).toLocaleString("en-IN")} for one unit`;
const NO_LINES = "Add at least one stock item";
const TOTAL_TOO_BIG = `A purchase can total at most ₹${(STOCK_ENTRY_MAX_TOTAL_PAISE / PAISE_PER_RUPEE).toLocaleString("en-IN")}`;
const PAID_EMPTY = "Enter how much you paid now";
const PAID_INVALID = "Enter an amount like 450 or 450.50";
const DATE_ERROR = `Pick a date from the last ${STOCK_ENTRY_BACKDATE_MAX_DAYS} days, up to today`;
const NOTE_ERROR = `Keep the note to ${STOCK_ENTRY_NOTE_MAX_LEN} characters or fewer`;

export function newPurchaseLine(key: string, itemId = ""): PurchaseLineValues {
  return { key, itemId, qtyText: "", rateText: "" };
}

/** A blank purchase dated today, with one line (the item already picked when opened from one). */
export function initialPurchaseValues(today: string, itemId?: string): PurchaseValues {
  return { supplierId: "", date: today, lines: [newPurchaseLine("line-0", itemId)], paidMode: "full", paidText: "", note: "" };
}

interface ParsedLine {
  qtyMilli: number;
  ratePaise: number;
}

function parseRate(text: string): { kind: "ok"; paise: number } | { kind: "error"; message: string } {
  if (text.trim() === "") return { kind: "error", message: RATE_EMPTY };
  const paise = rupeesTextToPaise(text.trim());
  if (paise === null) return { kind: "error", message: RATE_INVALID };
  if (paise > STOCK_RATE_MAX_PAISE) return { kind: "error", message: RATE_TOO_HIGH };
  return { kind: "ok", paise };
}

/** A line's quantity and rate as numbers, or null while either box is empty, unreadable or out of range. */
function parseLine(line: PurchaseLineValues): ParsedLine | null {
  const qty = parseQtyText(line.qtyText);
  const rate = parseRate(line.rateText);
  if (qty.kind !== "ok" || qty.milli < 1 || rate.kind !== "ok") return null;
  return { qtyMilli: qty.milli, ratePaise: rate.paise };
}

/** One line's amount in paise for the preview (the shared helper), or null until the line reads as a number pair. */
export function lineAmountPaise(line: PurchaseLineValues): number | null {
  const parsed = parseLine(line);
  return parsed === null ? null : purchaseLineAmountPaise(parsed.qtyMilli, parsed.ratePaise);
}

/** The total of the lines that read so far, via the shared helper (each line rounds once, never the sum). */
export function purchaseValuesTotalPaise(values: PurchaseValues): number {
  return purchaseTotalPaise(values.lines.flatMap((line) => parseLine(line) ?? []));
}

/** What is paid now, in paise: all of it, none, or the typed part (null while the typed amount does not read). */
export function paidPaiseOf(values: PurchaseValues): number | null {
  if (values.paidMode === "full") return purchaseValuesTotalPaise(values);
  if (values.paidMode === "nothing") return 0;
  return values.paidText.trim() === "" ? null : rupeesTextToPaise(values.paidText.trim());
}

/** What would be left owed to the supplier (never below 0), for the "Still to pay" hint. */
export function owedPaiseOf(values: PurchaseValues): number {
  return Math.max(0, purchaseValuesTotalPaise(values) - (paidPaiseOf(values) ?? 0));
}

function validateLine(line: PurchaseLineValues, listedAbove: ReadonlySet<string>): PurchaseLineErrors {
  const errors: PurchaseLineErrors = {};
  if (line.itemId === "") errors.item = PICK_ITEM;
  else if (listedAbove.has(line.itemId)) errors.item = LISTED_TWICE;
  const qty = parseQtyText(line.qtyText);
  if (qty.kind === "empty") errors.qty = QTY_EMPTY;
  else if (qty.kind === "error") errors.qty = qty.message;
  else if (qty.milli < 1) errors.qty = QTY_ABOVE_ZERO;
  const rate = parseRate(line.rateText);
  if (rate.kind === "error") errors.rate = rate.message;
  return errors;
}

/** Field errors for the sheet; `lineErrors` empty and no other key means it can be sent. */
export function validatePurchaseForm(values: PurchaseValues, today: string): PurchaseErrors {
  const errors: PurchaseErrors = { lineErrors: {} };
  const bounds = stockEntryDateBounds(today);
  if (values.date < bounds.min || values.date > bounds.max) errors.date = DATE_ERROR;
  if (values.note.trim().length > STOCK_ENTRY_NOTE_MAX_LEN) errors.note = NOTE_ERROR;

  if (values.lines.length === 0) errors.lines = NO_LINES;
  const listed = new Set<string>();
  for (const line of values.lines) {
    const found = validateLine(line, listed);
    if (line.itemId !== "") listed.add(line.itemId);
    if (Object.keys(found).length > 0) errors.lineErrors[line.key] = found;
  }
  // Money checks need every line to read; until then the line errors are the only thing to fix.
  if (Object.keys(errors.lineErrors).length > 0 || errors.lines) return errors;

  const total = purchaseValuesTotalPaise(values);
  if (total > STOCK_ENTRY_MAX_TOTAL_PAISE) {
    errors.lines = TOTAL_TOO_BIG;
    return errors;
  }
  const paid = paidPaiseOf(values);
  if (values.paidMode === "part") {
    if (values.paidText.trim() === "") errors.paid = PAID_EMPTY;
    else if (paid === null) errors.paid = PAID_INVALID;
    else if (paid > total) errors.paid = PAID_OVER_TOTAL_ERROR;
  }
  const paidReads = values.paidMode !== "part" || (paid !== null && paid <= total);
  if (paidReads && total - (paid ?? 0) > 0 && values.supplierId === "") errors.supplier = DUE_NEEDS_SUPPLIER_ERROR;
  return errors;
}

/** True when the form has nothing to fix. */
export function purchaseFormIsValid(errors: PurchaseErrors): boolean {
  const { lineErrors, ...rest } = errors;
  return Object.keys(lineErrors).length === 0 && Object.keys(rest).length === 0;
}

/** The POST body; call only after validatePurchaseForm found no errors. A supplier key only when one is picked; the note is trimmed and left out when empty. */
export function buildPurchaseInput(values: PurchaseValues, clientRef: string): PurchaseEntryInput {
  const lines = values.lines.map((line) => {
    const parsed = parseLine(line);
    if (parsed === null) throw new Error("buildPurchaseInput needs every line to be valid");
    return { itemId: line.itemId, qtyMilli: parsed.qtyMilli, ratePaise: parsed.ratePaise };
  });
  const paidPaise = paidPaiseOf(values);
  if (paidPaise === null) throw new Error("buildPurchaseInput needs a valid paid amount");
  const note = values.note.trim();
  return {
    kind: "purchase",
    ...(values.supplierId === "" ? {} : { supplierId: values.supplierId }),
    date: values.date,
    lines,
    paidPaise,
    ...(note === "" ? {} : { note }),
    clientRef,
  };
}
