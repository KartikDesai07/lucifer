import mongoose, { Schema, type Document, type Model } from "mongoose";
import {
  PRINT_JOB_DISMISS_REASONS,
  PRINT_JOB_KINDS,
  PRINT_JOB_STATUSES,
  type PrintJobDismissReason,
  type PrintJobKind,
  type PrintJobStatus,
} from "@pos/shared/print-job";
import {
  PRINT_JOB_LABELS,
  PRINT_JOB_LOG_EVENTS,
  type PrintJobLabel,
  type PrintJobLease,
  type PrintJobLogEntry,
} from "@pos/shared/print-lifecycle";

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
  // Phase 1 lifecycle (spec §6.5). All omit-empty: a row written before Phase 1 carries none of
  // them, and lifecycleOf (@pos/shared/print-lifecycle) reads a missing counter as 0.
  targetDeviceId?: string; // simple mode (§6.6): the one device that may lease it
  originDeviceId?: string; // the device that asked; its readback follows the job
  copyIndex?: number; // 0-based (copies arrive in Phase 2)
  epoch?: number; // +1 on every lease; an ack must name the lease's epoch
  lease?: PrintJobLease;
  attempts?: number; // leases granted
  uncertainAttempts?: number; // attempts that may have reached paper
  nextAttemptAt?: Date; // the backoff gate
  labels?: PrintJobLabel[]; // one printed banner; only ever added
  approvedAt?: Date; // staff tapped Print now / Print again
  printedAt?: Date; // set ONLY by an acknowledged write (or the cashier's "it printed")
  printedBy?: string; // the writing device's id, or the staff name
  lastError?: string;
  log?: PrintJobLogEntry[]; // the newest PRINT_JOB_LOG_MAX entries
  createdAt: Date;
  updatedAt: Date;
}

// Phase 1 subdocuments. No _id: they are values, not entities.
const printJobLeaseSchema = new Schema<PrintJobLease>(
  {
    deviceId: { type: String, required: true },
    tabId: { type: String, required: true },
    epoch: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { _id: false },
);
const printJobLogSchema = new Schema<PrintJobLogEntry>(
  {
    at: { type: Date, required: true },
    event: { type: String, enum: [...PRINT_JOB_LOG_EVENTS], required: true },
    deviceId: { type: String },
    detail: { type: String },
  },
  { _id: false },
);

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
    // Phase 1 lifecycle (spec §6.5). Omit-empty with NO defaults, for the same reason as above: a row
    // from before Phase 1 must stay exactly as it was. The arrays say `default: undefined` because
    // Mongoose would otherwise write [] onto every row.
    targetDeviceId: { type: String },
    originDeviceId: { type: String },
    copyIndex: { type: Number },
    epoch: { type: Number },
    lease: { type: printJobLeaseSchema },
    attempts: { type: Number },
    uncertainAttempts: { type: Number },
    nextAttemptAt: { type: Date },
    labels: { type: [{ type: String, enum: [...PRINT_JOB_LABELS] }], default: undefined },
    approvedAt: { type: Date },
    printedAt: { type: Date },
    printedBy: { type: String },
    lastError: { type: String },
    log: { type: [printJobLogSchema], default: undefined },
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

// Phase 1: one device's line, oldest first (lib/print-lease.ts printJobLineFilter, and the wake's
// jobsForMe read). The {status, nextAttemptAt, …} index in spec §6.5 is NOT created: no Phase 1
// query uses it, and on M0 every index costs storage and write amplification.
printJobSchema.index({ targetDeviceId: 1, status: 1, createdAt: 1, _id: 1 });
// No {originDeviceId, createdAt} index (the Phase 1 final gate, m-1): it served myRecentJobs, which the
// 1C gate dropped for the one attention feed; nothing reads by it.

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
