/**
 * Phase 1 live legs (spec §13) — the print-job lifecycle against a REAL MongoDB: two tabs racing for
 * one head (q), lease expiry and late acks (r), stale-epoch acks (s), head-of-line parking (t), and
 * the sweep (u). Run by scripts/verify-print-host-live.ts AFTER legs a–n: the sweep arms
 * prunePrintJobsThrottled, which leg m must fire first.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { PRINT_LEASE_MS, printBackoffMs } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { PrintDevice } from "@/models/PrintDevice";
import { enqueuePrintJob } from "@/lib/print-queue";
import { ackPrintJob, leasePrintJobs } from "@/lib/print-lease";
import { retryPrintJob } from "@/lib/print-job-actions";
import { sweepPrintJobs } from "@/lib/print-sweep";
import { billPrintJob, kotPrintJob } from "@/lib/print-routing";
import { backdatePrintJob, baseOrderFields, check, resetCollections, seedPrintHost, seedRealOrder } from "./harness";

export const HOST = "live-host-device";
export const STAFF = "Live Leg";

export async function freshHost(nowMs: number): Promise<void> {
  await Promise.all([resetCollections(), PrintDevice.deleteMany({})]);
  await seedPrintHost({ deviceId: HOST, label: "Counter PC", setBy: STAFF, nowMs });
}

async function queued(job: { payload: Parameters<typeof enqueuePrintJob>[0]["payload"]; label: string }, nowMs: number): Promise<string> {
  const res = await enqueuePrintJob({ ...job, queuedBy: STAFF, nowMs });
  if (res.outcome !== "queued") throw new Error(`seed enqueue refused: ${res.outcome}`);
  return res.id;
}

export async function queueKot(nowMs: number): Promise<string> {
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  return queued(kotPrintJob(baseOrderFields({ _id: orderId }), 1), nowMs);
}

export async function queueBill(nowMs: number): Promise<string> {
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  return queued(billPrintJob(baseOrderFields({ _id: orderId }), { reprint: false }), nowMs);
}

export function lease(nowMs: number, tabId = "tab-a") {
  return leasePrintJobs({ deviceId: HOST, tabId, dismissedBy: STAFF, nowMs, tokenSlips: true });
}

export function rowOf(id: string) {
  return PrintJob.findById(id).lean();
}

/** Raw driver write: Mongoose's timestamps would re-stamp updatedAt, and some legs fake old state. */
export async function setRaw(id: string, set: Record<string, unknown>): Promise<void> {
  await PrintJob.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: set });
}

const labelsOf = (row: { labels?: string[] } | null): string => JSON.stringify(row?.labels ?? []);

export async function legQ(nowMs: number): Promise<void> {
  console.log("\n(q) two tabs of the host race for the head of its line");
  await freshHost(nowMs);
  const id = await queueKot(nowMs);
  const [a, b] = await Promise.all([lease(nowMs, "tab-a"), lease(nowMs, "tab-b")]);
  const winners = [a, b].filter((r) => r.jobs.length === 1);
  check("(q) exactly one tab wins the lease", winners.length === 1);
  check("(q) the winner holds epoch 1 of that job", winners[0]?.jobs[0]?.id === id && winners[0]?.jobs[0]?.epoch === 1);
  const loser = [a, b].find((r) => r.jobs.length === 0);
  check("(q) the loser is told when the lease ends", loser?.retryAt === new Date(nowMs + PRINT_LEASE_MS).toISOString());
  const row = await rowOf(id);
  check("(q) the job is leased once: attempts 1, epoch 1", row?.status === "leased" && row?.attempts === 1 && row?.epoch === 1);
}

export async function legR(nowMs: number): Promise<void> {
  console.log("\n(r) a host killed mid-job: the lease expires, and a late ack still counts");
  await freshHost(nowMs);
  const kot = await queueKot(nowMs);
  await lease(nowMs);
  const later = nowMs + PRINT_LEASE_MS + 1;
  const again = await lease(later, "tab-b");
  check("(r) the expired KOT waits out its backoff before it is handed out again", again.jobs.length === 0 && again.retryAt === new Date(later + printBackoffMs(1)).toISOString());
  let row = await rowOf(kot);
  check("(r) an expired KOT is queued again with REPRINT", row?.status === "queued" && row?.uncertainAttempts === 1 && labelsOf(row) === '["REPRINT"]' && row?.lease === undefined);
  const late = await ackPrintJob({ id: kot, deviceId: HOST, epoch: 1, outcome: "printed", nowMs: later + 1_000 });
  row = await rowOf(kot);
  check("(r) a late printed ack for epoch 1 still resolves it (nobody leased it since)", late.applied && row?.status === "printed" && (row?.log ?? []).some((e) => e.event === "late-ack"));

  const bill = await queueBill(nowMs);
  await lease(nowMs);
  const swept = await sweepPrintJobs(later);
  let billRow = await rowOf(bill);
  check("(r) the sweep expires a bill lease into needs-confirm, never a silent reprint", swept.expired === 1 && billRow?.status === "needs-confirm");
  const lateBill = await ackPrintJob({ id: bill, deviceId: HOST, epoch: 1, outcome: "printed", nowMs: later + 1_000 });
  billRow = await rowOf(bill);
  check("(r) a late ack resolves the cashier prompt by itself", lateBill.applied && billRow?.status === "printed");
}

export async function legS(nowMs: number): Promise<void> {
  console.log("\n(s) an ack from an attempt that was leased again is ignored, but logged");
  await freshHost(nowMs);
  const id = await queueKot(nowMs);
  await lease(nowMs);
  const t1 = nowMs + PRINT_LEASE_MS + 1;
  await sweepPrintJobs(t1);
  const t2 = t1 + printBackoffMs(1);
  const second = await lease(t2, "tab-b");
  check("(s) the second attempt is epoch 2 and carries REPRINT", second.jobs[0]?.id === id && second.jobs[0]?.epoch === 2 && second.jobs[0]?.labels.includes("REPRINT") === true);
  const stale = await ackPrintJob({ id, deviceId: HOST, epoch: 1, outcome: "printed", nowMs: t2 + 1 });
  let row = await rowOf(id);
  check("(s) the epoch-1 ack changes nothing", !stale.applied && stale.reason === "stale-epoch" && row?.status === "leased" && row?.epoch === 2);
  check("(s) … but it is in the log", (row?.log ?? []).some((e) => e.event === "late-ack" && (e.detail ?? "").startsWith("ignored")));
  const fresh = await ackPrintJob({ id, deviceId: HOST, epoch: 2, outcome: "printed", nowMs: t2 + 2 });
  const dup = await ackPrintJob({ id, deviceId: HOST, epoch: 2, outcome: "printed", nowMs: t2 + 3 });
  row = await rowOf(id);
  check("(s) the epoch-2 ack prints it; a repeat answers 'already printed'", fresh.applied && !dup.applied && dup.reason === "resolved" && dup.status === "printed" && row?.status === "printed");
}

export async function legT(nowMs: number): Promise<void> {
  console.log("\n(t) head of line: parked jobs never block; a job in backoff holds the line");
  await freshHost(nowMs);
  const bill = await queueBill(nowMs);
  const kot = await queueKot(nowMs);
  await lease(nowMs);
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: 1, outcome: "failed", sent: "maybe", nowMs });
  const next = await lease(nowMs);
  check("(t) a bill waiting for the cashier does not block the KOT behind it", (await rowOf(bill))?.status === "needs-confirm" && next.jobs[0]?.id === kot);

  await freshHost(nowMs);
  const first = await queueKot(nowMs);
  await queueKot(nowMs);
  await lease(nowMs);
  const refused = await ackPrintJob({ id: first, deviceId: HOST, epoch: 1, outcome: "failed", sent: "no", error: "NOT_CONNECTED", nowMs });
  const blocked = await lease(nowMs + 1);
  check("(t) a refusal before any byte requeues the same KOT after 2 s", refused.applied && refused.nextAttemptAt === new Date(nowMs + printBackoffMs(1)).toISOString());
  check("(t) … and while it waits, the KOT behind it does not overtake it", blocked.jobs.length === 0 && blocked.retryAt === refused.nextAttemptAt);
  const retried = await lease(nowMs + printBackoffMs(1));
  check("(t) the same KOT is leased again first, epoch 2, with no label (nothing was sent)", retried.jobs[0]?.id === first && retried.jobs[0]?.epoch === 2 && retried.jobs[0]?.labels.length === 0);

  await freshHost(nowMs);
  const old = await queueKot(nowMs);
  await backdatePrintJob(old, new Date(nowMs - PRINT_HOST_MAX_AGE_MS - 60_000));
  const fresh = await queueKot(nowMs);
  const skip = await lease(nowMs);
  check("(t) a 31-minute-old KOT is parked as stale: the fresh one prints", skip.jobs[0]?.id === fresh);
  await ackPrintJob({ id: fresh, deviceId: HOST, epoch: 1, outcome: "printed", nowMs });
  check("(t) the stale KOT stays parked without a tap", (await lease(nowMs)).jobs.length === 0);
  const tapped = await retryPrintJob({ id: old, nowMs });
  const now = await lease(nowMs + 1);
  check("(t) Print now makes it leasable", tapped.applied && now.jobs[0]?.id === old);
}

export async function legU(nowMs: number): Promise<void> {
  console.log("\n(u) the sweep: expiry, retargeting to the current host, limits");
  await freshHost(nowMs);
  const dead = await queueKot(nowMs);
  await lease(nowMs);
  // A row from before Phase 1: no target, no counters, no log.
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const legacy = kotPrintJob(baseOrderFields({ _id: orderId }), 1);
  const inserted = await PrintJob.collection.insertOne({
    kind: "kot",
    status: "queued",
    payload: JSON.stringify(legacy.payload),
    label: legacy.label,
    queuedBy: STAFF,
    orderId,
    jobKey: `kot:${orderId}:1`,
    createdAt: new Date(nowMs - 1_000),
    updatedAt: new Date(nowMs - 1_000),
  });
  const legacyId = String(inserted.insertedId);
  const replaced = await queueKot(nowMs);
  await setRaw(replaced, { targetDeviceId: "replaced-host" });
  const tired = await queueKot(nowMs);
  await setRaw(tired, { uncertainAttempts: 3 });

  const at = nowMs + PRINT_LEASE_MS + 1;
  const swept = await sweepPrintJobs(at);
  check("(u) the dead writer's lease expires", swept.expired === 1 && swept.requeued === 1 && (await rowOf(dead))?.status === "queued");
  const legacyRow = await rowOf(legacyId);
  check("(u) a row from before Phase 1 and a row aimed at a replaced host now target the current host", swept.retargeted === 2 && legacyRow?.targetDeviceId === HOST && (await rowOf(replaced))?.targetDeviceId === HOST);
  check("(u) a job over its limits is failed, never retried forever", swept.failed === 1 && (await rowOf(tired))?.status === "failed");
  const adopted = await lease(at + 1);
  check("(u) the adopted legacy row is leased like any other (it is the oldest)", adopted.jobs[0]?.id === legacyId && adopted.jobs[0]?.epoch === 1);
}
