// Inventory lite, Slice 2: the stock item sheet's form, as pure functions (no React, no Mongoose). The two quantity
// boxes hold TEXT; it becomes integer milli-units here, once, with qtyToMilli. Nothing here can build a unit, a stock
// number or an archive flag into an update: a PATCH carries only a changed name or low-stock line.
import { STOCK_QTY_MAX, STOCK_QTY_MAX_MILLI, milliToQty, qtyToMilli, type StockUnit } from "@pos/shared/inventory";
import type { CreateStockItemInput, UpdateStockItemInput } from "@/schemas";
import type { StockItemDto } from "@/types/inventory";

export interface StockItemFormValues {
  name: string;
  unit: StockUnit | "";
  openingText: string;
  lowAtText: string;
}

export interface StockItemFormErrors {
  name?: string;
  unit?: string;
  opening?: string;
  lowAt?: string;
}

export type QtyParse = { kind: "empty" } | { kind: "ok"; milli: number } | { kind: "error"; message: string };

/** Digits with at most one point: "2", "1.5", ".5" (a trailing point, "2.", is fine). */
const QTY_TEXT = /^(\d+\.?\d*|\.\d+)$/;
/** More than three digits after the point cannot be stored as milli-units. */
const MORE_THAN_3_DECIMALS = /\.\d{4,}$/;

const NOT_A_NUMBER = "Enter a number, like 2 or 1.5";
const TOO_MANY_DECIMALS = "Use at most 3 decimal places";
const TOO_MUCH = `Enter at most ${STOCK_QTY_MAX.toLocaleString("en-IN")}`;
const LOW_AT_ABOVE_ZERO = "Enter a level above 0, or leave it empty";

export function initialStockItemValues(item: StockItemDto | null): StockItemFormValues {
  if (!item) return { name: "", unit: "", openingText: "", lowAtText: "" };
  const lowAtText = item.lowAtMilli === undefined ? "" : String(milliToQty(item.lowAtMilli));
  return { name: item.name, unit: item.unit, openingText: "", lowAtText };
}

export function parseQtyText(text: string): QtyParse {
  const t = text.trim();
  if (t === "") return { kind: "empty" };
  if (!QTY_TEXT.test(t)) return { kind: "error", message: NOT_A_NUMBER };
  if (MORE_THAN_3_DECIMALS.test(t)) return { kind: "error", message: TOO_MANY_DECIMALS };
  const milli = qtyToMilli(Number(t));
  if (milli > STOCK_QTY_MAX_MILLI) return { kind: "error", message: TOO_MUCH };
  return { kind: "ok", milli };
}

/** Field errors for the sheet; an empty object means it can be sent. `editing`: the unit and opening stock are not asked. */
export function validateStockItemForm(values: StockItemFormValues, editing: boolean): StockItemFormErrors {
  const errors: StockItemFormErrors = {};
  if (values.name.trim() === "") errors.name = "Name the stock item";
  if (!editing) {
    if (values.unit === "") errors.unit = "Pick a unit";
    const opening = parseQtyText(values.openingText);
    if (opening.kind === "error") errors.opening = opening.message;
  }
  const lowAt = parseQtyText(values.lowAtText);
  if (lowAt.kind === "error") errors.lowAt = lowAt.message;
  else if (lowAt.kind === "ok" && lowAt.milli < 1) errors.lowAt = LOW_AT_ABOVE_ZERO;
  return errors;
}

/** The create body; call only after validateStockItemForm found no errors. An empty box sends no key. */
export function buildCreateInput(values: StockItemFormValues): CreateStockItemInput {
  if (values.unit === "") throw new Error("buildCreateInput needs a unit");
  const opening = parseQtyText(values.openingText);
  const lowAt = parseQtyText(values.lowAtText);
  return {
    name: values.name.trim(),
    unit: values.unit,
    ...(opening.kind === "ok" ? { openingQtyMilli: opening.milli } : {}),
    ...(lowAt.kind === "ok" ? { lowAtMilli: lowAt.milli } : {}),
  };
}

/** The update body: only what CHANGED, or null when nothing did. Never a unit, a quantity, an opening stock or archived. */
export function buildUpdateInput(item: StockItemDto, values: StockItemFormValues): UpdateStockItemInput | null {
  const input: UpdateStockItemInput = {};
  const name = values.name.trim();
  if (name !== item.name) input.name = name;
  const lowAt = parseQtyText(values.lowAtText);
  if (lowAt.kind === "ok" && lowAt.milli !== item.lowAtMilli) input.lowAtMilli = lowAt.milli;
  if (lowAt.kind === "empty" && item.lowAtMilli !== undefined) input.lowAtMilli = null;
  return Object.keys(input).length === 0 ? null : input;
}
