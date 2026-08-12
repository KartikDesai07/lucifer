import mongoose, { Schema, type Document, type Model } from "mongoose";
import { SETTLEMENT_PAY_MODES, type SettlementPayMode } from "@/lib/constants";

// APPEND-ONLY financial record (CR1.4): one payment received against a
// customer's outstanding balance. Nothing ever updates or deletes a row here
// — a correction is a new row, same as the order void trail. TTL-FORBIDDEN:
// this is money history, never a cache/session doc that may expire.
//
// Money is RUPEES-as-Number, matching the live v1 path (Customer.totalDue,
// Order.total/paidAmount) — NOT the Int32-paise ledger shape used by
// models/order.ledger.ts. That paise shape exists only on the ledger, which
// no v1 route imports; DuePayment sits alongside totalDue with no conversion.
//
// Deliberately NOT in the federated registry (FEDERATED_MODELS /
// cluster-registry SCHEMAS / cluster-router CORE_MODELS) — this is a
// plain default-bound model, v1-grade like models/Table.ts. Phase §4 says
// P5/P12 absorb it into the federation later; keep the collection append-only
// so that migration has a clean history to replay.
export interface IDuePayment extends Document {
  customerId: string; // string id — mirrors Order.customerId's storage
  amount: number; // rupees, whole-number (see money note above)
  mode: SettlementPayMode;
  note?: string;
  receivedBy: string; // staff name from the session, never client-supplied
  clientRef: string; // idempotency key
  createdAt: Date;
  updatedAt: Date;
}

export const duePaymentSchema = new Schema<IDuePayment>(
  {
    // customerId is a plain indexed String, matching how Order.customerId is
    // stored and queried — the aggregations built on top of this collection
    // (duesPaidTotal, the day-summary fold) must match documents written by
    // the order lifecycle's own customerId convention.
    customerId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    // WIDE on purpose (G7): this collection is append-only history, so
    // narrowing this stored enum to the DUES_RECEIPT_MODES receipt surface
    // could make an existing row fail validation. The WRITE surface is
    // narrowed instead, deliberately, by duePaymentSchema (Zod) — this model
    // enum stays SETTLEMENT_PAY_MODES so historical rows keep validating.
    mode: { type: String, enum: [...SETTLEMENT_PAY_MODES], required: true },
    note: { type: String, trim: true }, // omit-empty: NO default
    receivedBy: { type: String, required: true },
    clientRef: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

// G9: both money-report aggregations (orders/summary, reports) $match this
// collection on a createdAt range — without this index each run plans a
// COLLSCAN. Mirrors the codebase's own convention (models/Order.ts).
duePaymentSchema.index({ createdAt: -1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const DuePayment: Model<IDuePayment> =
  (mongoose.models.DuePayment as Model<IDuePayment>) ??
  mongoose.model<IDuePayment>("DuePayment", duePaymentSchema);
