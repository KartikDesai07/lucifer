// Inventory lite, Slice 4: the wastage and stock-count sheet's form, as pure functions (no React). The quantity box
// holds TEXT; it becomes integer milli-units of the item's OWN unit here, once, with parseQtyText. A wastage takes the
// typed amount out of stock; a count sets stock to the typed amount, so it needs no reason and is always dated today.
import { STOCK_ENTRY_BACKDATE_MAX_DAYS, STOCK_ENTRY_NOTE_MAX_LEN, formatQty, type StockUnit, type WasteReason } from "@pos/shared/inventory";
import { addDays } from "@/lib/dashboard/range";
import { parseQtyText } from "@/lib/inventory/stock-item-form";
import type { CreateStockEntryInput } from "@/schemas";
import type { StockEntryLineDto } from "@/types/inventory";

export type StockAdjustKind = "waste" | "count";

export interface StockAdjustValues {
  itemId: string;
  qtyText: string;
  reason: WasteReason | "";
  /** "YYYY-MM-DD"; used by a wastage only (a count is always today). */
  date: string;
  note: string;
}

export interface StockAdjustErrors {
  item?: string;
  qty?: string;
  reason?: string;
  date?: string;
  note?: string;
}

const PICK_ITEM = "Pick a stock item";
const WASTE_QTY_EMPTY = "Enter how much was thrown away";
const COUNT_QTY_EMPTY = "Enter how much you have now";
const WASTE_ABOVE_ZERO = "Enter an amount above 0";
const PICK_REASON = "Pick a reason";
const DATE_ERROR = `Pick a date from the last ${STOCK_ENTRY_BACKDATE_MAX_DAYS} days, up to today`;
const NOTE_ERROR = `Keep the note to ${STOCK_ENTRY_NOTE_MAX_LEN} characters or fewer`;
const NO_CHANGE = "No change";

/** The dates a wastage may be dated: a month back, never the future. */
export function stockEntryDateBounds(today: string): { min: string; max: string } {
  return { min: addDays(today, -STOCK_ENTRY_BACKDATE_MAX_DAYS), max: today };
}

export function initialAdjustValues(itemId: string | null, today: string): StockAdjustValues {
  return { itemId: itemId ?? "", qtyText: "", reason: "", date: today, note: "" };
}

/** Field errors for the sheet; an empty object means it can be sent. */
export function validateAdjustForm(kind: StockAdjustKind, values: StockAdjustValues, today: string): StockAdjustErrors {
  const errors: StockAdjustErrors = {};
  if (values.itemId === "") errors.item = PICK_ITEM;

  const qty = parseQtyText(values.qtyText);
  if (qty.kind === "empty") errors.qty = kind === "waste" ? WASTE_QTY_EMPTY : COUNT_QTY_EMPTY;
  else if (qty.kind === "error") errors.qty = qty.message;
  else if (kind === "waste" && qty.milli < 1) errors.qty = WASTE_ABOVE_ZERO;

  if (kind === "waste") {
    if (values.reason === "") errors.reason = PICK_REASON;
    const bounds = stockEntryDateBounds(today);
    if (values.date < bounds.min || values.date > bounds.max) errors.date = DATE_ERROR;
  }

  if (values.note.trim().length > STOCK_ENTRY_NOTE_MAX_LEN) errors.note = NOTE_ERROR;
  return errors;
}

/** The POST body; call only after validateAdjustForm found no errors. The note is trimmed; an empty one sends no key. */
export function buildStockEntryInput(kind: StockAdjustKind, values: StockAdjustValues, clientRef: string, today: string): CreateStockEntryInput {
  const qty = parseQtyText(values.qtyText);
  if (qty.kind !== "ok") throw new Error("buildStockEntryInput needs a valid quantity");
  const note = values.note.trim();
  const noteKey = note === "" ? {} : { note };
  if (kind === "count") {
    return { kind: "count", itemId: values.itemId, countedMilli: qty.milli, date: today, ...noteKey, clientRef };
  }
  if (values.reason === "") throw new Error("buildStockEntryInput needs a reason");
  return { kind: "waste", itemId: values.itemId, qtyMilli: qty.milli, reason: values.reason, date: values.date, ...noteKey, clientRef };
}

// "+1.25 kg", "-500 g"; no sign for zero, which reads "No change".
function signedChangeText(changeMilli: number, unit: StockUnit): string {
  if (changeMilli === 0) return NO_CHANGE;
  return changeMilli > 0 ? `+${formatQty(changeMilli, unit)}` : formatQty(changeMilli, unit);
}

/** What a count would change: the counted amount minus what the list shows now. */
export function countChangeText(beforeMilli: number, countedMilli: number, unit: StockUnit): string {
  return signedChangeText(countedMilli - beforeMilli, unit);
}

/** The history row's change: a line's qtyMilli is already signed as it was applied (wastage negative; a count's change). */
export function entryChangeText(line: StockEntryLineDto): string {
  return signedChangeText(line.qtyMilli, line.unit);
}
