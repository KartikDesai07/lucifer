import mongoose, { type FilterQuery, type Types, type UpdateQuery } from "mongoose";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";
import {
  PRINT_BACKOFF_MS,
  PRINT_JOB_LOG_MAX,
  lifecycleOf,
  planAck,
  planExpiry,
  planLease,
  planLimits,
  type PrintJobAck,
  type PrintJobLabel,
  type PrintJobLifecycle,
  type PrintJobLifecycleDoc,
  type PrintJobLogEntry,
  type PrintJobPatch,
  type PrintJobSet,
} from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { publishPrintStatus } from "@/lib/realtime-publish";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";

// Printing redesign, Phase 1 (spec §7.2–7.6, §7.9): lease → write → ack. Every transition is a pure
// plan from @pos/shared/print-lifecycle, applied with ONE compare-and-set on {_id, status, epoch}.
// A racing writer (another tab, the sweep, a staff tap) makes the CAS miss: the caller re-reads and
// re-plans, never transitions twice. Never calls connectDB() (the route does that first). No
// console.*, strict TS, no `any`.

/** The fields every lifecycle read selects; lifecycleOf reads exactly these. */
export const PRINT_LIFECYCLE_SELECT = "kind status createdAt epoch attempts uncertainAttempts nextAttemptAt labels approvedAt lease";
const LEASE_SELECT = `${PRINT_LIFECYCLE_SELECT} label orderId payload copyIndex`;
/** Bounds one lease call: each step expires, fails or dismisses one bad head, or loses one race. */
const LEASE_MAX_STEPS = 4;
const ACK_MAX_STEPS = 2;
/** The wake's jobsForMe counts up to this many: the agent only needs "some" and the oldest age. */
export const PRINT_JOBS_FOR_ME_LIMIT = 20;

export type PrintLifecycleRow = PrintJobLifecycleDoc & { _id: Types.ObjectId };
type LeaseHead = PrintLifecycleRow & { label: string; orderId?: string; payload: string; copyIndex?: number };

/** One device's line (simple mode, spec §6.6/§7.6): its leased job, plus each queued job that is
 *  not parked as stale. needs-confirm and failed jobs are parked and never block the line. */
export function printJobLineFilter(deviceId: string, nowMs: number): FilterQuery<IPrintJob> {
  return {
    targetDeviceId: deviceId,
    status: { $in: ["queued", "leased"] },
    // A leased job stays at the head whatever its age, so a line never has two writers.
    $or: [{ status: "leased" }, { createdAt: { $gte: drainAgeCutoff(nowMs) } }, { approvedAt: { $exists: true } }],
  };
}

/** The CAS fence: the status and epoch the plan was computed from. A row from before Phase 1 has no
 *  epoch field at all, and lifecycleOf reads that as 0. */
export function printJobCasFilter(id: unknown, job: Pick<PrintJobLifecycle, "status" | "epoch">): FilterQuery<IPrintJob> {
  return { _id: id, status: job.status, epoch: job.epoch === 0 ? { $in: [0, null] } : job.epoch } as FilterQuery<IPrintJob>;
}

export interface PrintJobUpdate {
  $set: PrintJobSet;
  $unset?: Partial<Record<"lease" | "lastError", 1>>;
  $push: { log: { $each: PrintJobLogEntry[]; $slice: number } };
}

export function printJobUpdateOf(patch: PrintJobPatch): PrintJobUpdate {
  const update: PrintJobUpdate = { $set: patch.set, $push: { log: { $each: [patch.log], $slice: -PRINT_JOB_LOG_MAX } } };
  if (patch.unset.length > 0) {
    update.$unset = Object.fromEntries(patch.unset.map((p) => [p, 1])) as PrintJobUpdate["$unset"];
  }
  return update;
}

/** The statuses an ordering device's readback hears about at once (spec §10, §17.2: a job's creation
 *  and its final state); the pulse stays the fallback. */
const PRINT_STATUS_PUBLISHED: ReadonlySet<PrintJobStatus> = new Set<PrintJobStatus>(["printed", "needs-confirm", "failed", "dismissed"]);

/** Applies a plan. false: another writer moved the job first, so re-read and re-plan. `fence` adds
 *  terms the plan depends on but the epoch does not cover (a lease: still this device's job). */
export async function applyPrintJobPlan(
  id: Types.ObjectId,
  job: PrintJobLifecycle,
  patch: PrintJobPatch,
  fence: FilterQuery<IPrintJob> = {},
): Promise<boolean> {
  const res = await PrintJob.updateOne({ ...printJobCasFilter(id, job), ...fence }, printJobUpdateOf(patch) as UpdateQuery<IPrintJob>);
  const applied = res.modifiedCount === 1;
  // Fire-and-forget, after the write: a lost frame costs the readback one pulse, never the transition.
  if (applied && PRINT_STATUS_PUBLISHED.has(patch.status)) publishPrintStatus({ id: String(id), status: patch.status });
  return applied;
}

export function leasedPrintJobOf(
  head: { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number },
  patch: PrintJobPatch,
  payload: PrintJobPayload,
  labels: PrintJobLabel[],
): LeasedPrintJob {
  return {
    id: String(head._id),
    epoch: patch.set.epoch ?? 0,
    kind: head.kind,
    label: head.label,
    ...(head.orderId !== undefined ? { orderId: head.orderId } : {}),
    createdAt: head.createdAt.toISOString(),
    payload,
    labels,
    copyIndex: head.copyIndex ?? 0,
    attempt: patch.set.attempts ?? 1,
  };
}

/** The claim path's gates, unchanged (print-queue-claim.ts): a payload that no longer parses, or a
 *  KOT/bill whose order was cancelled (or whose round was voided), is dismissed and never printed.
 *  null: the head was dismissed; take the next one. */
async function leaseEligibility(head: LeaseHead, dismissedBy: string): Promise<PrintJobPayload | null> {
  const id = String(head._id);
  let payload: PrintJobPayload;
  try {
    const parsed = printJobPayloadSchema.safeParse(JSON.parse(head.payload) as unknown);
    if (!parsed.success) throw new Error("invalid payload");
    payload = parsed.data;
  } catch {
    await dismissPrintJob({ id, reason: "invalid-payload", dismissedBy });
    return null;
  }
  if (printJobNeedsOrderRead(payload) && head.orderId !== undefined) {
    if (!mongoose.isValidObjectId(head.orderId)) {
      await dismissPrintJob({ id, reason: "invalid-payload", dismissedBy });
      return null;
    }
    const order = await Order.findById(head.orderId).select("status items.kotRound").lean();
    const verdict = printJobEligibility(payload, order);
    if (!verdict.eligible) {
      await dismissPrintJob({ id, reason: verdict.reason, dismissedBy });
      return null;
    }
  }
  return payload;
}

/** Deploy skew (print-customization S7): a tab still running a page from before the token slip turns a
 *  leased "token" job into no slip at all and its print bridge throws while rendering it. Such a tab never
 *  says `tokenSlips`, so its lease steps over token jobs: they wait queued, behind nothing, for a page
 *  that can print them (a reload), and every other slip in the line still prints in order. */
export function leaseKindFence(tokenSlips: boolean): FilterQuery<IPrintJob> {
  return tokenSlips ? {} : { kind: { $ne: "token" } };
}

/** Leases the head of this device's line (spec §7.6: at most one job per printer). An expired lease
 *  at the head is applied lazily here, so a dead writer never blocks the line past 90 s. */
export async function leasePrintJobs(input: {
  deviceId: string;
  tabId: string;
  dismissedBy: string;
  nowMs: number;
  tokenSlips: boolean;
}): Promise<PrintLeaseData> {
  for (let step = 0; step < LEASE_MAX_STEPS; step++) {
    const head = await PrintJob.findOne({ ...printJobLineFilter(input.deviceId, input.nowMs), ...leaseKindFence(input.tokenSlips) })
      .sort({ createdAt: 1, _id: 1 })
      .select(LEASE_SELECT)
      .lean<LeaseHead>();
    if (head === null) return { jobs: [], retryAt: null };
    const job = lifecycleOf(head);
    if (job.status === "leased") {
      const expiry = planExpiry(job, input.nowMs);
      // A live lease (another tab of this device is writing it): the line waits for that ack.
      if (!expiry.ok) return { jobs: [], retryAt: job.lease?.expiresAt.toISOString() ?? null };
      await applyPrintJobPlan(head._id, job, expiry.patch);
      continue;
    }
    const limits = planLimits(job, input.nowMs);
    if (limits.ok) {
      await applyPrintJobPlan(head._id, job, limits.patch);
      continue;
    }
    const plan = planLease(job, input, input.nowMs);
    // In backoff, the head HOLDS the line (kitchen order is kept); the agent sets one timer.
    if (!plan.ok) return { jobs: [], retryAt: plan.reason === "not-due" ? job.nextAttemptAt.toISOString() : null };
    const payload = await leaseEligibility(head, input.dismissedBy);
    if (payload === null) continue;
    // Fenced on the target too: a retarget (the sweep, a host change) between the read and this CAS
    // moves the job to another device's line, and this device must not win it then (1A review M5).
    if (!(await applyPrintJobPlan(head._id, job, plan.patch, { targetDeviceId: input.deviceId }))) continue;
    return { jobs: [leasedPrintJobOf(head, plan.patch, payload, job.labels)], retryAt: null };
  }
  // Every step cleared one bad head or lost one race, so the line may still hold a printable job:
  // look again after the shortest backoff instead of waiting for a nudge (1A review M2).
  return { jobs: [], retryAt: new Date(input.nowMs + PRINT_BACKOFF_MS[0]).toISOString() };
}

/** The writer's report on one attempt (spec §7.2, §7.9). Idempotent per (job, epoch): a repeat of
 *  an applied "printed" ack answers status "printed", applied:false, reason "resolved". */
export async function ackPrintJob(input: PrintJobAck & { id: string; nowMs: number }): Promise<PrintAckData> {
  for (let step = 0; step < ACK_MAX_STEPS; step++) {
    const row = await PrintJob.findById(input.id).select(PRINT_LIFECYCLE_SELECT).lean<PrintLifecycleRow>();
    if (row === null) return { applied: false, status: null, nextAttemptAt: null, reason: "not-found" };
    const job = lifecycleOf(row);
    const plan = planAck(job, input, input.nowMs);
    if (!plan.ok) {
      // An ack from an attempt that was leased again: kept in the log, otherwise ignored (§7.9).
      if (plan.log !== undefined) {
        await PrintJob.updateOne({ _id: row._id }, { $push: { log: { $each: [plan.log], $slice: -PRINT_JOB_LOG_MAX } } });
      }
      return { applied: false, status: job.status, nextAttemptAt: null, reason: plan.reason };
    }
    if (await applyPrintJobPlan(row._id, job, plan.patch)) {
      return { applied: true, status: plan.patch.status, nextAttemptAt: plan.patch.set.nextAttemptAt?.toISOString() ?? null };
    }
  }
  return { applied: false, status: null, nextAttemptAt: null, reason: "raced" };
}

/** The wake's "jobs for me" (spec §7.3): how many jobs wait in this device's line, and the oldest. */
export async function readJobsForDevice(deviceId: string, nowMs: number): Promise<{ count: number; oldestCreatedAt: string | null }> {
  const rows = await PrintJob.find(printJobLineFilter(deviceId, nowMs))
    .sort({ createdAt: 1, _id: 1 })
    .select("createdAt")
    .limit(PRINT_JOBS_FOR_ME_LIMIT)
    .lean<{ createdAt: Date }[]>();
  return { count: rows.length, oldestCreatedAt: rows[0]?.createdAt.toISOString() ?? null };
}
