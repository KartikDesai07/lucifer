import type { Types } from "mongoose";
import { StockItem } from "@/models/StockItem";

// Inventory lite (plan: docs/superpowers/plans/2026-11-10-inventory-lite.md, "Settle deduct and cancel add-back"):
// the ONE writer of stock numbers, for sales (moveStock) AND purchases (receiveStock, Slice 5). Callers run it only
// AFTER their own write has landed — the settle CAS, the Pay Now insert, the cancel CAS, the admin delete, the
// purchase row insert — so it rides that one win and moves exactly once. It never reverts anything on a throw: a
// bulkWrite that fails after the win loses that move, and a Count fixes it. Stock may go negative (a sale is never
// blocked, owner D3).

/** A sale's stock line: integer milli-units of the stock item's own unit (Order.stockUsed). */
export interface StockUsedRef {
  itemId: Types.ObjectId | string;
  qty: number;
}

/** A settle / Pay Now takes the snapshot out of stock. */
export const STOCK_TAKE = -1;
/** A cancel / admin delete of a settled bill puts the same snapshot back. */
export const STOCK_GIVE_BACK = 1;
export type StockSign = typeof STOCK_TAKE | typeof STOCK_GIVE_BACK;

/** One unordered bulkWrite of `$inc` per stock item. Nothing to move → no write at all. Propagates a throw. */
export async function moveStock(used: readonly StockUsedRef[] | undefined, sign: StockSign): Promise<void> {
  if (!used?.length) return;
  await StockItem.bulkWrite(
    used.map((line) => ({
      updateOne: { filter: { _id: line.itemId }, update: { $inc: { qty: sign * line.qty } } },
    })),
    { ordered: false },
  );
}

/** A purchase line: milli-units bought and what ONE unit cost (paise; 0 = free goods). */
export interface StockReceiptLine {
  itemId: Types.ObjectId | string;
  qty: number;
  ratePaise: number;
}

/**
 * One unordered bulkWrite for a purchase: `$inc` the stock and `$set` the item's last rate, one updateOne per line.
 * A free line (rate 0) only `$inc`s: it is not what one unit costs. Nothing to move → no write. Propagates a throw.
 */
export async function receiveStock(lines: readonly StockReceiptLine[]): Promise<void> {
  if (lines.length === 0) return;
  await StockItem.bulkWrite(
    lines.map((line) => ({
      updateOne: {
        filter: { _id: line.itemId },
        update: line.ratePaise > 0 ? { $inc: { qty: line.qty }, $set: { lastRatePaise: line.ratePaise } } : { $inc: { qty: line.qty } },
      },
    })),
    { ordered: false },
  );
}

/**
 * The cancel / delete add-back: the compensating half of a write that has ALREADY landed, so it is swallowed
 * like the card / points give-backs — a 500 here would send the operator into the "already cancelled" 409.
 */
export async function addBackStockQuietly(used: readonly StockUsedRef[] | undefined): Promise<void> {
  try {
    await moveStock(used, STOCK_GIVE_BACK);
  } catch {
    // Deliberately empty - see above. The stock stays short; a Count fixes it. No console.* in app/lib code.
  }
}
