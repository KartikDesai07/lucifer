import mongoose, { Schema, type Document, type Model, type Types } from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// Task — the F3.7 trigger queue (fed-control-plane-design.json "enqueue
// ADD_DB_CLUSTER / ADD_CLOUD / FAILOVER"). One doc per raised condition; the
// later steps CONSUME them: F3.8 (ADD_DB_CLUSTER — hot-add M0 + registry-doc
// write + demote the filling ledger), F3.9 (ADD_CLOUD — the manual-signup
// checklist + paste), F3.10 (FAILOVER — registry role swap + alert). TTL-FREE
// (the only registry TTL is the Heartbeat collection, §3.4); growth is bounded
// by real trigger occurrences + the ingest's reopen-snooze.
//
// Dedupe: `openKey` = `${tenantId}|${type}` WHILE the task is open, $unset on
// close, under a PARTIAL unique index (the Tenant.domain_primary_unique
// precedent — partial over $exists, never sparse) — so at most ONE open task
// per (tenant, type) exists no matter how many heartbeats re-trip, and the
// enqueue upsert is race-safe (a concurrent duplicate loses on E11000).
// ─────────────────────────────────────────────────────────────────────────────

export type TaskType = "ADD_DB_CLUSTER" | "ADD_CLOUD" | "FAILOVER";
export type TaskStatus = "open" | "in-progress" | "done" | "dismissed";

export const TASK_TYPES: readonly TaskType[] = ["ADD_DB_CLUSTER", "ADD_CLOUD", "FAILOVER"];

/** The open-task dedupe key. Present ⇔ status is 'open'/'in-progress'. */
export function taskOpenKey(tenantId: Types.ObjectId | string, type: TaskType): string {
  return `${String(tenantId)}|${type}`;
}

export interface ITaskPayload {
  /** ADD_DB_CLUSTER: the ≥75% write ledger (the DEMOTE-to-archive intent F3.8
   *  executes — never demoted here; demoting before a replacement exists would
   *  leave no orders-current). `core` + bootstrap:true = the single-cluster era
   *  (no registry doc yet): F3.8 then CREATES the first ledger doc; nothing is
   *  demoted (core is the reference cluster, not an archivable ledger). */
  fillingLedger?: string;
  usedPct?: number;
  bootstrap?: boolean;
  /** ok-state standby rows seen in the tripping heartbeat — F3.8's promote-vs-
   *  mint hint (a warm standby can be promoted instead of creating an M0). */
  standbysOk?: number;
  storagePct?: number;
  bandwidthPct?: number;
  creditsPct?: number;
  /** FAILOVER via ping-counting: the consecutive-miss count that tripped. */
  missedPings?: number;
  /** FAILOVER provenance: 'swap' = the Worker already moved the origin
   *  (bookkeeping + alert); 'pings' = dual-outage alarm (nothing serving). */
  via?: "swap" | "pings";
}

export interface ITask extends Document {
  tenantId: Types.ObjectId;
  tenantSlug: string; // denormalized for the panel list (no join)
  type: TaskType;
  status: TaskStatus;
  reason: string; // one human line, e.g. "ledger pos-orders-a at 76% — no room"
  payload?: ITaskPayload;
  openKey?: string; // present while open — see taskOpenKey()
  run?: ITaskRun;
  createdAt: Date;
  updatedAt: Date;
}

const taskPayloadSchema = new Schema<ITaskPayload>(
  {
    fillingLedger: String,
    usedPct: Number,
    bootstrap: Boolean,
    standbysOk: Number,
    storagePct: Number,
    bandwidthPct: Number,
    creditsPct: Number,
    missedPings: Number,
    via: { type: String, enum: ["swap", "pings"] },
  },
  { _id: false, minimize: true },
);

// ─────────────────────────────────────────────────────────────────────────────
// F3.8 hot-add run-state carrier (additive, omit-empty — a task never touching
// the hot-add machine stores no `run` bytes at all). `run.step` = the LAST
// COMPLETED step (the provisioner convention, resume runs `hotAddStepsAfter`);
// `run.leaseToken`/`leaseUntil` fence EVERY machine write to this task doc so a
// killed pump can't corrupt a successor (A4); `run.approvedBy`/`approvedAt` is
// the ONE step-up-authorized claim that authorizes every continuation pump to
// completion (A1) — the machine refuses to advance a task lacking approvedBy.
// `run.target` is the resume anchor stamped by the `target` step and reused
// VERBATIM afterward (re-deriving mid-run risks minting a second cluster).
// ─────────────────────────────────────────────────────────────────────────────

export interface ITaskRunTarget {
  mode: "mint" | "promote";
  tag: string;
  clusterId: string;
  projectName?: string;
  projectId?: string;
  /** R2 (post-review fix wave): stamped after a successful createM0 (incl. its
   *  409-adopt return) so a resumed pump never re-calls createM0 — a re-call
   *  every pump silently re-creates a cluster deleted externally, masking the
   *  cluster step's 404 branch. */
  m0Created?: boolean;
  standbyId?: string;
  oldActiveId: string;
  bootstrap?: boolean;
}

export interface ITaskRun {
  step?: string;
  lastError?: string;
  leaseToken?: string;
  leaseUntil?: Date;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  target?: ITaskRunTarget;
}

const taskRunTargetSchema = new Schema<ITaskRunTarget>(
  {
    mode: { type: String, enum: ["mint", "promote"], required: true },
    tag: { type: String, required: true },
    clusterId: { type: String, required: true },
    projectName: String,
    projectId: String,
    m0Created: Boolean,
    standbyId: String,
    oldActiveId: { type: String, required: true },
    bootstrap: Boolean,
  },
  { _id: false, minimize: true },
);

const taskRunSchema = new Schema<ITaskRun>(
  {
    step: String,
    lastError: String,
    leaseToken: String,
    leaseUntil: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: "HubUser" },
    approvedAt: Date,
    target: { type: taskRunTargetSchema },
  },
  { _id: false, minimize: true },
);

const taskSchema = new Schema<ITask>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    tenantSlug: { type: String, required: true, trim: true },
    type: { type: String, enum: TASK_TYPES, required: true },
    status: {
      type: String,
      enum: ["open", "in-progress", "done", "dismissed"],
      required: true,
      default: "open",
    },
    reason: { type: String, required: true },
    payload: { type: taskPayloadSchema },
    openKey: String,
    run: { type: taskRunSchema },
  },
  { timestamps: true, minimize: true },
);

// At most ONE open task per (tenant, type): partial unique over docs that HAVE
// an openKey (closed tasks $unset it and fall out of the index).
taskSchema.index(
  { openKey: 1 },
  {
    unique: true,
    partialFilterExpression: { openKey: { $exists: true } },
    name: "task_open_unique",
  },
);
// The panel queue (newest first per status) + the ingest's reopen-snooze read.
taskSchema.index({ status: 1, createdAt: -1 });
taskSchema.index({ tenantId: 1, type: 1, updatedAt: -1 });

export const Task: Model<ITask> =
  (mongoose.models.Task as Model<ITask>) ?? mongoose.model<ITask>("Task", taskSchema);

export { taskSchema, taskPayloadSchema, taskRunSchema, taskRunTargetSchema };
