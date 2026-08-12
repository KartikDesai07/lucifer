import mongoose, { Schema, type Document, type Model } from "mongoose";
import { CUSTOMER_NOTES, type CustomerNote } from "@/lib/constants";

export interface ICustomer extends Document {
  name: string;
  mobile: string;
  visits: number;
  totalSpend: number;
  totalDue: number; // outstanding balance
  notes: CustomerNote;
  // Idempotency markers for the F2.5 CRM rollup (lib/customer-rollup.ts): the
  // orderIds whose contribution has been applied to this projection, newest last,
  // pruned to APPLIED_ORDERS_MAX. Landed by F2.5 (ownership reconciled vs
  // build-rule #60 — P5 still owns `appliedLoyaltyOrders` + the reconcileLedger
  // rewrite onto the same filter-predicate form).
  appliedOrders?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Customer` export below stays for the live v1 routes. Customer
// lives on the CORE cluster (unique mobile index, CRM rollup target) — never sharded.
export const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true },
    // unique:true creates the index — no separate index() needed for mobile.
    mobile: { type: String, required: true, unique: true },
    visits: { type: Number, default: 0 },
    totalSpend: { type: Number, default: 0 },
    totalDue: { type: Number, default: 0 },
    notes: { type: String, enum: [...CUSTOMER_NOTES], default: "Regular" },
    // F2.5 rollup dedupe markers. `default: undefined` suppresses Mongoose's
    // automatic empty-[] so an untouched customer stores NO field (omit-empty,
    // #8); `select: false` keeps this internal array out of every read/API
    // payload (the rollup only ever references it in update FILTERS, which
    // projection does not affect). NO index — it is never queried standalone.
    appliedOrders: { type: [String], default: undefined, select: false },
  },
  { timestamps: true },
);

customerSchema.index({ name: "text" });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Customer: Model<ICustomer> =
  (mongoose.models.Customer as Model<ICustomer>) ??
  mongoose.model<ICustomer>("Customer", customerSchema);
