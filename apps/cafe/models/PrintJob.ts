import mongoose, { Schema, type Document, type Model } from "mongoose";
import {
  PRINT_JOB_DISMISS_REASONS,
  PRINT_JOB_KINDS,
  PRINT_JOB_STATUSES,
  type PrintJobDismissReason,
  type PrintJobKind,
  type PrintJobStatus,
} from "@pos/shared/print-job";

// Print-host plan (.claude/plan/v2/print-host-plan.md §B1) — a durable queued
// print job for the browser print host: any dashboard screen enqueues one of
// the five thermal documents (or a reprint / cancel-notice), and the ONE
// designated host PC drains the feed and prints it. This row is the queue
// entry, not the receipt itself — `payload` carries a render-complete,
// Zod-validated (route-level, PH-3) JSON snapshot the host renders from
// without touching the live Order.
//
// Deliberately NOT in the federated registry (FEDERATED_MODELS / cluster-
// registry SCHEMAS / cluster-router CORE_MODELS) — this is a plain
// default-bound model, v1-grade like models/OrderRequest.ts and
// models/DuePayment.ts. A print job is a pre-money operational row (the
// money is already committed in the Order it snapshots); it never needs the
// ledger's paise/sharding discipline.

export interface IPrintJob extends Document {
  kind: PrintJobKind;
  status: PrintJobStatus;
  payload: string; // JSON of PrintJobPayload — Zod-validated at the route, not here
  label: string; // UI-only, e.g. "KOT round 2 · T-4" — never printed
  orderId?: string; // absent for "eod"
  jobKey?: string; // dedupe key, no default (omit-empty) — reprints/eod/cancel-notice carry none
  queuedBy: string; // staff name from session
  // Set once by the claim CAS, never unset.
  claimedAt?: Date;
  claimedBy?: string;
  // Set once by whichever path resolves the job (dismiss, or claim-driven
  // print). All optional, no defaults (omit-empty): a still-queued job
  // carries none of them.
  dismissedAt?: Date;
  dismissReason?: PrintJobDismissReason;
  dismissedBy?: string; // staff name from session, mirrors queuedBy
  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA (not only the default-bound model), matching the
// codebase's schemas-not-models convention (models/OrderRequest.ts,
// models/Table.ts) — this model is NOT registered anywhere federated today;
// see the file-level comment.
export const printJobSchema = new Schema<IPrintJob>(
  {
    kind: { type: String, enum: [...PRINT_JOB_KINDS], required: true },
    // The ONE real default: a freshly enqueued job is always "queued".
    status: { type: String, enum: [...PRINT_JOB_STATUSES], default: "queued" },
    payload: { type: String, required: true },
    label: { type: String, required: true },
    orderId: { type: String },
    jobKey: { type: String },
    queuedBy: { type: String, required: true },
    claimedAt: { type: Date },
    claimedBy: { type: String },
    dismissedAt: { type: Date },
    dismissReason: { type: String, enum: [...PRINT_JOB_DISMISS_REASONS] },
    dismissedBy: { type: String },
  },
  { timestamps: true },
);

// Feed + both prune sweeps ride this, sorted oldest-first (kitchen order);
// the `_id` tie-break makes drain order deterministic for same-millisecond
// writes — Mongo's sort on duplicate keys is not otherwise stable.
printJobSchema.index({ status: 1, createdAt: 1, _id: 1 });

// Dedupe fence for the deterministic jobKeys (kot/bill/void/moved). Sparse
// because reprints, eod, and cancel-notice jobs carry no jobKey at all.
printJobSchema.index({ jobKey: 1 }, { unique: true, sparse: true });

// NO TTL index: ttl-guard's default-deny (packages/shared/src/ttl-guard.ts)
// allows exactly one registry TTL index platform-wide (Heartbeat) —
// everything else, including a resolved print job, is retained. Retention is
// instead a lazy prune sweep (prunePrintJobs, PH-3) mirroring
// lib/order-request-intake.ts's own createdAt-not-TTL discipline. This model
// is never walked by the registry's module-load TTL sweep since it is
// deliberately NOT federated, so its own test pins `assertSchemaTtlAllowed`
// directly (see lib/print-job-model.test.ts).

// Reuse the compiled model across hot reloads / serverless invocations.
export const PrintJob: Model<IPrintJob> =
  (mongoose.models.PrintJob as Model<IPrintJob>) ??
  mongoose.model<IPrintJob>("PrintJob", printJobSchema);
