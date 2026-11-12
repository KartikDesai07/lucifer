import mongoose, { Schema, type Document, type Model } from "mongoose";
import { SUPPLIER_NAME_MAX_LEN, SUPPLIER_NOTE_MAX_LEN, SUPPLIER_PHONE_MAX_LEN } from "@pos/shared/inventory";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";

// Inventory lite Slice 5 (plan docs/superpowers/plans/2026-11-10-inventory-lite.md): someone the business buys stock
// from. Default-bound, not federated: the Expense/Area precedent. There is NO stored balance: what is owed is worked
// out on read from the supplier's StockEntry rows that still count (`$sum duePaise`), so a deleted purchase or payment
// drops out of the dues by itself. Archive is only ever `$set archived: true` (omit-empty: absent = active).

/** The `v` every Supplier is written with. */
export const SUPPLIER_SCHEMA_VERSION = 1;

export interface ISupplier extends Document {
  name: string;
  phone?: string;
  note?: string;
  archived?: boolean;
  v: number;
  createdAt: Date;
  updatedAt: Date;
}

export const supplierSchema = new Schema<ISupplier>(
  {
    name: { type: String, required: true, trim: true, maxlength: SUPPLIER_NAME_MAX_LEN },
    // omit-empty: NO defaults on the optional paths below. Absent means "not set".
    phone: { type: String, trim: true, maxlength: SUPPLIER_PHONE_MAX_LEN },
    note: { type: String, trim: true, maxlength: SUPPLIER_NOTE_MAX_LEN },
    archived: { type: Boolean },
    // A small registry-style collection keeps its default (cafe.md): every row carries the version it was written at.
    v: { type: Number, required: true, default: SUPPLIER_SCHEMA_VERSION },
  },
  { timestamps: true },
);

// TTL-FORBIDDEN (build-rule #23): asserted at module load, like models/StockItem.ts.
assertSchemaTtlAllowed("Supplier", supplierSchema);

// Reuse the compiled model across hot reloads / serverless invocations.
export const Supplier: Model<ISupplier> =
  (mongoose.models.Supplier as Model<ISupplier>) ?? mongoose.model<ISupplier>("Supplier", supplierSchema);
