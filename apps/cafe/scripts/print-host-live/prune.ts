/**
 * PH-10 Slice F — legs f, m: the lazy retention sweep (bypassing the module
 * throttle directly) and the POST-route's own enqueue-then-throttled-prune
 * sequence, with a PrintHost.lastSeenAt no-write pin (no beat is involved).
 */
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { prunePrintJobs, prunePrintJobsThrottled, enqueuePrintJob } from "@/lib/print-queue";
import { PRINT_JOB_QUEUED_RETENTION_MS, PRINT_JOB_RESOLVED_RETENTION_MS, PRINT_JOB_PRUNE_MIN_INTERVAL_MS } from "@pos/shared/print-job";
import { billPrintJob } from "@/lib/print-routing";
import { check, backdatePrintJob, seedPrintHost, resetCollections, baseOrderFields } from "./harness";

const ONE_MIN_MS = 60 * 1000;

async function seedBackdatedRow(status: "queued" | "printed" | "dismissed", createdAt: Date, label: string): Promise<string> {
  const doc = await PrintJob.create({
    kind: "eod",
    status,
    payload: JSON.stringify({ kind: "eod", dateKey: "2026-09-06", dateLabel: "seed" }),
    label,
    queuedBy: "Staff",
    ...(status === "dismissed" ? { dismissedAt: createdAt, dismissReason: "staff", dismissedBy: "Staff" } : {}),
  });
  await backdatePrintJob(String(doc._id), createdAt);
  return String(doc._id);
}

export async function legF(nowMs: number): Promise<void> {
  console.log("\nLeg f — prunePrintJobs(nowMs) directly: exact survivor set across the queued/resolved retention boundary\n");
  await resetCollections();

  const queuedDeletedId = await seedBackdatedRow(
    "queued",
    new Date(nowMs - (PRINT_JOB_QUEUED_RETENTION_MS + 60_000)), // -12h01m
    "queued -12h01m (deleted)",
  );
  const queuedSurvivesId = await seedBackdatedRow(
    "queued",
    new Date(nowMs - (PRINT_JOB_QUEUED_RETENTION_MS - 60_000)), // -11h59m
    "queued -11h59m (survives)",
  );
  const resolvedDeletedId = await seedBackdatedRow(
    "printed",
    new Date(nowMs - (PRINT_JOB_RESOLVED_RETENTION_MS + 60_000)), // -2h01m
    "resolved -2h01m (deleted)",
  );
  const resolvedSurvivesId = await seedBackdatedRow(
    "dismissed",
    new Date(nowMs - (PRINT_JOB_RESOLVED_RETENTION_MS - 60_000)), // -1h59m
    "resolved -1h59m (survives)",
  );

  await prunePrintJobs(nowMs);

  const remaining = await PrintJob.find({}).select("_id").lean();
  const remainingIds = new Set(remaining.map((r) => String(r._id)));

  check("leg f: the -12h01m queued row was deleted", !remainingIds.has(queuedDeletedId));
  check("leg f: the -11h59m queued row survives", remainingIds.has(queuedSurvivesId));
  check("leg f: the -2h01m resolved row was deleted", !remainingIds.has(resolvedDeletedId));
  check("leg f: the -1h59m resolved row survives", remainingIds.has(resolvedSurvivesId));
  check("leg f: exactly the two survivor ids remain", remainingIds.size === 2);
}

export async function legM(nowMs: number, throttleAlreadyCalledThisRun: boolean): Promise<void> {
  console.log("\nLeg m — the POST route's own sequence: enqueuePrintJob then prunePrintJobsThrottled(nowMs), no beat involved\n");
  await resetCollections();
  await seedPrintHost({ deviceId: "HOST-1", label: "Counter PC", setBy: "Admin", nowMs });

  const staleId = await seedBackdatedRow("queued", new Date(nowMs - (PRINT_JOB_QUEUED_RETENTION_MS + 60_000)), "stale, pre-existing");

  const hostBefore = await PrintHost.findOne({}).select("lastSeenAt").lean();

  const order = baseOrderFields({ _id: "order-m", orderId: "ORD-M" });
  const { payload, label } = billPrintJob(order, { reprint: false });
  const enq = await enqueuePrintJob({ payload, label, queuedBy: "Staff" });
  check('leg m: the route-shape enqueue itself reports "queued"', enq.outcome === "queued");

  // The module-level throttle clock persists across this process's whole run.
  // Per the amendment: this must be either the FIRST throttled call of the
  // run, or fired at least PRINT_JOB_PRUNE_MIN_INTERVAL_MS beyond any earlier
  // throttled call — the caller states which via throttleAlreadyCalledThisRun.
  const pruneNowMs = throttleAlreadyCalledThisRun ? nowMs + PRINT_JOB_PRUNE_MIN_INTERVAL_MS + ONE_MIN_MS : nowMs;
  await prunePrintJobsThrottled(pruneNowMs);

  const remaining = await PrintJob.exists({ _id: staleId });
  check("leg m: the stale pre-existing row is gone after the throttled prune", remaining === null);

  const hostAfter = await PrintHost.findOne({}).select("lastSeenAt").lean();
  check(
    "leg m: PrintHost.lastSeenAt is UNCHANGED across the whole leg — no beat is ever called",
    hostBefore?.lastSeenAt instanceof Date &&
      hostAfter?.lastSeenAt instanceof Date &&
      hostBefore.lastSeenAt.getTime() === hostAfter.lastSeenAt.getTime(),
  );
}
