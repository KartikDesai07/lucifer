// Inventory lite (docs/superpowers/plans/2026-11-10-inventory-lite.md): what /api/inventory/items sends back.
// Quantities are INTEGER milli-units of the item's own unit; render them with formatQty (@pos/shared/inventory).
import type { StockUnit } from "@pos/shared/inventory";

export interface StockItemDto {
  id: string;
  name: string;
  /** Fixed once the item is created. */
  unit: StockUnit;
  /** Signed: below zero when sales ran past the stock (a sale is never blocked). */
  qtyMilli: number;
  /** At or under this the item shows Low; absent = no low-stock line. */
  lowAtMilli?: number;
  /** Admin only: what one unit cost on the last purchase. Never sent to staff. */
  lastRatePaise?: number;
}

/** One per-size amount of a stock link: integer milli-units of the stock item's own unit; 0 = that size uses none. */
export interface StockUseSizeDto {
  name: string;
  qtyMilli: number;
}

/**
 * One stock item a sold unit of a menu item takes out, as GET / PUT /api/products/[id]/stock-use and POST
 * .../stock-use/own send it back (Slice 3). Amounts are INTEGER milli-units of the STOCK ITEM's own unit (not the
 * unit the recipe was typed in: the server converts once at save). A link whose stock item no longer exists is
 * left out.
 */
export interface StockUseLineDto {
  itemId: string;
  name: string;
  unit: StockUnit;
  /** The stock item was archived after it was linked: sales still take it until the link is removed. */
  archived?: true;
  qtyMilli: number;
  /** Absent = the same amount for every size. */
  sizes?: StockUseSizeDto[];
}

export interface StockUseDto {
  lines: StockUseLineDto[];
}
