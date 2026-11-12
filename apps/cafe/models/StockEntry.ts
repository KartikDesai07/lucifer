import mongoose, { Schema, Types, type Document, type Model } from "mongoose";
import { STOCK_ENTRY_KINDS, STOCK_ENTRY_NOTE_MAX_LEN, WASTE_REASONS, type StockEntryKind } from "@pos/shared/inventory";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";

// Inventory lite (plan docs/superpowers/plans/2026-11-10-inventory-lite.md): one thing that moved stock by hand. Slice 4
// writes wastage and counts; purchases and supplier payments (Slices 5-6) use the same collection, so every kind
// and the supplier money paths are declared now. Default-bound, not federated: the Expense/Area precedent.
//
// A row is never REMOVED: a delete is a soft mark (`deletedAt` / `deletedBy`, the ExpenseEntry idiom) and takes the
// row's lines back out of stock exactly once (a CAS on `deletedAt` absent). `lines[].qty` is SIGNED milli-units of the
// item's own unit, as the entry APPLIED it: a wastage is negative, a count is the change it made. `date` is the IST
// business day "YYYY-MM-DD". Money is Int32 paise. TTL-FORBIDDEN (stock and supplier-dues history).

/** The `v` every StockEntry is written with. */
export const STOCK_ENTRY_SCHEMA_VERSION = 1;

export interface IStockEntryLine {
  itemId: Types.ObjectId;
  qty: number; // signed milli-units of the item's own unit, as applied
  counted?: number; // a count: what was counted (milli-units)
  ratePaise?: number; // a purchase: what one unit cost (Slice 5)
  amountPaise?: number; // a purchase: this line's amount (Slice 5)
}

export interface IStockEntry extends Document {
  kind: StockEntryKind;
  date: string; // IST business day, "YYYY-MM-DD"
  lines?: IStockEntryLine[];
  supplierId?: Types.ObjectId; // Slices 5-6
  totalPaise?: number;
  paidPaise?: number;
  duePaise?: number; // signed: a purchase adds total - paid, a payment subtracts
  reason?: string; // a wastage: one of WASTE_REASONS
  note?: string;
  createdBy: string; // staff name from the session
  createdById: string; // session user id
  clientRef: string; // idempotency key (one per opened sheet)
  v: number;
  deletedAt?: Date;
  deletedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Schema.Types.Int32 forces a real BSON int32 (Number would store doubles); the cast is the ExpenseEntry idiom.
const Int32 = Schema.Types.Int32 as unknown as NumberConstructor;
const integer = { validator: Number.isInteger, message: "{PATH} must be a whole number of milli-units" };

const stockEntryLineSchema = new Schema<IStockEntryLine>(
  {
    itemId: { type: Schema.Types.ObjectId, required: true },
    qty: { type: Number, required: true, validate: integer },
    // omit-empty: NO defaults below.
    counted: { type: Number, validate: integer },
    ratePaise: { type: Int32 },
    amountPaise: { type: Int32 },
  },
  { _id: false },
);

export const stockEntrySchema = new Schema<IStockEntry>(
  {
    kind: { type: String, enum: [...STOCK_ENTRY_KINDS], required: true },
    date: { type: String, required: true },
    // omit-empty: NO defaults on the optional paths below. A row that was never deleted must not carry
    // deletedAt:null (it would defeat ACTIVE_STOCK_ENTRY's `{ $exists: false }`).
    lines: { type: [stockEntryLineSchema], default: undefined },
    supplierId: { type: Schema.Types.ObjectId },
    totalPaise: { type: Int32 },
    paidPaise: { type: Int32 },
    duePaise: { type: Int32 },
    reason: { type: String, enum: [...WASTE_REASONS] },
    note: { type: String, trim: true, maxlength: STOCK_ENTRY_NOTE_MAX_LEN },
    createdBy: { type: String, required: true },
    createdById: { type: String, required: true },
    clientRef: { type: String, required: true, unique: true },
    v: { type: Number, required: true, default: STOCK_ENTRY_SCHEMA_VERSION },
    deletedAt: { type: Date },
    deletedBy: { type: String },
  },
  { timestamps: true },
);

// The list reads newest first by business day, then by id (insert order), and pages on "<date>_<id>".
stockEntrySchema.index({ date: -1, _id: -1 }, { name: "date_-1__id_-1" });
// A supplier's history and dues (Slices 5-6). Partial: wastage and counts carry no supplier.
stockEntrySchema.index(
  { supplierId: 1, date: -1 },
  { partialFilterExpression: { supplierId: { $exists: true } }, name: "supplierId_1_date_-1_partial" },
);

/** The ONLY definition of "this entry counts": every list and every dues sum includes it. */
export const ACTIVE_STOCK_ENTRY = { deletedAt: { $exists: false } } as const;

// TTL-FORBIDDEN (build-rule #23): asserted at module load, like models/ExpenseEntry.ts.
assertSchemaTtlAllowed("StockEntry", stockEntrySchema);

// Reuse the compiled model across hot reloads / serverless invocations.
export const StockEntry: Model<IStockEntry> =
  (mongoose.models.StockEntry as Model<IStockEntry>) ??
  mongoose.model<IStockEntry>("StockEntry", stockEntrySchema);
