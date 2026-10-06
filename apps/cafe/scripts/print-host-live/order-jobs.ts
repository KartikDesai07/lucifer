/**
 * Phase 1 Session 1B live legs — server-side job creation (y), the repair sweep (z), where a waiting
 * job prints after a host change (aa), and the lease fence and step bound (ab), against a REAL
 * MongoDB. Run by scripts/verify-print-host-live.ts after legs q–x.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { lifecycleOf, planLease } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { Order } from "@/models/Order";
import { createOrderPrintJobs, enqueueOwnPrintJob } from "@/lib/print-order-jobs";
import { dismissQueuedPrintJobsForClearedHost, enqueuePrintJob } from "@/lib/print-queue";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, leasePrintJobs, type PrintLifecycleRow } from "@/lib/print-lease";
import { routeWaitingPrintJobs, sweepPrintJobs } from "@/lib/print-sweep";
import { billPrintJob, kotPrintJob } from "@/lib/print-routing";
import { check, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost, rowOf, setRaw } from "./lifecycle";

const PHONE = "live-order-phone";
const OLD_HOST = "live-old-host";

async function orderOf(id: string) {
  const order = await Order.findById(id).lean();
  if (order === null) throw new Error("seeded order missing");
  return order;
}

/** Raw driver write on an Order (timestamps would re-stamp updatedAt; some legs fake old rounds). */
async function setOrderRaw(id: string, set: Record<string, unknown>): Promise<void> {
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: set });
}

export async function legY(nowMs: number): Promise<void> {
  console.log("\n(y) server-side creation: host or own device, KOT before bill, one job per slip");
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const order = await orderOf(orderId);
  const refs = await createOrderPrintJobs({ order, slips: [{ kind: "bill" }, { kind: "kot", round: 1 }], originDeviceId: PHONE, queuedBy: STAFF, nowMs });
  const [kot, bill] = await Promise.all([rowOf(refs[0]?.id ?? ""), rowOf(refs[1]?.id ?? "")]);
  check("(y) Pay Now makes the KOT and then the bill, both for the host", refs.length === 2 && refs[0]?.kind === "kot" && refs[1]?.kind === "bill" && refs.every((r) => r.targetDeviceId === HOST));
  check("(y) the KOT is ahead of the bill in the host's line (§7.6)", kot !== null && bill !== null && (kot.createdAt < bill.createdAt || (kot.createdAt.getTime() === bill.createdAt.getTime() && String(kot._id) < String(bill._id))));
  check("(y) each job is queued, keyed as today, and names the asking device", kot?.status === "queued" && kot?.jobKey === `kot:${orderId}:1` && bill?.jobKey === `bill:${orderId}` && kot?.originDeviceId === PHONE && kot?.epoch === 0 && kot?.log?.[0]?.event === "created");
  const again = await createOrderPrintJobs({ order, slips: [{ kind: "kot", round: 1 }, { kind: "bill" }], originDeviceId: PHONE, queuedBy: STAFF, nowMs });
  check("(y) a racing second create answers the same two jobs and makes none", again.map((r) => r.id).join() === refs.map((r) => r.id).join() && (await PrintJob.countDocuments({})) === 2);
  const oldTab = await enqueuePrintJob({ ...kotPrintJob(JSON.parse(JSON.stringify(order)), 1), queuedBy: STAFF, nowMs });
  check("(y) an old tab's enqueue of the same KOT lands on the same job, never a second slip", oldTab.outcome === "queued" && oldTab.duplicate && oldTab.id === refs[0]?.id);

  await PrintHost.deleteMany({});
  const own = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const mine = await createOrderPrintJobs({ order: await orderOf(own), slips: [{ kind: "kot", round: 1 }], originDeviceId: PHONE, queuedBy: STAFF, nowMs });
  check("(y) with no host, the asking device prints its own slip (§6.6)", mine.length === 1 && mine[0]?.targetDeviceId === PHONE && (await rowOf(mine[0].id))?.targetDeviceId === PHONE);
  const selfOrder = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const none = await createOrderPrintJobs({ order: await orderOf(selfOrder), slips: [{ kind: "kot", round: 1 }], queuedBy: STAFF, nowMs });
  check("(y) with no host and no asking device (the auto-accept) nothing is made: kot-claim prints it", none.length === 0 && (await PrintJob.countDocuments({ orderId: selfOrder })) === 0);

  const reprint = billPrintJob(JSON.parse(JSON.stringify(await orderOf(own))), { reprint: true });
  const first = await enqueueOwnPrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: "live-key-0001-own", originDeviceId: PHONE, nowMs });
  const retry = await enqueueOwnPrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: "live-key-0001-own", originDeviceId: PHONE, nowMs });
  const firstId = first.outcome === "queued" ? first.id : "";
  const ownRow = await rowOf(firstId);
  check("(y) no host: an agent's own reprint is its own job, DUPLICATE, and a retry is the same job", first.outcome === "queued" && !first.duplicate && retry.outcome === "queued" && retry.duplicate && retry.id === firstId && ownRow?.targetDeviceId === PHONE && JSON.stringify(ownRow?.labels) === '["DUPLICATE"]');
}

export async function legZ(nowMs: number): Promise<void> {
  console.log("\n(z) the repair sweep re-creates a server-owned round's missing KOT, and nothing else");
  await freshHost(nowMs);
  const owned = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await setOrderRaw(owned, { kotPrintDevices: [PHONE] });
  const oldTab = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const cancelled = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await setOrderRaw(cancelled, { kotPrintDevices: [PHONE], status: "Cancelled" });
  const late = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await setOrderRaw(late, { kotPrintDevices: [PHONE], createdAt: new Date(nowMs - 31 * 60 * 1000) });
  const mixed = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await Order.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(mixed) },
    {
      $set: { kotRounds: 2, kotPrintDevices: ["", PHONE], kotFiredAt: [new Date(nowMs - 60_000), new Date(nowMs - 30_000)] },
      $push: { items: { productId: "00000000000000000000aaa2", name: "Coffee", price: 120, qty: 1, modifiers: [], instructions: "", kotRound: 2 } },
    } as Record<string, unknown>,
  );

  const swept = await sweepPrintJobs(nowMs);
  const keys = (await PrintJob.find({}).select("jobKey targetDeviceId originDeviceId").lean()).map((r) => r.jobKey).sort();
  check("(z) exactly the two server-owned rounds are repaired", swept.repaired === 2 && keys.join() === [`kot:${mixed}:2`, `kot:${owned}:1`].sort().join());
  const repaired = await PrintJob.findOne({ jobKey: `kot:${owned}:1` }).lean();
  check("(z) a repaired KOT prints at the host, names the device that fired it, and starts fresh", repaired?.targetDeviceId === HOST && repaired?.originDeviceId === PHONE && repaired?.status === "queued" && repaired?.epoch === 0);
  check("(z) never a round its tab printed itself, a cancelled order, or a round older than 30 min", !keys.some((k) => k?.includes(oldTab) || k?.includes(cancelled) || k?.includes(late) || k === `kot:${mixed}:1`));
  const second = await sweepPrintJobs(nowMs + 60_000);
  check("(z) a second sweep repairs nothing (one job per slip, ever)", second.repaired === 0 && (await PrintJob.countDocuments({})) === 2);

  await PrintHost.deleteMany({});
  await PrintJob.deleteMany({});
  const noHost = await sweepPrintJobs(nowMs + 120_000);
  const home = await PrintJob.findOne({ jobKey: `kot:${owned}:1` }).lean();
  check("(z) with no host, a repaired KOT goes to the device that fired the round", noHost.repaired === 2 && home?.targetDeviceId === PHONE);
}

export async function legAA(nowMs: number): Promise<void> {
  console.log("\n(aa) after a host change every waiting job prints where it should (1A review I1 part 2)");
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const order = JSON.parse(JSON.stringify(await orderOf(orderId)));
  const make = async (status: string, origin: boolean, extra: Record<string, unknown> = {}) => {
    const res = await enqueuePrintJob({ ...kotPrintJob(order, null), queuedBy: STAFF, ...(origin ? { originDeviceId: PHONE } : {}), nowMs });
    if (res.outcome !== "queued") throw new Error(`seed refused: ${res.outcome}`);
    await setRaw(res.id, { status, targetDeviceId: OLD_HOST, ...extra });
    return res.id;
  };
  const queued = await make("queued", true);
  const parked = await make("needs-confirm", true, { epoch: 1, attempts: 1, uncertainAttempts: 1 });
  const stopped = await make("failed", true, { epoch: 1, attempts: 8 });
  const writing = await make("leased", true, { epoch: 1, attempts: 1, lease: { deviceId: OLD_HOST, tabId: "t", epoch: 1, expiresAt: new Date(nowMs + 90_000) } });
  const orphan = await make("queued", false);

  const torn = await dismissQueuedPrintJobsForClearedHost(STAFF);
  check("(aa) clearing the host dismisses only the job no device asked for", torn === 1 && (await rowOf(orphan))?.dismissReason === "host-cleared" && (await rowOf(queued))?.status === "queued");
  await PrintHost.deleteMany({});
  const moved = await routeWaitingPrintJobs(null, nowMs);
  const [q, p, f, w] = await Promise.all([rowOf(queued), rowOf(parked), rowOf(stopped), rowOf(writing)]);
  check("(aa) with no host, queued, parked and failed slips go back to their own device", moved === 3 && [q, p, f].every((r) => r?.targetDeviceId === PHONE) && q?.log?.at(-1)?.event === "retargeted");
  check("(aa) … keeping their state, and a leased job is never moved under its writer", p?.status === "needs-confirm" && f?.status === "failed" && w?.targetDeviceId === OLD_HOST);

  // A host is designated again: every waiting job, parked and failed ones too, now prints there.
  await setRaw(parked, { targetDeviceId: OLD_HOST });
  const rehomed = await routeWaitingPrintJobs(HOST, nowMs);
  const after = await Promise.all([rowOf(queued), rowOf(parked), rowOf(stopped), rowOf(writing)]);
  check(
    "(aa) with a host, the queued, parked and failed jobs move to it (Print again then prints there); the leased one stays",
    rehomed === 3 && after.slice(0, 3).every((r) => r?.targetDeviceId === HOST) && after[3]?.targetDeviceId === OLD_HOST,
  );
}

export async function legAB(nowMs: number): Promise<void> {
  console.log("\n(ab) the lease is fenced on the device, and a lease call that clears four bad heads says when to look again");
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const res = await enqueuePrintJob({ ...kotPrintJob(JSON.parse(JSON.stringify(await orderOf(orderId))), 1), queuedBy: STAFF, nowMs });
  const id = res.outcome === "queued" ? res.id : "";
  const row = await PrintJob.findById(id).select(PRINT_LIFECYCLE_SELECT).lean<PrintLifecycleRow>();
  const job = lifecycleOf(row!);
  const plan = planLease(job, { deviceId: HOST, tabId: "tab-a" }, nowMs);
  await setRaw(id, { targetDeviceId: PHONE });
  const won = plan.ok && (await applyPrintJobPlan(row!._id, job, plan.patch, { targetDeviceId: HOST }));
  check("(ab) a job retargeted between the read and the CAS is not leased by the old device (M5)", !won && (await rowOf(id))?.status === "queued");

  await freshHost(nowMs);
  for (let i = 0; i < 4; i++) {
    await PrintJob.collection.insertOne({ kind: "kot", status: "queued", payload: "not json", label: `bad ${i}`, queuedBy: STAFF, targetDeviceId: HOST, createdAt: new Date(nowMs - 10_000 + i), updatedAt: new Date(nowMs) });
  }
  const good = await enqueuePrintJob({ ...kotPrintJob(JSON.parse(JSON.stringify(await orderOf(orderId))), 1), queuedBy: STAFF, nowMs });
  const firstCall = await leasePrintJobs({ deviceId: HOST, tabId: "tab-a", dismissedBy: STAFF, nowMs, tokenSlips: true });
  check("(ab) four bad heads in one call: nothing leased, look again in 2 s (M2)", firstCall.jobs.length === 0 && firstCall.retryAt === new Date(nowMs + 2_000).toISOString());
  const secondCall = await leasePrintJobs({ deviceId: HOST, tabId: "tab-a", dismissedBy: STAFF, nowMs: nowMs + 2_000, tokenSlips: true });
  check("(ab) … and the next call leases the good job behind them", good.outcome === "queued" && secondCall.jobs[0]?.id === good.id);
}

export async function legAC(nowMs: number): Promise<void> {
  console.log("\n(ac) a rush of newer orders never hides an older tab's missing KOT from the repair (final review I1)");
  await freshHost(nowMs);
  // An older tab (opened 25 min ago) fires round 2 a minute ago; the server owned that round and its job went missing.
  const older = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await Order.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(older) },
    {
      $set: { createdAt: new Date(nowMs - 25 * 60_000), kotRounds: 2, kotPrintDevices: ["", PHONE], kotFiredAt: [new Date(nowMs - 25 * 60_000), new Date(nowMs - 60_000)] },
      $push: { items: { productId: "00000000000000000000aaa2", name: "Coffee", price: 120, qty: 1, modifiers: [], instructions: "", kotRound: 2 } },
    } as Record<string, unknown>,
  );
  // A rush: 30 newer server-owned orders, each with its job already made.
  const rushKeys: string[] = [];
  for (let i = 0; i < 30; i++) {
    const id = await seedRealOrder({ status: "Completed", kotRound: 1 });
    await setOrderRaw(id, { kotPrintDevices: [PHONE] });
    await createOrderPrintJobs({ order: await orderOf(id), slips: [{ kind: "kot", round: 1 }], originDeviceId: PHONE, queuedBy: STAFF, nowMs });
    rushKeys.push(`kot:${id}:1`);
  }
  await sweepPrintJobs(nowMs);
  const repaired = await PrintJob.findOne({ jobKey: `kot:${older}:2` }).lean();
  check("(ac) the older tab's missing round is repaired behind a rush of 30 newer orders", repaired?.status === "queued" && repaired?.originDeviceId === PHONE);
  check("(ac) … and every rush order still has exactly its one job", (await PrintJob.countDocuments({ jobKey: { $in: rushKeys } })) === 30);
}
