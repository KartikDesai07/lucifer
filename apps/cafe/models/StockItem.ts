import mongoose, { Schema, Types, type Document, type Model } from "mongoose";
import { STOCK_UNITS, STOCK_ITEM_NAME_MAX_LEN, type StockUnit } from "@pos/shared/inventory";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";

// Inventory lite (plan docs/superpowers/plans/2026-11-10-inventory-lite.md): one thing the business keeps in
// stock (milk, sugar, a packet of chips). Default-bound, not federated — the Expense/Area precedent.
//
// `qty` and `lowAt` are INTEGER milli-units of the item's own `unit` (STOCK_QTY_SCALE in @pos/shared/inventory):
// 150 ml of an L item is 150, so `$inc` only ever adds integers and never drifts. A plain Number, not Int32 —
// ml stock would overflow Int32 at about 2,147 L. `qty` may go negative: a sale is never blocked (owner D3).
// The unit is fixed once the item is created. A sale moves `qty` with one bulkWrite of `$inc`
// (lib/inventory/stock-move.ts) — nothing in inventory ever touches the menu item's own on/off flag.

/** The `v` every StockItem is written with (the ExpenseEntry `v` idiom). */
export const STOCK_ITEM_SCHEMA_VERSION = 1;

export interface IStockItem extends Document {
  name: string;
  unit: StockUnit;
  qty: number; // milli-units of `unit`, signed
  lowAt?: number; // milli-units; at or under it the item shows "Low"
  lastRatePaise?: number; // what one `unit` cost on the last purchase
  ownerProductId?: Types.ObjectId; // set when a menu item tracks its OWN stock (the one-tap link)
  archived?: boolean;
  v: number;
  createdAt: Date;
  updatedAt: Date;
}

const integer = { validator: Number.isInteger, message: "{PATH} must be a whole number of milli-units" };

export const stockItemSchema = new Schema<IStockItem>(
  {
    name: { type: String, required: true, trim: true, maxlength: STOCK_ITEM_NAME_MAX_LEN },
    unit: { type: String, enum: [...STOCK_UNITS], required: true },
    qty: { type: Number, default: 0, validate: integer },
    // omit-empty: NO defaults on the optional paths below — absent means "not set".
    lowAt: { type: Number, validate: integer },
    lastRatePaise: { type: Schema.Types.Int32 },
    ownerProductId: { type: Schema.Types.ObjectId },
    archived: { type: Boolean },
    // A small registry-style collection keeps its default (cafe.md): every row carries the version it was written at.
    v: { type: Number, required: true, default: STOCK_ITEM_SCHEMA_VERSION },
  },
  { timestamps: true },
);

// One stock item per menu item that tracks its own stock: makes the one-tap link idempotent (a racing second tap
// hits E11000 and re-reads). Partial on $exists, so the many items with no owner never collide on a null.
stockItemSchema.index(
  { ownerProductId: 1 },
  {
    unique: true,
    partialFilterExpression: { ownerProductId: { $exists: true } },
    name: "ownerProductId_unique_partial",
  },
);

// TTL-FORBIDDEN (build-rule #23): asserted at module load, like models/ExpenseEntry.ts.
assertSchemaTtlAllowed("StockItem", stockItemSchema);

// Reuse the compiled model across hot reloads / serverless invocations.
export const StockItem: Model<IStockItem> =
  (mongoose.models.StockItem as Model<IStockItem>) ??
  mongoose.model<IStockItem>("StockItem", stockItemSchema);
