// Inventory lite, Slice 3: the item editor's "Stock use" form, as pure functions (no React, no Mongoose). A row holds
// TEXT in the unit the person reads (150 ml, not 150 milli-L); it becomes integer milli-units of THAT unit here, once
// (parseQtyText), and the server converts to the stock item's own unit at save. The GET goes the other way: the stored
// milli-units of the item's unit are shown back in a unit that reads well (150 milli-L -> "150" ml).
import { STOCK_QTY_SCALE, convertMilli, milliToQty, type StockUnit } from "@pos/shared/inventory";
import { stockUseSchema, type StockUseInput } from "@/schemas";
import type { StockUseDto } from "@/types/inventory";
import { parseQtyText } from "@/lib/inventory/stock-item-form";

export interface StockUseRow {
  /** React key only; never sent. */
  key: string;
  itemId: string;
  unit: StockUnit | "";
  amount: string;
  perSize: boolean;
  /** Keyed by the product's current size names. */
  sizeAmounts: Record<string, string>;
}

/** What the form needs to know about a stock item to build a request (an archived one is still named). */
export interface StockUseItemInfo {
  name: string;
  unit: StockUnit;
  archived?: true;
}

export type BuildStockUseResult = { ok: true; input: StockUseInput } | { ok: false; error: string };

/** The smaller unit a sub-one-unit amount reads better in. */
const SMALLER_UNIT: Partial<Record<StockUnit, StockUnit>> = { kg: "g", L: "ml" };

const PICK_ITEM = "Pick a stock item in every row";
const LISTED_TWICE = "A stock item is listed twice";
const CHECK_AND_RETRY = "Check the stock use and try again";

export function emptyRow(key: string): StockUseRow {
  return { key, itemId: "", unit: "", amount: "", perSize: false, sizeAmounts: {} };
}

/** kg shows as g and L as ml when every non-zero amount is under one whole unit (and at least one is non-zero). */
export function displayUnitFor(itemUnit: StockUnit, amountsMilli: number[]): StockUnit {
  const small = SMALLER_UNIT[itemUnit];
  const nonZero = amountsMilli.filter((m) => m !== 0);
  if (small === undefined || nonZero.length === 0) return itemUnit;
  return nonZero.every((m) => Math.abs(m) < STOCK_QTY_SCALE) ? small : itemUnit;
}

/** Stored milli-units of `from` shown as text in `to`: no float noise ("150", "0.25", "1.5"). */
function amountText(milli: number, from: StockUnit, to: StockUnit): string {
  return String(milliToQty(convertMilli(milli, from, to) ?? milli));
}

/** One row per stored line, in its display unit. Sizes the product no longer has are dropped; a size with no stored amount gets the base amount. */
export function rowsFromDto(dto: StockUseDto, sizeNames: string[]): StockUseRow[] {
  return dto.lines.map((line, i) => {
    const perSize = sizeNames.length > 0 && (line.sizes?.length ?? 0) > 0;
    const stored = new Map((line.sizes ?? []).map((s) => [s.name, s.qtyMilli]));
    const sizeMilli = perSize ? sizeNames.map((n) => stored.get(n) ?? line.qtyMilli) : [];
    const unit = displayUnitFor(line.unit, [line.qtyMilli, ...sizeMilli]);
    const sizeAmounts: Record<string, string> = {};
    if (perSize) {
      for (const name of sizeNames) sizeAmounts[name] = amountText(stored.get(name) ?? line.qtyMilli, line.unit, unit);
    }
    return { key: `dto-${i}`, itemId: line.itemId, unit, amount: amountText(line.qtyMilli, line.unit, unit), perSize, sizeAmounts };
  });
}

/** The PUT body, or the first plain-English problem. No rows builds `lines: []` (clears the item's stock use). */
export function buildStockUseInput(
  rows: StockUseRow[],
  sizeNames: string[],
  itemsById: Map<string, StockUseItemInfo>,
): BuildStockUseResult {
  const seen = new Set<string>();
  const lines: StockUseInput["lines"] = [];
  for (const row of rows) {
    const item = row.itemId === "" ? undefined : itemsById.get(row.itemId);
    if (!item) return { ok: false, error: PICK_ITEM };
    if (seen.has(row.itemId)) return { ok: false, error: LISTED_TWICE };
    seen.add(row.itemId);
    if (item.archived) return { ok: false, error: `${item.name} is archived. Remove it from this item's stock use.` };
    const unit = row.unit === "" ? item.unit : row.unit;
    const amount = parseQtyText(row.amount);
    if (amount.kind === "error") return { ok: false, error: `${amount.message} (${item.name})` };
    if (amount.kind === "empty" || amount.milli < 1) return { ok: false, error: `Enter an amount above 0 for ${item.name}` };
    if (row.perSize && sizeNames.length > 0) {
      const sizes: Array<{ name: string; qtyMilli: number }> = [];
      for (const name of sizeNames) {
        const size = parseQtyText(row.sizeAmounts[name] ?? "");
        if (size.kind === "error") return { ok: false, error: `${size.message} (${item.name}, ${name})` };
        if (size.kind === "empty") return { ok: false, error: `Enter an amount for each size of ${item.name}` };
        sizes.push({ name, qtyMilli: size.milli });
      }
      lines.push({ itemId: row.itemId, unit, qtyMilli: amount.milli, sizes });
    } else {
      lines.push({ itemId: row.itemId, unit, qtyMilli: amount.milli });
    }
  }
  const parsed = stockUseSchema.safeParse({ lines });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? CHECK_AND_RETRY };
  return { ok: true, input: parsed.data };
}

function sameRow(a: StockUseRow, b: StockUseRow): boolean {
  if (a.itemId !== b.itemId || a.unit !== b.unit || a.amount !== b.amount || a.perSize !== b.perSize) return false;
  if (!a.perSize) return true; // per-size texts are not sent while the toggle is off
  const names = new Set([...Object.keys(a.sizeAmounts), ...Object.keys(b.sizeAmounts)]);
  return [...names].every((n) => (a.sizeAmounts[n] ?? "") === (b.sizeAmounts[n] ?? ""));
}

/** Equal ignoring `key` (Save stays off while nothing changed). Per-size texts count only while "Different amount per size" is on. */
export function sameRows(a: StockUseRow[], b: StockUseRow[]): boolean {
  return a.length === b.length && a.every((row, i) => sameRow(row, b[i]));
}
