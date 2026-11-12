// Inventory lite, Slice 2: how the stock list is ordered and flagged. Pure and client-safe (no Mongoose).
import { stockLevel, type StockLevel } from "@pos/shared/inventory";
import type { StockItemDto } from "@/types/inventory";

/** Out first, then Low, then the rest. */
const LEVEL_ORDER: Readonly<Record<StockLevel, number>> = { out: 0, low: 1, ok: 2 };

export interface StockBadge {
  label: "Out" | "Low";
  className: string;
}

const OUT_BADGE: StockBadge = { label: "Out", className: "bg-status-bad-tint text-status-bad-ink" };
const LOW_BADGE: StockBadge = { label: "Low", className: "bg-status-warn-tint text-status-warn-ink" };

/** A new array: Out, then Low, then OK, each group by name (case and accents ignored). */
export function sortStockItems(items: readonly StockItemDto[]): StockItemDto[] {
  return [...items].sort(
    (a, b) =>
      LEVEL_ORDER[stockLevel(a.qtyMilli, a.lowAtMilli)] - LEVEL_ORDER[stockLevel(b.qtyMilli, b.lowAtMilli)] ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** The pill beside the quantity; an item that is fine shows none. */
export function stockBadge(level: StockLevel): StockBadge | null {
  if (level === "out") return OUT_BADGE;
  if (level === "low") return LOW_BADGE;
  return null;
}
