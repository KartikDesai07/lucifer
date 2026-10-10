import mongoose, { Schema, Types, type Document, type Model } from "mongoose";
import { EXPENSE_NAME_MAX_LEN, EXPENSE_NOTE_MAX_LEN, EXPENSE_PAYMENT_MODES, type ExpensePaymentMode } from "@pos/shared/expense";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";

// FINANCIAL RECORD (Step EXP, owner 2026-10-10): one thing the cafe spent money
// on. Rows are never REMOVED — a delete is a soft mark (`deletedAt`/`deletedBy`)
// and an edit rewrites the row in place while pushing what it held BEFORE onto
// `edits` (append-only, the DuePayment / order-void idiom). TTL-FORBIDDEN:
// money history, asserted at module load below.
//
// D1: the model is named ExpenseEntry on purpose — it is phase P12's own
// ExpenseEntry (phase-P12-accounting.md, P12-EX), so P12 adopts it in place with
// no migration. D2: money is Int32 PAISE (`amountPaise`), `date` is the IST
// business day as a "YYYY-MM-DD" string (no time of day, so a string range
// compare is exact), `categoryId` points at ExpenseCategory, `v` is the schema
// version. `paymentMode` is the owner's four-way pick; P12's `paidFrom`
// (cash | bank) derives from it on read (expensePaidFrom, shared/expense.ts).
//
// D3: NOT federated (the DuePayment / Area precedent) — a plain default-bound
// model, never in FEDERATED_MODELS / the cluster registry.
export interface IExpenseEntryEdit {
  at: Date;
  by: string; // staff name from the session, never client-supplied
  name: string;
  categoryId: Types.ObjectId;
  date: string;
  amountPaise: number;
  paymentMode: ExpensePaymentMode;
  note?: string; // as it stood BEFORE the edit; omitted when there was none
}

export interface IExpenseEntry extends Document {
  name: string;
  categoryId: Types.ObjectId;
  date: string; // IST business day, "YYYY-MM-DD"
  amountPaise: number;
  paymentMode: ExpensePaymentMode;
  note?: string;
  createdBy: string; // staff name from the session
  createdById: string; // session user id — what "added by you" filters on
  clientRef: string; // idempotency key (one per opened sheet)
  v: number;
  deletedAt?: Date;
  deletedBy?: string;
  edits?: IExpenseEntryEdit[];
  createdAt: Date;
  updatedAt: Date;
}

// Schema.Types.Int32 forces a real BSON int32 (Number would store doubles); the
// cast is the order.ledger.ts idiom for its typing.
const Int32 = Schema.Types.Int32 as unknown as NumberConstructor;

const expenseEditSchema = new Schema<IExpenseEntryEdit>(
  {
    at: { type: Date, required: true },
    by: { type: String, required: true },
    name: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
    amountPaise: { type: Int32, required: true },
    paymentMode: { type: String, enum: [...EXPENSE_PAYMENT_MODES], required: true },
    note: { type: String }, // omit-empty: NO default
  },
  { _id: false },
);

export const expenseEntrySchema = new Schema<IExpenseEntry>(
  {
    name: { type: String, required: true, trim: true, maxlength: EXPENSE_NAME_MAX_LEN },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
    amountPaise: { type: Int32, required: true },
    paymentMode: { type: String, enum: [...EXPENSE_PAYMENT_MODES], required: true },
    // omit-empty: NO defaults on note / deletedAt / deletedBy / edits — a row that
    // was never deleted must not carry deletedAt:null (it would defeat
    // ACTIVE_EXPENSE's `{ $exists: false }`), and `edits` stays absent until the
    // first edit.
    note: { type: String, trim: true, maxlength: EXPENSE_NOTE_MAX_LEN },
    createdBy: { type: String, required: true },
    createdById: { type: String, required: true },
    clientRef: { type: String, required: true, unique: true },
    v: { type: Number, required: true },
    deletedAt: { type: Date },
    deletedBy: { type: String },
    edits: { type: [expenseEditSchema], default: undefined },
  },
  { timestamps: true },
);

// 4 indexes with _id (D12): clientRef (unique, field-level above), the
// newest-first list / range sort, and the staff "added by me today" read.
expenseEntrySchema.index({ date: -1, createdAt: -1 });
expenseEntrySchema.index({ createdById: 1, createdAt: -1 });

// ACTIVE_EXPENSE — the ONLY definition of "this expense counts". Every list,
// sum and report must include it, or a deleted row would keep counting.
export const ACTIVE_EXPENSE = { deletedAt: { $exists: false } } as const;

// TTL-FORBIDDEN (build-rule #23): asserted at module load, like the ledger
// schemas (models/daily-rollup.ledger.ts).
assertSchemaTtlAllowed("ExpenseEntry", expenseEntrySchema);

// Reuse the compiled model across hot reloads / serverless invocations.
export const ExpenseEntry: Model<IExpenseEntry> =
  (mongoose.models.ExpenseEntry as Model<IExpenseEntry>) ??
  mongoose.model<IExpenseEntry>("ExpenseEntry", expenseEntrySchema);
