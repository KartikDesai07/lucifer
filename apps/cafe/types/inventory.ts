// Inventory lite (docs/superpowers/plans/2026-11-10-inventory-lite.md): what /api/inventory/items sends back.
// Quantities are INTEGER milli-units of the item's own unit; render them with formatQty (@pos/shared/inventory).
import type { StockEntryKind, StockUnit, WasteReason } from "@pos/shared/inventory";

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

/**
 * One stock item a stock entry moved (Slice 4), as /api/inventory/entries sends it. `qtyMilli` is SIGNED, as it was
 * applied to stock, in integer milli-units of the item's own unit: a wastage is negative; a count is the change it
 * made (counted minus what the list showed). Deleting the entry takes exactly this back out.
 */
export interface StockEntryLineDto {
  itemId: string;
  name: string;
  unit: StockUnit;
  qtyMilli: number;
  /** A count: how much was counted. */
  countedMilli?: number;
  /** A purchase: what one unit cost, in paise. */
  ratePaise?: number;
  /** A purchase: this line's amount in paise (purchaseLineAmountPaise, worked out by the server). */
  amountPaise?: number;
}

/**
 * One wastage, count, purchase or supplier payment in the entries list (admin only: purchases and payments carry
 * money). A line whose stock item no longer exists is left out. A payment (Slice 6) has no lines: `totalPaise` is what
 * was paid and `duePaise` is minus that.
 */
export interface StockEntryDto {
  id: string;
  kind: StockEntryKind;
  /** IST business day, "YYYY-MM-DD". */
  date: string;
  lines: StockEntryLineDto[];
  /** A wastage: why it was thrown away. */
  reason?: WasteReason;
  note?: string;
  /** A purchase from, or a payment to, a supplier (Slices 5-6); the name is read even when the supplier was archived since. */
  supplierId?: string;
  supplierName?: string;
  /** A purchase: the sum of its line amounts, and what was paid on the day (paise). A payment: totalPaise = the amount paid. */
  totalPaise?: number;
  paidPaise?: number;
  /** What this entry adds to the supplier's dues: a purchase total minus paid (absent when nothing is owed); a payment minus its amount. */
  duePaise?: number;
  /** Staff name from the session. */
  createdBy: string;
  createdAt: string;
}

/**
 * One active supplier, as /api/inventory/suppliers sends it (admin). `duePaise` is worked out on read from the
 * supplier's entries that still count: above 0 = still to pay them; below 0 = paid in advance; 0 = settled.
 */
export interface SupplierDto {
  id: string;
  name: string;
  phone?: string;
  note?: string;
  duePaise: number;
}

/** One page of entries, newest first. `nextBefore` (absent on the last page) is sent back as `?before=`. */
export interface StockEntryPageDto {
  rows: StockEntryDto[];
  nextBefore?: string;
}
