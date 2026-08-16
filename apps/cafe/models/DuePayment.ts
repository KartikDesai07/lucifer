import mongoose, { Schema, type Document, type Model } from "mongoose";
import { SETTLEMENT_PAY_MODES, type SettlementPayMode } from "@/lib/constants";

// FINANCIAL RECORD (CR1.4, extended for admin edit/soft-delete): one payment
// received against a customer's outstanding balance. Rows are never REMOVED
// — a delete is a soft mark (`deletedAt`/`deletedBy`/`deleteNote`) that keeps
// the row and the reason it stopped counting, and an edit REWRITES the row's
// amount/mode/note in place while pushing what it held before onto `edits`
// (append-only, like the order void trail). TTL-FORBIDDEN: this is money
// history, never a cache/session doc that may expire.
//
// Money is RUPEES-as-Number, matching the live v1 path (Customer.totalDue,
// Order.total/paidAmount) — NOT the Int32-paise ledger shape used by
// models/order.ledger.ts. That paise shape exists only on the ledger, which
// no v1 route imports; DuePayment sits alongside totalDue with no conversion.
//
// Deliberately NOT in the federated registry (FEDERATED_MODELS /
// cluster-registry SCHEMAS / cluster-router CORE_MODELS) — this is a
// plain default-bound model, v1-grade like models/Table.ts. Phase §4 says
// P5/P12 absorb it into the federation later; keep every row (never removed,
// even when soft-deleted) so that migration has a clean history to replay.
export interface IDuePayment extends Document {
  customerId: string; // string id — mirrors Order.customerId's storage
  amount: number; // rupees, whole-number (see money note above)
  mode: SettlementPayMode;
  note?: string;
  receivedBy: string; // staff name from the session, never client-supplied
  clientRef: string; // idempotency key
  // ── Admin soft-delete (a payment that turns out to be mis-recorded) ───────
  // Never removed — the row + WHY it stopped counting both stay. See
  // ACTIVE_DUE_PAYMENT (lib/due-payment.ts) for the single "does this count"
  // filter every sum of DuePayment amounts must apply.
  deletedAt?: Date;
  deletedBy?: string;
  deleteNote?: string;
  // ── Admin edit trail (append-only, like Order's orderVoidSchema) ─────────
  // Each entry is the row's amount/mode as they stood BEFORE that edit — the
  // CURRENT amount/mode/note live on the row's own top-level fields, same as
  // today.
  edits?: IDuePaymentEdit[];
  createdAt: Date;
  updatedAt: Date;
}

// Embedded, `{ _id: false }` — exactly like orderVoidSchema (models/Order.ts):
// a snapshot subdoc, not a reference, so it still reads correctly after the
// row it describes has since changed again.
export interface IDuePaymentEdit {
  at: Date;
  by: string; // staff name from the session, never client-supplied
  amount: number;
  // WIDE on purpose, same reasoning as the top-level `mode` below — an edit
  // trail entry is itself historical, so narrowing it to DUES_RECEIPT_MODES
  // could make an entry recorded before this fix fail validation.
  mode: SettlementPayMode;
  // The note as it stood BEFORE the edit. Without it an admin could rewrite or
  // blank a receipt's note — often the only record of HOW the money arrived
  // ("cheque 4412") — leaving no trace at all, while the trail entry it pushed
  // showed an unchanged amount/mode. Omitted when the row carried no note.
  note?: string;
}

const duePaymentEditSchema = new Schema<IDuePaymentEdit>(
  {
    at: { type: Date, required: true },
    by: { type: String, required: true },
    amount: { type: Number, required: true },
    mode: { type: String, enum: [...SETTLEMENT_PAY_MODES], required: true },
    note: { type: String, trim: true }, // omit-empty: NO default
  },
  { _id: false },
);

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
    // omit-empty: NO defaults on any of these three — a row that was never
    // deleted must not carry a stray deletedAt:null/deletedBy:""/etc, which
    // would defeat ACTIVE_DUE_PAYMENT's `{ $exists: false }` test.
    deletedAt: { type: Date },
    deletedBy: { type: String },
    deleteNote: { type: String, trim: true },
    edits: { type: [duePaymentEditSchema], default: undefined },
  },
  { timestamps: true },
);

// G9: both money-report aggregations (orders/summary, reports) $match this
// collection on a createdAt range — without this index each run plans a
// COLLSCAN. Mirrors the codebase's own convention (models/Order.ts).
duePaymentSchema.index({ createdAt: -1 });

// Serves the new per-customer history read (listDuePayments): newest-first,
// scoped to one customer. The existing single-field `customerId` index above
// can't satisfy a sorted read without an in-memory sort past a few rows.
duePaymentSchema.index({ customerId: 1, createdAt: -1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const DuePayment: Model<IDuePayment> =
  (mongoose.models.DuePayment as Model<IDuePayment>) ??
  mongoose.model<IDuePayment>("DuePayment", duePaymentSchema);
