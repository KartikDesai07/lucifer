/**
 * Printer UX PX-2 live legs (spec 2026-11-05 §6.9 B1/B2, R2, R7, R8, SR-3, SR-7, SR-8, SR-10; plan Task 2) against a
 * REAL MongoDB: a staff Clear that lands while a slip is being printed keeps a request on it, and that try's end
 * decides (cw1–cw4); a claimed slip is never cleared (cw5); Clear all (cw6); a leftover request from a rollout race
 * (cw7, cw9); the server's own dismiss and the retention stay today's (cw8). cw1b: an unreachable refusal that ends a
 * cleared slip still skips its writer (controller Ruling E). Run by scripts/verify-print-host-live.ts after leg bi;
 * each leg makes its own jobs and ends in simple mode.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PRINT_JOB_ACTED_GRACE_MS, PRINT_JOB_QUEUED_RETENTION_MS } from "@pos/shared/print-job";
import { PRINT_KOT_ALARM_MS, PRINT_LEASE_MS, lifecycleOf, planAck } from "@pos/shared/print-lifecycle";
import { PRINT_CLEARED_WHILE_PRINTING } from "@pos/shared/print-lifecycle-clear";
import { PrintDevice } from "@/models/PrintDevice";
import { PrintJob } from "@/models/PrintJob";
import { Printer } from "@/models/Printer";
import { readPrintAttention } from "@/lib/print-attention";
import { dismissPrintJobByStaff, dismissPrintJobs } from "@/lib/print-dismiss";
import { retryPrintJob } from "@/lib/print-job-actions";
import { PRINT_LIFECYCLE_SELECT, ackPrintJob, applyPrintJobPlan, leasePrintJobs, type PrintLifecycleRow } from "@/lib/print-lease";
import type { OfflineAsk } from "@/lib/print-offline-jobs";
import { markOfflineRoundPrinted } from "@/lib/print-offline-replay";
import { listPrinters } from "@/lib/print-printers";
import { dismissPrintJob, prunePrintJobs } from "@/lib/print-queue";
import { sweepPrintJobs } from "@/lib/print-sweep";
import { backdatePrintJob, check } from "./harness";
import { COUNTER, KITCHEN, failoverOutlet, kotOf, online } from "./failover";
import { HOST, STAFF, freshHost, lease, queueKot, rowOf, setRaw } from "./lifecycle";

const clear = (id: string, nowMs: number) => dismissPrintJobByStaff({ id, dismissedBy: STAFF, nowMs });
const refuse = (id: string, epoch: number, nowMs: number) => ackPrintJob({ id, deviceId: HOST, epoch, outcome: "failed", sent: "no", error: "NOT_CONNECTED", nowMs });
const LEFTOVER = { dismissRequestedBy: "Old server" };

/** A KOT the host is printing now: queued, then leased by its tab. */
async function printingKot(nowMs: number): Promise<{ id: string; epoch: number }> {
  const id = await queueKot(nowMs);
  const job = (await lease(nowMs)).jobs.find((leased) => leased.id === id);
  if (job === undefined) throw new Error("seed lease missed its KOT");
  return { id, epoch: job.epoch };
}

export async function legCW1(nowMs: number): Promise<void> {
  console.log("\n(cw1) a staff Clear on a slip being printed: kept as a request, and a refused try ends it dismissed");
  await freshHost(nowMs);
  const { id, epoch } = await printingKot(nowMs);
  const first = await clear(id, nowMs + 1);
  let row = await rowOf(id);
  check(
    "(cw1) the Clear answers dismissed; the slip stays leased (its writer may be printing it) with the request",
    first.dismissed && row?.status === "leased" && row.dismissRequestedAt?.getTime() === nowMs + 1 && row.dismissRequestedBy === STAFF,
  );
  const second = await clear(id, nowMs + 2);
  check("(cw1) a second Clear on it answers dismissed too (F-M3)", second.dismissed && (await rowOf(id))?.status === "leased");
  const answer = await refuse(id, epoch, nowMs + 3);
  check("(cw1) the failed ack ends it: applied, dismissed, no nextAttemptAt (today's agent ends its tries, SR-8)", answer.applied && answer.status === "dismissed" && answer.nextAttemptAt === null);
  row = await rowOf(id);
  check(
    "(cw1) dismissed as the staff's, logged 'cleared while printing', its lease gone",
    row?.status === "dismissed" && row.dismissReason === "staff" && row.dismissedBy === STAFF && row.lease === undefined && row.log?.at(-1)?.event === "dismissed" && row.log.at(-1)?.detail === PRINT_CLEARED_WHILE_PRINTING,
  );
  const control = await printingKot(nowMs + 4);
  await refuse(control.id, control.epoch, nowMs + 5);
  const feed = (await readPrintAttention(nowMs + PRINT_KOT_ALARM_MS + 60_000)).rows.map((waiting) => waiting.id);
  check("(cw1) it is not in the waiting list; a refused slip nobody cleared is", !feed.includes(id) && feed.includes(control.id));
}

export async function legCW1b(nowMs: number): Promise<void> {
  console.log("\n(cw1b) Ruling E: an unreachable refusal that ends a cleared slip still skips its writer for the network printer");
  const o = await failoverOutlet();
  await Promise.all([online(KITCHEN, nowMs), online(COUNTER, nowMs)]);
  const skips = async () => (await listPrinters()).find((printer) => printer.id === o.kitchen)?.unreachable ?? [];
  const clearedKitchenSlip = async (at: number) => {
    await kotOf(o, at);
    const job = (await leasePrintJobs({ deviceId: KITCHEN, tabId: "cw-tab", tokenSlips: true, printerIds: [o.kitchen], dismissedBy: STAFF, nowMs: at })).jobs[0];
    if (job === undefined) throw new Error("seed lease missed the kitchen slip");
    await clear(job.id, at);
    return job;
  };
  const a = await clearedKitchenSlip(nowMs + 1_000);
  const permanent = await ackPrintJob({ id: a.id, deviceId: KITCHEN, epoch: a.epoch, outcome: "failed", sent: "no", permanent: true, reason: "unreachable", nowMs: nowMs + 2_000 });
  check("(cw1b) a permanent unreachable refusal ends the cleared slip and skips no one (as today)", permanent.status === "dismissed" && (await skips()).length === 0);
  const b = await clearedKitchenSlip(nowMs + 3_000);
  const answer = await ackPrintJob({ id: b.id, deviceId: KITCHEN, epoch: b.epoch, outcome: "failed", sent: "no", reason: "unreachable", nowMs: nowMs + 4_000 });
  const after = await skips();
  check(
    "(cw1b) an unreachable refusal ends it dismissed, answers `more` (it left the line) and still skips the tablet for its printer",
    answer.status === "dismissed" && answer.nextAttemptAt === null && typeof answer.more === "boolean" && after.length === 1 && after[0]?.deviceId === KITCHEN,
  );
  check("(cw1b) ... so the next kitchen slip goes to the counter", (await kotOf(o, nowMs + 5_000)).kitchen?.targetDeviceId === COUNTER);
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}

export async function legCW2(nowMs: number): Promise<void> {
  console.log("\n(cw2) paper wins: a printed ack after the Clear ends the slip printed");
  await freshHost(nowMs);
  const { id, epoch } = await printingKot(nowMs);
  await clear(id, nowMs + 1);
  const answer = await ackPrintJob({ id, deviceId: HOST, epoch, outcome: "printed", nowMs: nowMs + 2 });
  const row = await rowOf(id);
  check("(cw2) the printed ack lands: printed, never recorded as cleared (SR-3)", answer.applied && answer.status === "printed" && row?.status === "printed" && row.printedBy === HOST && row.dismissedAt === undefined);
}

export async function legCW3(nowMs: number): Promise<void> {
  console.log("\n(cw3) the writer goes quiet: the sweep ends the cleared slip dismissed; a late printed ack of that try still wins (R8)");
  await freshHost(nowMs);
  const { id, epoch } = await printingKot(nowMs);
  await clear(id, nowMs + 1);
  const later = nowMs + PRINT_LEASE_MS + 1;
  const swept = await sweepPrintJobs(later);
  let row = await rowOf(id);
  check(
    "(cw3) the lease runs out into dismissed, never a REPRINT back in line",
    swept.expired === 1 && swept.requeued === 0 && row?.status === "dismissed" && (row.labels ?? []).length === 0 && row.log?.at(-1)?.detail === PRINT_CLEARED_WHILE_PRINTING,
  );
  const late = await ackPrintJob({ id, deviceId: HOST, epoch, outcome: "printed", nowMs: later + 1_000 });
  row = await rowOf(id);
  check("(cw3) the late printed ack of the same epoch turns it printed: the paper is on the counter", late.applied && row?.status === "printed" && row.log?.at(-1)?.event === "late-ack");
}

export async function legCW4(nowMs: number): Promise<void> {
  console.log("\n(cw4) an ack planned before the Clear was written misses its CAS, re-reads and ends the slip dismissed (SR-10)");
  await freshHost(nowMs);
  const { id, epoch } = await printingKot(nowMs);
  const read = await PrintJob.findById(id).select(PRINT_LIFECYCLE_SELECT).lean<PrintLifecycleRow>();
  if (read === null) throw new Error("seed row missing");
  const stale = lifecycleOf(read);
  await clear(id, nowMs + 1);
  const plan = planAck(stale, { deviceId: HOST, epoch, outcome: "failed", sent: "no" }, nowMs + 2);
  const landed = plan.ok ? await applyPrintJobPlan(read._id, stale, plan.patch) : null;
  check("(cw4) the plan read before the request (back in line) misses: the slip stays leased", plan.ok && plan.patch.status === "queued" && landed === false && (await rowOf(id))?.status === "leased");
  const answer = await refuse(id, epoch, nowMs + 3);
  check("(cw4) the same ack, re-read with the request, ends it dismissed: the Clear is never lost", answer.applied && answer.status === "dismissed" && (await rowOf(id))?.status === "dismissed");
}

export async function legCW5(nowMs: number): Promise<void> {
  console.log("\n(cw5) a slip the legacy claim owns is never cleared; an unknown slip answers not-found (Ruling D)");
  await freshHost(nowMs);
  const { id } = await printingKot(nowMs);
  // Not a state the code makes (a claim prints a queued job at once): it isolates the leased CAS's claimedAt term.
  await setRaw(id, { claimedAt: new Date(nowMs), claimedBy: HOST });
  const answer = await clear(id, nowMs + 1);
  const row = await rowOf(id);
  check("(cw5) a claimed slip: raced, as today, and no request set", !answer.dismissed && answer.reason === "raced" && row?.status === "leased" && row.dismissRequestedAt === undefined);
  const gone = await clear(new mongoose.Types.ObjectId().toHexString(), nowMs + 2);
  check("(cw5) an id that never existed: not-found (the route's 404)", !gone.dismissed && gone.reason === "not-found");
}

export async function legCW6(nowMs: number): Promise<void> {
  console.log("\n(cw6) Clear all: one call; waiting slips dismissed, the printing one asked, a finished one and an unknown id untouched");
  await freshHost(nowMs);
  const printing = await printingKot(nowMs);
  const waiting = [await queueKot(nowMs), await queueKot(nowMs), await queueKot(nowMs)];
  const printed = await queueKot(nowMs);
  await setRaw(printed, { status: "printed", printedAt: new Date(nowMs), printedBy: HOST });
  const unknown = new mongoose.Types.ObjectId().toHexString();
  const result = await dismissPrintJobs({ ids: [...waiting, printing.id, printed, unknown], dismissedBy: STAFF, nowMs: nowMs + 1 });
  check("(cw6) it answers 4: three dismissed and the printing one asked", result.dismissed === 4);
  const rows = await Promise.all(waiting.map((id) => rowOf(id)));
  check(
    "(cw6) the three waiting slips are dismissed as the staff's",
    rows.every((row) => row?.status === "dismissed" && row.dismissReason === "staff" && row.dismissedBy === STAFF && row.dismissedAt?.getTime() === nowMs + 1),
  );
  const [leasedRow, printedRow] = [await rowOf(printing.id), await rowOf(printed)];
  check("(cw6) the slip being printed stays leased, with the request", leasedRow?.status === "leased" && leasedRow.dismissRequestedBy === STAFF && leasedRow.dismissRequestedAt?.getTime() === nowMs + 1);
  check("(cw6) the printed slip is untouched", printedRow?.status === "printed" && printedRow.dismissedAt === undefined && printedRow.dismissRequestedAt === undefined);
}

export async function legCW7(nowMs: number): Promise<void> {
  console.log("\n(cw7) a leftover request (a rollout race with an old server): a Clear dismisses the slip; Try again unsets it (R7)");
  await freshHost(nowMs);
  const waiting = await queueKot(nowMs);
  await setRaw(waiting, { ...LEFTOVER, dismissRequestedAt: new Date(nowMs - 1_000) });
  const cleared = await clear(waiting, nowMs);
  const row = await rowOf(waiting);
  check("(cw7) a queued slip that still carries the field is cleared as today", cleared.dismissed && row?.status === "dismissed" && row.dismissedBy === STAFF);
  const stopped = await queueKot(nowMs);
  await setRaw(stopped, { ...LEFTOVER, dismissRequestedAt: new Date(nowMs - 1_000), status: "failed", epoch: 1, attempts: 1, lastError: "paper out" });
  const retried = await retryPrintJob({ id: stopped, nowMs: nowMs + 1 });
  const back = await rowOf(stopped);
  check(
    "(cw7) Try again on a failed slip with a leftover request puts it back in line without it: the later tap wins",
    retried.applied && back?.status === "queued" && back.dismissRequestedAt === undefined && back.dismissRequestedBy === undefined,
  );
}

export async function legCW8(nowMs: number): Promise<void> {
  console.log("\n(cw8) the server's own dismiss and the retention stay today's (R2, SR-7)");
  await freshHost(nowMs);
  const { id } = await printingKot(nowMs);
  const own = await dismissPrintJob({ id, reason: "order-cancelled", dismissedBy: STAFF });
  const row = await rowOf(id);
  check("(cw8) an order cancelled while its KOT prints: raced as today, and no request set (R2)", !own.dismissed && own.reason === "raced" && row?.status === "leased" && row.dismissRequestedAt === undefined);

  // SR-7: four leased slips past the 3 h retention, with and without a request. The prune keeps one whose lease ran
  // out lately (inside the acted grace: it may still be printing) and deletes one whose lease ran out long ago.
  await freshHost(nowMs);
  const seed = async (asked: boolean, leaseEndedMsAgo: number): Promise<string> => {
    const made = await queueKot(nowMs);
    await backdatePrintJob(made, new Date(nowMs - PRINT_JOB_QUEUED_RETENTION_MS - 60_000));
    const lease = { deviceId: HOST, tabId: "tab-a", epoch: 1, expiresAt: new Date(nowMs - leaseEndedMsAgo) };
    await setRaw(made, { status: "leased", epoch: 1, attempts: 1, lease, ...(asked ? { ...LEFTOVER, dismissRequestedAt: new Date(nowMs - leaseEndedMsAgo) } : {}) });
    return made;
  };
  const [lately, longAgo] = [PRINT_JOB_ACTED_GRACE_MS / 2, PRINT_JOB_ACTED_GRACE_MS * 2];
  const [askedLately, plainLately, askedLong, plainLong] = [await seed(true, lately), await seed(false, lately), await seed(true, longAgo), await seed(false, longAgo)];
  await prunePrintJobs(nowMs);
  const kept = new Set((await PrintJob.find({}).select("_id").lean()).map((left) => String(left._id)));
  check("(cw8) retention: a leased slip whose lease ran out lately is kept, with the request or without (SR-7)", kept.has(askedLately) && kept.has(plainLately));
  check("(cw8) ... and one whose lease ran out long ago is deleted, with the request or without", !kept.has(askedLong) && !kept.has(plainLong) && kept.size === 2);
}

export async function legCW9(nowMs: number): Promise<void> {
  console.log("\n(cw9) the offline replay marks printed a queued slip that carries a leftover request (its CAS reads it, R7)");
  await freshHost(nowMs);
  const id = await queueKot(nowMs);
  await setRaw(id, { ...LEFTOVER, dismissRequestedAt: new Date(nowMs - 1_000) });
  const orderObjectId = (await rowOf(id))?.orderId ?? "";
  const ask: OfflineAsk = { deviceId: HOST, round: { ref: "O-9", takenAt: nowMs, lines: [{ printerId: null, part: "-", outcome: "printed" }] } };
  const moved = await markOfflineRoundPrinted({ orderObjectId, round: 1, ask, nowMs: nowMs + 1 });
  check("(cw9) the line printed offline moves to printed, so it never prints a second time", moved === 1 && (await rowOf(id))?.status === "printed");
}
