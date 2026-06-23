import mongoose, { Schema, type Document, type Model } from "mongoose";
import { CUSTOMER_NOTES, type CustomerNote } from "@/lib/constants";

export interface ICustomer extends Document {
  name: string;
  mobile: string;
  visits: number;
  totalSpend: number;
  totalDue: number; // outstanding balance
  notes: CustomerNote;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true },
    // unique:true creates the index — no separate index() needed for mobile.
    mobile: { type: String, required: true, unique: true },
    visits: { type: Number, default: 0 },
    totalSpend: { type: Number, default: 0 },
    totalDue: { type: Number, default: 0 },
    notes: { type: String, enum: [...CUSTOMER_NOTES], default: "Regular" },
  },
  { timestamps: true },
);

customerSchema.index({ name: "text" });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Customer: Model<ICustomer> =
  (mongoose.models.Customer as Model<ICustomer>) ??
  mongoose.model<ICustomer>("Customer", customerSchema);
