import mongoose, { type FilterQuery, type Types, type UpdateQuery } from "mongoose";
import type { PrintJobKind } from "@pos/shared/print-job";
import { PRINT_JOBS_FOR_ME_LIMIT, type LeasedPrintJob, type PrintAckData, type PrintJobsForMe, type PrintLeaseData } from "@pos/shared/print-agent-wire";
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
import { PRINT_JOB_NO_PRINTER, printerWriterDeviceId, routablePrinters } from "@pos/shared/print-printers";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { printDeviceDrawsTokens } from "./print-device";
import { listPrinters } from "./print-printers";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";

// Printing redesign, Phase 1 (spec §7.2–7.6, §7.9): lease → write → ack. Every transition is a pure
// plan from @pos/shared/print-lifecycle, applied with ONE compare-and-set on {_id, status, epoch}.
// A racing writer (another tab, the sweep, a staff tap) makes the CAS miss: the caller re-reads and
// re-plans, never transitions twice. Never calls connectDB() (the route does that first). No
// console.*, strict TS, no `any`.

/** The fields every lifecycle read selects; lifecycleOf reads exactly these. */
export const PRINT_LIFECYCLE_SELECT = "kind status createdAt epoch attempts uncertainAttempts nextAttemptAt labels approvedAt lease";
const LEASE_SELECT = `${PRINT_LIFECYCLE_SELECT} label orderId payload copyIndex printerId copies`;
/** Bounds one lease call: each step expires, fails or dismisses one bad head, or loses one race. */
const LEASE_MAX_STEPS = 4;
const ACK_MAX_STEPS = 2;

export type PrintLifecycleRow = PrintJobLifecycleDoc & { _id: Types.ObjectId };
type LeaseHead = PrintLifecycleRow & { label: string; orderId?: string; payload: string; copyIndex?: number; printerId?: string; copies?: number };

/** A line's own jobs: its leased one, plus each queued job that is not parked as stale. needs-confirm and
 *  failed jobs are parked and never block the line. A leased job stays at the head whatever its age, so a line
 *  never has two writers. */
function lineJobs(nowMs: number): FilterQuery<IPrintJob> {
  return {
    status: { $in: ["queued", "leased"] },
    $or: [{ status: "leased" }, { createdAt: { $gte: drainAgeCutoff(nowMs) } }, { approvedAt: { $exists: true } }],
  };
}

/** One device's line (simple mode, spec §6.6/§7.6). Session 2C: a printers-mode job is aimed at its printer's
 *  writer too, but it waits on its printer's line (printerLineFilter), never here. */
export function printJobLineFilter(deviceId: string, nowMs: number): FilterQuery<IPrintJob> {
  return { targetDeviceId: deviceId, printerId: { $exists: false }, ...lineJobs(nowMs) };
}

/** Session 2C (spec §7.6, plan decision 1): one printer's line, on the partial printer-line index. */
export function printerLineFilter(printerId: string, nowMs: number): FilterQuery<IPrintJob> {
  return { printerId, ...lineJobs(nowMs) };
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

/** Applies a plan. false: another writer moved the job first, so re-read and re-plan. `fence` adds
 *  terms the plan depends on but the epoch does not cover (a lease: still this device's job).
 *  It publishes nothing (the Phase 2B gate, G-1): a job's final state had no listener on any device (the
 *  readback and the waiting-slips panel read the pulse; an agent leases only on "queued" aimed at it), so its
 *  Worker request bought nothing. */
export async function applyPrintJobPlan(
  id: Types.ObjectId,
  job: PrintJobLifecycle,
  patch: PrintJobPatch,
  fence: FilterQuery<IPrintJob> = {},
): Promise<boolean> {
  const res = await PrintJob.updateOne({ ...printJobCasFilter(id, job), ...fence }, printJobUpdateOf(patch) as UpdateQuery<IPrintJob>);
  return res.modifiedCount === 1;
}

/** Session 2B (plan decision 9): this device's line still holds a queued job (due now, or after its backoff),
 *  so its agent leases again after an ack; otherwise it waits for a nudge, its timer or a new slip, and a
 *  burst ends with no empty lease. One read on the line index. Phase 3 (the token fix's M-2): `tokens` false (a page
 *  that cannot print a token job, whose lease steps over it) leaves token jobs out, like its lease's kind fence. */
export async function printLineHasMore(deviceId: string, nowMs: number, tokens = true): Promise<boolean> {
  return (await PrintJob.findOne({ ...printJobLineFilter(deviceId, nowMs), ...leaseKindFence(tokens), status: "queued" }).select("_id").lean()) !== null;
}

/** Session 2C: the same, for a printer job's own printer line (the 2B gate's ruling R3). */
export async function printerLineHasMore(printerId: string, nowMs: number, tokens = true): Promise<boolean> {
  return (await PrintJob.findOne({ ...printerLineFilter(printerId, nowMs), ...leaseKindFence(tokens), status: "queued" }).select("_id").lean()) !== null;
}

type LeasedHead = { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number; printerId?: string; copies?: number };

/** The wire job for one lease (spec §7.3), from its row: leased by a lease request, made leased at creation,
 *  or delivered again to the tab that holds it (Session 2B, spec §7.11). */
export function leasedJobOf(head: LeasedHead, lease: { epoch: number; attempts: number; labels: PrintJobLabel[] }, payload: PrintJobPayload): LeasedPrintJob {
  return {
    id: String(head._id),
    epoch: lease.epoch,
    kind: head.kind,
    label: head.label,
    ...(head.orderId !== undefined ? { orderId: head.orderId } : {}),
    createdAt: head.createdAt.toISOString(),
    payload,
    labels: lease.labels,
    copyIndex: head.copyIndex ?? 0,
    attempt: lease.attempts,
    // Session 2C (printers mode): the printer it is for, and its copies (absent: 1).
    ...(head.printerId !== undefined ? { printerId: head.printerId } : {}),
    ...(head.copies !== undefined && head.copies > 1 ? { copies: head.copies } : {}),
  };
}

export function leasedPrintJobOf(head: LeasedHead, patch: PrintJobPatch, payload: PrintJobPayload, labels: PrintJobLabel[]): LeasedPrintJob {
  return leasedJobOf(head, { epoch: patch.set.epoch ?? 0, attempts: patch.set.attempts ?? 1, labels }, payload);
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

// tokenSlips (print-customization S7): this page can print a "token" job; every line's lease is fenced with
// leaseKindFence, so a page from before S7 steps over token jobs on its own line AND on the printer lines it writes.
type LeaseInput = { deviceId: string; tabId: string; dismissedBy: string; nowMs: number; tokenSlips: boolean };

/** Leases the head of one line (spec §7.6: at most one job per line). An expired lease at the head is
 *  applied lazily here, so a dead writer never blocks the line past 90 s. `claim`: fields the lease also sets
 *  (a printer line: its verified writer). */
async function leaseLineHead(
  line: FilterQuery<IPrintJob>,
  fence: FilterQuery<IPrintJob>,
  input: LeaseInput,
  claim?: PrintJobSet,
): Promise<{ job: LeasedPrintJob | null; retryAt: string | null }> {
  for (let step = 0; step < LEASE_MAX_STEPS; step++) {
    const head = await PrintJob.findOne(line).sort({ createdAt: 1, _id: 1 }).select(LEASE_SELECT).lean<LeaseHead>();
    if (head === null) return { job: null, retryAt: null };
    const job = lifecycleOf(head);
    if (job.status === "leased") {
      const expiry = planExpiry(job, input.nowMs);
      // A live lease (another tab of this device is writing it): the line waits for that ack.
      if (!expiry.ok) return { job: null, retryAt: job.lease?.expiresAt.toISOString() ?? null };
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
    if (!plan.ok) return { job: null, retryAt: plan.reason === "not-due" ? job.nextAttemptAt.toISOString() : null };
    const payload = await leaseEligibility(head, input.dismissedBy);
    if (payload === null) continue;
    // Fenced on the target too: a retarget (the sweep, a host change) between the read and this CAS moves the job
    // to another device's line, and this device must not win it then (1A review M5). A printer line is fenced on
    // its printer and claims the job for its writer, verified by the caller: a writer that changed since the job
    // was made (a re-saved printer) takes it at once, never spinning until the sweep (the 2C gate's review, I-3).
    const claimed = claim === undefined ? plan.patch : { ...plan.patch, set: { ...plan.patch.set, ...claim } };
    if (!(await applyPrintJobPlan(head._id, job, claimed, fence))) continue;
    return { job: leasedPrintJobOf(head, plan.patch, payload, job.labels), retryAt: null };
  }
  // Every step cleared one bad head or lost one race, so the line may still hold a printable job:
  // look again after the shortest backoff instead of waiting for a nudge (1A review M2).
  return { job: null, retryAt: new Date(input.nowMs + PRINT_BACKOFF_MS[0]).toISOString() };
}

/** Leases the head of this device's line, and (Session 2C, printers mode) the head of each printer line it names
 *  that it really writes: routable (as the sweep sees it), with this device as its writer, read fresh (§9.3,
 *  decision 1: one writer per printer). At most one job per line, so a stuck bar job never blocks the kitchen.
 *  retryAt: the soonest moment a line that gave no job can be leased again. */
export async function leasePrintJobs(input: LeaseInput & { printerIds?: readonly string[] }): Promise<PrintLeaseData> {
  type Line = { line: FilterQuery<IPrintJob>; fence: FilterQuery<IPrintJob>; claim?: PrintJobSet };
  const kindFence = leaseKindFence(input.tokenSlips);
  const lines: Line[] = [{ line: { ...printJobLineFilter(input.deviceId, input.nowMs), ...kindFence }, fence: { targetDeviceId: input.deviceId } }];
  if (input.printerIds !== undefined && input.printerIds.length > 0) {
    for (const printer of routablePrinters(await listPrinters())) {
      if (input.printerIds.includes(printer.id) && printerWriterDeviceId(printer) === input.deviceId) {
        lines.push({ line: { ...printerLineFilter(printer.id, input.nowMs), ...kindFence }, fence: { printerId: printer.id }, claim: { targetDeviceId: input.deviceId } });
      }
    }
  }
  const jobs: LeasedPrintJob[] = [];
  let retryAt: string | null = null;
  for (const { line, fence, claim } of lines) {
    const result = await leaseLineHead(line, fence, input, claim);
    if (result.job !== null) jobs.push(result.job);
    else if (result.retryAt !== null && (retryAt === null || result.retryAt < retryAt)) retryAt = result.retryAt;
  }
  return { jobs, retryAt };
}

/** The writer's report on one attempt (spec §7.2, §7.9). Idempotent per (job, epoch): a repeat of
 *  an applied "printed" ack answers status "printed", applied:false, reason "resolved". Phase 3 (the token fix's M-2):
 *  `tokenSlips` is the page's word that it prints token jobs (absent: what the device's last lease said). */
export async function ackPrintJob(input: PrintJobAck & { id: string; nowMs: number; tokenSlips?: true }): Promise<PrintAckData> {
  for (let step = 0; step < ACK_MAX_STEPS; step++) {
    const row = await PrintJob.findById(input.id).select(`${PRINT_LIFECYCLE_SELECT} printerId`).lean<PrintLifecycleRow & { printerId?: string }>();
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
      const nextAttemptAt = plan.patch.set.nextAttemptAt?.toISOString() ?? null;
      // Session 2B (decision 9): a job that left the line says whether the acking device's line holds more. A
      // job back in the queue is that line's head, and its nextAttemptAt says when. A failed read only drops
      // the hint (the agent then leases, as in Phase 1): the ack itself has landed. Session 2C: a printer job
      // asks its own printer's line (the 2B gate's ruling R3).
      if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };
      // Phase 3 (the token fix's M-2): a page that cannot print a token job is never told `more` for one.
      const tokens = input.tokenSlips === true || (await printDeviceDrawsTokens(input.deviceId).catch(() => true));
      const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs, tokens) : printLineHasMore(input.deviceId, input.nowMs, tokens)).catch(
        () => undefined,
      );
      return { applied: true, status: plan.patch.status, nextAttemptAt, ...(more !== undefined ? { more } : {}) };
    }
  }
  return { applied: false, status: null, nextAttemptAt: null, reason: "raced" };
}

/** The jobs a lease call could act on now: every line job aimed at this device (its own line, and since Session
 *  2C the lines of the printers it writes), less any lease still running. A running lease is being printed (often
 *  by this very tab, Session 2B's direct print), so counting it only kicked the agent into an empty lease after its
 *  ack; a lease that ran out still counts, so the lease call that expires it comes (spec §7.2). Printer jobs are
 *  counted whether or not the device's printer list knows them yet (the 2C gate's review, I-2). Phase 3 (the token
 *  fix's M-2): `tokens` false (a page that cannot print a token job) leaves token jobs out, as its lease does, so a
 *  waiting token no longer kicks it into an empty lease on every pulse. */
export function printJobsForMeFilter(deviceId: string, nowMs: number, tokens = true): FilterQuery<IPrintJob> {
  return {
    targetDeviceId: deviceId,
    ...lineJobs(nowMs),
    ...leaseKindFence(tokens),
    $nor: [{ status: "leased", "lease.expiresAt": { $gte: new Date(nowMs) } }],
  } as FilterQuery<IPrintJob>;
}

/** The wake's "jobs for me" (spec §7.3), and the pulse's: how many jobs wait for this device, the oldest, and
 *  the printers of the printer jobs among them (Session 2C: an agent whose list lacks one reads its printers). */
export async function readJobsForDevice(deviceId: string, nowMs: number, tokens = true): Promise<PrintJobsForMe> {
  const rows = await PrintJob.find(printJobsForMeFilter(deviceId, nowMs, tokens))
    .sort({ createdAt: 1, _id: 1 })
    .select("createdAt printerId")
    .limit(PRINT_JOBS_FOR_ME_LIMIT)
    .lean<{ createdAt: Date; printerId?: string }[]>();
  return jobsForMeOf(rows);
}

/** The answer from the rows, oldest first. Simple mode answers as before; beside printer jobs it says whether one
 *  waits on the device's own line (Session 2C's final review, I-2: the agent kicks only on jobs it can lease). */
export function jobsForMeOf(rows: readonly { createdAt: Date; printerId?: string }[]): PrintJobsForMe {
  const printerIds = [...new Set(rows.map((row) => row.printerId).filter((id): id is string => id !== undefined && id !== PRINT_JOB_NO_PRINTER))];
  const ownLine = printerIds.length > 0 && rows.some((row) => row.printerId === undefined);
  return { count: rows.length, oldestCreatedAt: rows[0]?.createdAt.toISOString() ?? null, ...(printerIds.length > 0 ? { printerIds } : {}), ...(ownLine ? { ownLine } : {}) };
}
