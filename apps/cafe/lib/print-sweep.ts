import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import {
  PRINT_JOB_LOG_MAX,
  PRINT_MAX_PAPER_ATTEMPTS,
  PRINT_SWEEP_MIN_INTERVAL_MS,
  lifecycleOf,
  planExpiry,
  planLimits,
} from "@pos/shared/print-lifecycle";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { prunePrintJobsThrottled } from "./print-queue";
import { repairMissingKotJobs } from "./print-repair";

// Printing redesign, Phase 1 (spec §7.4): the sweep. It rides requests that already exist (the
// agents' wake now; the pulse from Session 1D), at most once per 60 s per server instance — NEVER
// Vercel Cron (Hobby allows one a day). Every step is idempotent, so a second instance sweeping in
// the same minute only repeats no-ops. Never calls connectDB(). No console.*.

/** Each sweep read takes at most this many rows; the rest wait for the next sweep. */
export const PRINT_SWEEP_BATCH = 20;

/** Jobs that wait for a writer or a decision and may move to another device. Never "leased": its
 *  writer may be printing it now (its lease expires in 90 s, then it moves). */
const WAITING: readonly string[] = ["queued", "needs-confirm", "failed"];
/** The actor a host-cleared dismissal names when no staff tap caused it. */
const SWEEP_ACTOR = "system";

export interface PrintSweepResult {
  expired: number;
  requeued: number;
  retargeted: number;
  repaired: number;
  failed: number;
}

/** Simple mode (§6.6): every waiting job prints at the device that should print it NOW. With a host,
 *  that is the current host (rows from before Phase 1, rows from before a re-designation). With no
 *  host, it is the device that asked for the job (1A review I1 part 2: a slip aimed at a cleared or
 *  dead host goes back to its ordering device, labelled as it was); a job no device asked for (an old
 *  tab's enqueue, the public auto-accept) has no device left that may print it and is dismissed as
 *  host-cleared. Returns how many jobs moved. Pipeline updates: one write each, however many rows. */
export async function routeWaitingPrintJobs(hostDeviceId: string | null, nowMs: number): Promise<number> {
  const at = new Date(nowMs);
  if (hostDeviceId !== null) {
    const moved = await PrintJob.updateMany(
      { status: { $in: WAITING }, targetDeviceId: { $ne: hostDeviceId } },
      {
        $set: { targetDeviceId: hostDeviceId },
        $push: { log: { $each: [{ at, event: "retargeted", deviceId: hostDeviceId }], $slice: -PRINT_JOB_LOG_MAX } },
      },
    );
    return moved.modifiedCount ?? 0;
  }
  const home = await PrintJob.updateMany(
    { status: { $in: WAITING }, originDeviceId: { $exists: true }, $expr: { $ne: ["$targetDeviceId", "$originDeviceId"] } },
    [
      {
        $set: {
          targetDeviceId: "$originDeviceId",
          log: {
            $slice: [
              { $concatArrays: [{ $ifNull: ["$log", []] }, [{ at, event: "retargeted", deviceId: "$originDeviceId" }]] },
              -PRINT_JOB_LOG_MAX,
            ],
          },
        },
      },
    ],
  );
  await PrintJob.updateMany(
    { status: { $in: WAITING }, originDeviceId: { $exists: false }, claimedAt: { $exists: false } },
    { $set: { status: "dismissed", dismissedAt: at, dismissReason: "host-cleared", dismissedBy: SWEEP_ACTOR } },
  );
  return home.modifiedCount ?? 0;
}

/** DELETE /api/print-host, after its bulk dismiss: with no host now, every waiting job that names the
 *  device that asked for it goes back there, and that device is nudged to lease it (I1 part 2). */
export async function returnPrintJobsToOrigins(nowMs: number): Promise<number> {
  const moved = await routeWaitingPrintJobs(null, nowMs);
  if (moved > 0) publishCafeEvent("print-job");
  return moved;
}

export async function sweepPrintJobs(nowMs: number): Promise<PrintSweepResult> {
  const result: PrintSweepResult = { expired: 0, requeued: 0, retargeted: 0, repaired: 0, failed: 0 };

  // 1. Expire leases whose writer went quiet: the same as a "maybe sent" failure (§7.2).
  const leased = await PrintJob.find({ status: "leased", "lease.expiresAt": { $lt: new Date(nowMs) } })
    .select(PRINT_LIFECYCLE_SELECT)
    .limit(PRINT_SWEEP_BATCH)
    .lean<PrintLifecycleRow[]>();
  for (const row of leased) {
    const job = lifecycleOf(row);
    const plan = planExpiry(job, nowMs);
    if (plan.ok && (await applyPrintJobPlan(row._id, job, plan.patch))) {
      result.expired += 1;
      if (plan.patch.status === "queued") result.requeued += 1;
    }
  }

  // 2. Every waiting job to the device that should print it now (§6.6).
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
  result.retargeted = await routeWaitingPrintJobs(host?.deviceId ?? null, nowMs);

  // 2b. Re-create the missing job of a server-owned KOT round (§7.4; print-repair.ts).
  result.repaired = await repairMissingKotJobs(nowMs);

  // 3. Limits (§7.8, the owner's two-attempt rule). Normally applied when acking; this catches anything
  // that slipped past. Only attempts that may have reached paper count; refused leases never do.
  const tired = await PrintJob.find({ status: "queued", uncertainAttempts: { $gte: PRINT_MAX_PAPER_ATTEMPTS } })
    .select(PRINT_LIFECYCLE_SELECT)
    .limit(PRINT_SWEEP_BATCH)
    .lean<PrintLifecycleRow[]>();
  for (const row of tired) {
    const job = lifecycleOf(row);
    const plan = planLimits(job, nowMs);
    if (plan.ok && (await applyPrintJobPlan(row._id, job, plan.patch))) result.failed += 1;
  }

  // 4. Retention, unchanged (it keeps its own 5-minute throttle).
  await prunePrintJobsThrottled(nowMs);

  // A job back in the queue gets a nudge, so its device leases now (fire-and-forget; the poll is the safety net).
  // A repaired job announces itself (createOrderPrintJobs).
  if (result.requeued > 0 || result.retargeted > 0) publishCafeEvent("print-job");
  return result;
}

// Per-instance throttle state, like prunePrintJobsThrottled's: a cold start merely re-arms it.
let lastSweepAtMs = 0;

/** At most once per 60 s per instance. Best-effort: it never fails the request it rides on. */
export async function sweepPrintJobsThrottled(nowMs: number): Promise<void> {
  if (nowMs - lastSweepAtMs < PRINT_SWEEP_MIN_INTERVAL_MS) return;
  // Claimed BEFORE awaiting, so two overlapping requests cannot both pass the check.
  lastSweepAtMs = nowMs;
  try {
    await sweepPrintJobs(nowMs);
  } catch {
    // best-effort: the next sweep (≤ 60 s) retries; lazy expiry in the lease path covers the gap
  }
}
