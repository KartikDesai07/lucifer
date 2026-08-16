import mongoose, { Schema, type Document, type Model } from "mongoose";
import { TABLE_STATUSES, type TableStatus } from "@/lib/constants";

export interface ITable extends Document {
  tableNo: string; // T-1 to T-8
  status: TableStatus;
  currentOrderId?: string; // orderId of active order
  capacity: number;
  // Extra charge this table adds to a bill (whole rupees) and the name it
  // prints under. Admin config, not occupancy — the order lifecycle never
  // writes these. Rupees, not paise: this is a CORE registry collection like
  // Product.price, not the paise-encoded Order ledger.
  chargeAmount?: number;
  chargeLabel?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Table` export below stays for the live v1 routes.
export const tableSchema = new Schema<ITable>(
  {
    // unique:true creates the index — no separate index() needed for tableNo.
    tableNo: { type: String, required: true, unique: true },
    status: { type: String, enum: [...TABLE_STATUSES], default: "Available" },
    currentOrderId: { type: String },
    capacity: { type: Number, default: 4 },
    // No `default: 0` — an absent charge stays absent (omit-empty), so the
    // overwhelming majority of tables carry neither field at all.
    chargeAmount: { type: Number, min: 0 },
    chargeLabel: { type: String, trim: true },
  },
  { timestamps: true },
);

// Reuse the compiled model across hot reloads / serverless invocations.
export const Table: Model<ITable> =
  (mongoose.models.Table as Model<ITable>) ??
  mongoose.model<ITable>("Table", tableSchema);
