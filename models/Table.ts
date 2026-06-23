import mongoose, { Schema, type Document, type Model } from "mongoose";
import { TABLE_STATUSES, type TableStatus } from "@/lib/constants";

export interface ITable extends Document {
  tableNo: string; // T-1 to T-8
  status: TableStatus;
  currentOrderId?: string; // orderId of active order
  capacity: number;
  createdAt: Date;
  updatedAt: Date;
}

const tableSchema = new Schema<ITable>(
  {
    // unique:true creates the index — no separate index() needed for tableNo.
    tableNo: { type: String, required: true, unique: true },
    status: { type: String, enum: [...TABLE_STATUSES], default: "Available" },
    currentOrderId: { type: String },
    capacity: { type: Number, default: 4 },
  },
  { timestamps: true },
);

// Reuse the compiled model across hot reloads / serverless invocations.
export const Table: Model<ITable> =
  (mongoose.models.Table as Model<ITable>) ??
  mongoose.model<ITable>("Table", tableSchema);
