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
