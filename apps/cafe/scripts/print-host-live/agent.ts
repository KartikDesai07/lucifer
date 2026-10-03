/**
 * Phase 1 Session 1C live legs — the owner's two-attempt rule (ad) and the job-aware self-order lane
 * (ae), against a REAL MongoDB. Run by scripts/verify-print-host-live.ts after legs y–ac.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { SELF_ORDER_RECEIVER } from "@pos/shared/public";
import { PRINT_BACKOFF_MS } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { Order } from "@/models/Order";
import { OrderRequest } from "@/models/OrderRequest";
import { claimKotPrint } from "@/lib/pos-pulse";
import { claimKotPrintForAgent } from "@/lib/print-agent-server";
import { ackPrintJob, readJobsForDevice } from "@/lib/print-lease";
import { confirmPrintJob, retryPrintJob } from "@/lib/print-job-actions";
import { check, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost, lease, queueBill, queueKot, rowOf } from "./lifecycle";

const PHONE = "live-agent-phone";
const STEADY = PRINT_BACKOFF_MS[PRINT_BACKOFF_MS.length - 1];

async function leaseAt(nowMs: number) {
  const res = await lease(nowMs);
  const job = res.jobs[0];
  if (job === undefined) throw new Error(`nothing to lease at +${nowMs}`);
  return job;
}

export async function legAD(nowMs: number): Promise<void> {
  console.log("\n(ad) the owner's rule: at most two attempts that may print; refusals never count");
  await freshHost(nowMs);
  let t = nowMs;

  // A KOT: the first maybe is retried once with REPRINT, the second maybe is failed.
  const kot = await queueKot(t);
  let job = await leaseAt(t);
  await ackPrintJob({ id: kot, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "maybe", nowMs: t });
  let row = await rowOf(kot);
  check("(ad) a KOT's first maybe goes back in line once, labelled REPRINT", row?.status === "queued" && row?.uncertainAttempts === 1 && JSON.stringify(row?.labels) === '["REPRINT"]');
  t += STEADY;
  job = await leaseAt(t);
  await ackPrintJob({ id: kot, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "maybe", nowMs: t });
  row = await rowOf(kot);
  check("(ad) its second maybe ends in failed, waiting for staff", row?.status === "failed" && row?.uncertainAttempts === 2);

  // Staff tap Retry: one tap, one try.
  await retryPrintJob({ id: kot, nowMs: t });
  t += 1;
  job = await leaseAt(t);
  await ackPrintJob({ id: kot, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "maybe", nowMs: t });
  row = await rowOf(kot);
  check("(ad) a Retry is one more attempt: its maybe sends the slip back to failed", row?.status === "failed");
  await PrintJob.deleteMany({});

  // Refusals (the printer was off): any number of them, and the slip still waits in line, unlabelled.
  const refused = await queueKot(t);
  for (let i = 0; i < 6; i++) {
    t += STEADY;
    job = await leaseAt(t);
    await ackPrintJob({ id: refused, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "no", error: "not connected", nowMs: t });
  }
  row = await rowOf(refused);
  check("(ad) six refusals: still queued, no attempt counted, no label", row?.status === "queued" && row?.attempts === 6 && row?.uncertainAttempts === 0 && JSON.stringify(row?.labels) === "[]");
  const mine = await readJobsForDevice(HOST, t);
  check("(ad) the waiting slip shows in the device's own line (the pulse's printJobsForMe)", mine.count === 1);
  t += STEADY;
  job = await leaseAt(t);
  await ackPrintJob({ id: refused, deviceId: HOST, epoch: job.epoch, outcome: "printed", nowMs: t });
  check("(ad) the printer back: it prints once, unlabelled", (await rowOf(refused))?.status === "printed");
  await PrintJob.deleteMany({});

  // A bill: the first maybe asks the cashier; their print again is the one retry; a second maybe is failed.
  const bill = await queueBill(t);
  job = await leaseAt(t);
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "maybe", nowMs: t });
  check("(ad) a bill's first maybe waits for the cashier", (await rowOf(bill))?.status === "needs-confirm");
  await confirmPrintJob({ id: bill, decision: "reprint", staff: STAFF, nowMs: t });
  row = await rowOf(bill);
  check("(ad) the cashier's print again is queued DUPLICATE as the bill's one retry", row?.status === "queued" && JSON.stringify(row?.labels) === '["DUPLICATE"]' && row?.uncertainAttempts === 1);
  t += 1;
  job = await leaseAt(t);
  check("(ad) the retry is leased with its banner label", JSON.stringify(job.labels) === '["DUPLICATE"]');
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "maybe", nowMs: t });
  check("(ad) its second maybe is failed, never a second cashier prompt", (await rowOf(bill))?.status === "failed");
}

async function seedSelfOrderRequest(orderObjectId: string, round: number): Promise<string> {
  const order = await Order.findById(orderObjectId).select("orderId").lean();
  if (order === null) throw new Error("seeded order missing");
  const res = await OrderRequest.collection.insertOne({
    // A raw fixture, unique like every real request's diner code (the shortCode index).
    shortCode: `LIVE-${new mongoose.Types.ObjectId().toHexString()}`,
    status: "accepted",
    actor: SELF_ORDER_RECEIVER,
    acceptedOrderId: order.orderId,
    acceptedKotRound: round,
    acceptedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return String(res.insertedId);
}

export async function legAE(nowMs: number): Promise<void> {
  console.log("\n(ae) the job-aware self-order lane: an agent's claim makes the KOT one print job (ruling R4)");
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const requestId = await seedSelfOrderRequest(orderId, 1);
  const claim = await claimKotPrintForAgent(requestId, { deviceId: PHONE, bill: false }, nowMs);
  const refs = claim.claimed ? claim.order.printJobs ?? [] : [];
  const jobs = await PrintJob.find({ jobKey: `kot:${orderId}:1` }).lean();
  check("(ae) with a host: one KOT job for the host, today's key, named in the answer", claim.claimed && refs.length === 1 && jobs.length === 1 && jobs[0]?.targetDeviceId === HOST && refs[0]?.id === String(jobs[0]?._id));
  check("(ae) the claim is stamped as before (the D9 marker)", (await OrderRequest.findById(requestId).lean())?.kotPrintedAt instanceof Date);
  const again = await claimKotPrintForAgent(requestId, { deviceId: "live-other-tab", bill: false }, nowMs);
  const oldLane = await claimKotPrint(requestId);
  check("(ae) a second lane, new or old, loses the claim and makes nothing", !again.claimed && !oldLane.claimed && (await PrintJob.countDocuments({})) === 1);

  await PrintHost.deleteMany({});
  const ownOrder = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const ownRequest = await seedSelfOrderRequest(ownOrder, 1);
  const own = await claimKotPrintForAgent(ownRequest, { deviceId: PHONE, bill: false }, nowMs);
  const ownJob = await PrintJob.findOne({ jobKey: `kot:${ownOrder}:1` }).lean();
  check("(ae) with no host: the claiming device prints its own KOT (§6.6)", own.claimed && ownJob?.targetDeviceId === PHONE && ownJob?.originDeviceId === PHONE);

  const cancelled = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(cancelled) }, { $set: { status: "Cancelled" } });
  const cancelledRequest = await seedSelfOrderRequest(cancelled, 1);
  const refusedClaim = await claimKotPrintForAgent(cancelledRequest, { deviceId: PHONE, bill: false }, nowMs);
  check("(ae) a cancelled order: not eligible, and no job", !refusedClaim.claimed && (await PrintJob.countDocuments({ jobKey: `kot:${cancelled}:1` })) === 0);
  await OrderRequest.deleteMany({});
}
