import type { FilterQuery } from "mongoose";
import {
  PRINT_JOB_DISMISS_REASONS,
  PRINT_JOB_PULSE_LIMIT,
  PRINT_JOB_RESOLVED_LIMIT,
  PRINT_JOB_STALE_LIMIT,
  type PrintJobDismissReason,
  type PrintJobFeedRow,
  type PrintJobKind,
  type PrintJobResolvedRow,
  type PrintJobStatus,
  type PrintWakeData,
} from "@pos/shared/print-job";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { drainAgeCutoff, resolvedPruneCutoff } from "./print-queue";

// Print-host plan (.claude/plan/v2/print-host-plan.md §B4) — the pulse feed
// reads: the D1/D2/D3 row shapers and readPrintJobFeeds itself, split out of
// print-queue.ts to keep both files under the ~300-line cap. The feed READS
// are the pulse's half of this lib; the writes (enqueue/dismiss/prune) stay
// in print-queue.ts, which this file imports its cutoff helpers from — one
// place for cutoffs shared by both halves. Never calls connectDB() — the
// route does that first. No console.*, strict TS, no `any`.

export function printJobFeedRowOf(doc: {
  _id: unknown;
  kind: PrintJobKind;
  label: string;
  orderId?: string;
  createdAt: Date;
}): PrintJobFeedRow {
  return {
    id: String(doc._id),
    kind: doc.kind,
    label: doc.label,
    // Omit-empty: an eod job carries no orderId at all on the wire.
    ...(doc.orderId !== undefined ? { orderId: doc.orderId } : {}),
    createdAt: doc.createdAt.toISOString(),
  };
}

export function printJobResolvedRowOf(doc: {
  _id: unknown;
  status: PrintJobStatus;
  dismissReason?: string;
}): PrintJobResolvedRow | null {
  // This row feeds a best-effort readback on the app's hottest path (the 20s
  // pulse, wrapped in pos-pulse.ts's fail-soft catch): the ONLY production
  // caller is readPrintJobFeeds's Promise.all below, so a THROW here rejects
  // the whole Promise.all, and the pulse's catch then discards D1/D2 as well
  // — and because the bad row stays inside D3's 2h createdAt window, this
  // repeats on EVERY tick for two hours, silently (no 500 anywhere; the host
  // just drains nothing and the band shows nothing). The D3 query only ever
  // returns status IN ["printed","dismissed"], so an out-of-range status here
  // is deploy-skew/corruption, not a reachable production path — but the
  // policy is still to OMIT the row (return null), never throw: a single
  // unexpected value must degrade one row, never a whole tick.
  if (doc.status !== "printed" && doc.status !== "dismissed") {
    return null;
  }
  // Unlike `status` above, an unrecognised `dismissReason` (a stale value
  // from an older deploy) must degrade the readback, never 500 the 20s pulse
  // — so it is OMITTED here, not thrown on.
  const dismissReason =
    doc.dismissReason !== undefined && (PRINT_JOB_DISMISS_REASONS as readonly string[]).includes(doc.dismissReason)
      ? (doc.dismissReason as PrintJobDismissReason)
      : undefined;
  return {
    id: String(doc._id),
    status: doc.status,
    ...(dismissReason !== undefined ? { dismissReason } : {}),
  };
}

/** The D1 (drain) predicate, single-homed: readPrintJobFeeds's D1 read AND
 *  /api/print-jobs/wake's probe MUST use this one builder, or the probe can say
 *  pending:true for a row the feed never carries (a poll that never settles)
 *  or false for one it does (a dead wake). Rides {status:1,createdAt:1,_id:1}. */
export function printJobDrainFilter(nowMs: number): FilterQuery<IPrintJob> {
  return { status: "queued", createdAt: { $gte: drainAgeCutoff(nowMs) } };
}

/** ONE index-backed read for the wake poll — the newest drain-eligible row's
 *  id only (no documents, limit 1); rides {status:1,createdAt:1,_id:1} in
 *  reverse. Shares printJobDrainFilter with the D1 read so the two can never
 *  disagree on "pending". */
export async function printJobDrainHead(nowMs: number): Promise<PrintWakeData> {
  const head = await PrintJob.findOne(printJobDrainFilter(nowMs)).sort({ createdAt: -1, _id: -1 }).select("_id").lean();
  return head === null ? { pending: false, newestId: null } : { pending: true, newestId: String(head._id) };
}

export interface PrintJobFeeds {
  printJobs: PrintJobFeedRow[];
  printJobsTruncated: boolean;
  stalePrintJobs: PrintJobFeedRow[];
  stalePrintJobsTruncated: boolean;
  resolvedPrintJobs: PrintJobResolvedRow[];
  resolvedPrintJobsTruncated: boolean;
}

/**
 * The three §B4 reads, concurrently via ONE Promise.all, all `.lean()`, all
 * `.limit(<imported constant>)`. D1 (drain, age-fenced) and D2 (stale band)
 * are DISJOINT and gapless at the shared cutoff (`$gte` vs `$lt`) — this
 * matches `printJobDrainCandidate`'s own boundary rule (age === maxAgeMs is
 * still eligible). MERGED-01's point: a single oldest-first read let stale
 * rows permanently occupy the drain's slots and hide every fresher job for up
 * to the 12h prune window. Both sort `{createdAt:1,_id:1}` to ride
 * `{status:1,createdAt:1,_id:1}` and drain oldest-first with a deterministic
 * same-millisecond tie-break (MERGED-16).
 */
export async function readPrintJobFeeds(nowMs: number): Promise<PrintJobFeeds> {
  const cutoff = drainAgeCutoff(nowMs);

  // D1 (printJobDrainFilter, $gte cutoff) and D2 ($lt cutoff, below) stay
  // disjoint and gapless at this SAME cutoff — a row is in exactly one of the
  // two reads, never both and never neither (CB-U1: the wake probe reuses
  // this same builder, so its answer can never disagree with this read).
  const [drainRows, staleRows, resolvedRows] = await Promise.all([
    PrintJob.find(printJobDrainFilter(nowMs))
      .select("kind label orderId createdAt")
      .sort({ createdAt: 1, _id: 1 })
      .limit(PRINT_JOB_PULSE_LIMIT)
      .lean(),
    PrintJob.find({ status: "queued", createdAt: { $lt: cutoff } })
      .select("kind label orderId createdAt")
      .sort({ createdAt: 1, _id: 1 })
      .limit(PRINT_JOB_STALE_LIMIT)
      .lean(),
    PrintJob.find({ status: { $in: ["printed", "dismissed"] }, createdAt: { $gte: resolvedPruneCutoff(nowMs) } })
      .select("status dismissReason")
      .sort({ createdAt: -1 })
      .limit(PRINT_JOB_RESOLVED_LIMIT)
      .lean(),
  ]);

  return {
    printJobs: drainRows.map(printJobFeedRowOf),
    // Same length===limit "at least this many" proxy pos-pulse.ts already
    // uses for selfOrdersTruncated.
    printJobsTruncated: drainRows.length === PRINT_JOB_PULSE_LIMIT,
    stalePrintJobs: staleRows.map(printJobFeedRowOf),
    stalePrintJobsTruncated: staleRows.length === PRINT_JOB_STALE_LIMIT,
    // .filter(Boolean)-equivalent with a type guard: printJobResolvedRowOf
    // returns null for an out-of-range status (F-5) so ONE unexpected row
    // degrades by omission, never throws and takes the whole D3 read (and,
    // via pos-pulse.ts's fail-soft catch, D1/D2 too) down for the row's
    // whole 2h createdAt window.
    resolvedPrintJobs: resolvedRows
      .map(printJobResolvedRowOf)
      .filter((row): row is PrintJobResolvedRow => row !== null),
    // Same proxy as the two above, on the RAW row count (before the omit-null
    // filter): a cut read is a cut read even if a row was degraded away.
    resolvedPrintJobsTruncated: resolvedRows.length === PRINT_JOB_RESOLVED_LIMIT,
  };
}
