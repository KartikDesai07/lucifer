/**
 * Phase 2 Session 2B live legs — direct print on the asking device (spec §7.11, plan decisions 15, 16 and 9)
 * against a REAL MongoDB: a slip made already leased to the asking tab, in one write (ak); a lost answer handed
 * back to the same tab, and to no other (al); a creation lease that runs out, and the ack's `more` (am). Run by
 * scripts/verify-print-host-live.ts after legs ah–aj.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINT_LEASE_MS, PRINT_DIRECT_LEASE_DETAIL } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { Order } from "@/models/Order";
import { createOrderPrintJobs, enqueueDirectPrintJob } from "@/lib/print-order-jobs";
import { ackPrintJob, leasePrintJobs, readJobsForDevice } from "@/lib/print-lease";
import { billPrintJob, kotPrintJob } from "@/lib/print-routing";
import { check, seedPrintHost, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost, queueKot, rowOf } from "./lifecycle";

const PHONE = "live-direct-phone";
const TAB = "live-direct-tab-1";

async function wireOrder(id: string) {
  const order = await Order.findById(id).lean();
  if (order === null) throw new Error("seeded order missing");
  return JSON.parse(JSON.stringify(order)) as Parameters<typeof kotPrintJob>[0];
}

/** A Pay Now on a fresh order, made by `device` (its tab `tab`, if any). */
async function payNow(device: string, nowMs: number, tab?: string) {
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const refs = await createOrderPrintJobs({
    order: await Order.findById(orderId).lean(),
    slips: [{ kind: "kot", round: 1 }, { kind: "bill" }],
    originDeviceId: device,
    ...(tab !== undefined ? { leaseTabId: tab } : {}),
    queuedBy: STAFF,
    nowMs,
  });
  return { orderId, refs };
}

export async function legAK(nowMs: number): Promise<void> {
  console.log("\n(ak) direct print: the asking tab's first slip on its own free line is made leased to it, in one write");
  await freshHost(nowMs);
  const { orderId, refs } = await payNow(HOST, nowMs, TAB);
  const [kotRef, billRef] = refs;
  const kot = await rowOf(kotRef?.id ?? "");
  const bill = await rowOf(billRef?.id ?? "");
  check("(ak) the host's own Pay Now: the KOT's ref carries its lease; the bill's ref is queued, with none", kotRef?.status === "leased" && kotRef.leased?.epoch === 1 && kotRef.leased.attempt === 1 && kotRef.leased.payload.kind === "kot" && billRef?.status === "queued" && billRef.leased === undefined);
  check(
    "(ak) the KOT row is leased to that tab: epoch 1, one attempt, a 90 s lease, today's key",
    kot?.status === "leased" && kot.epoch === 1 && kot.attempts === 1 && kot.uncertainAttempts === 0 && kot.lease?.deviceId === HOST && kot.lease.tabId === TAB && kot.lease.epoch === 1 && kot.lease.expiresAt.getTime() === nowMs + PRINT_LEASE_MS && kot.jobKey === `kot:${orderId}:1`,
  );
  check("(ak) its log says created, then leased directly; it was ONE write (updatedAt is its createdAt)", JSON.stringify(kot?.log?.map((e) => [e.event, e.detail ?? null])) === JSON.stringify([["created", null], ["leased", PRINT_DIRECT_LEASE_DETAIL]]) && kot?.updatedAt.getTime() === kot?.createdAt.getTime());
  check("(ak) the bill waits queued behind it (epoch 0)", bill?.status === "queued" && bill.epoch === 0 && bill.lease === undefined);
  const blocked = await leasePrintJobs({ deviceId: HOST, tabId: TAB, dismissedBy: STAFF, nowMs: nowMs + 1_000 });
  check("(ak) the line waits for that lease: a lease call gets nothing, and when to look again (KOT before bill, §7.6)", blocked.jobs.length === 0 && blocked.retryAt === new Date(nowMs + PRINT_LEASE_MS).toISOString());

  await freshHost(nowMs);
  const phone = await payNow(PHONE, nowMs, TAB);
  check("(ak) a slip another device prints is never made leased to the asking tab", phone.refs.every((r) => r.status === "queued" && r.leased === undefined && r.targetDeviceId === HOST));
  await queueKot(nowMs - 5_000);
  const busy = await payNow(HOST, nowMs, TAB);
  check("(ak) a line with an older job waiting: made queued, as in Phase 1", busy.refs.length === 2 && busy.refs.every((r) => r.status === "queued" && r.leased === undefined));
  const noTab = await payNow(HOST, nowMs);
  check("(ak) no lease header: made queued, as in Phase 1", noTab.refs.every((r) => r.status === "queued" && r.leased === undefined));

  await PrintHost.deleteMany({});
  const own = await payNow(PHONE, nowMs, TAB);
  check("(ak) no host: the asking device's own first slip is made leased to its tab", own.refs[0]?.status === "leased" && own.refs[0]?.leased !== undefined && own.refs[0]?.targetDeviceId === PHONE && own.refs[1]?.status === "queued");
}

export async function legAL(nowMs: number): Promise<void> {
  console.log("\n(al) a lost answer: the same tab gets the same lease back from the enqueue; any other gets Phase 1's answer");
  await freshHost(nowMs);
  await PrintHost.deleteMany({});
  const reprint = billPrintJob(await wireOrder(await seedRealOrder({ status: "Completed", kotRound: 1 })), { reprint: true });
  const send = (tab: string, device = PHONE, at = nowMs) =>
    enqueueDirectPrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: "live-key-0002-direct", originDeviceId: device, leaseTabId: tab, nowMs: at });
  const first = await send(TAB);
  const firstLeased = first?.outcome === "queued" ? first.leased : undefined;
  check("(al) no host: an agent's own reprint is made leased to its tab and answered with the lease", first?.outcome === "queued" && !first.duplicate && firstLeased?.epoch === 1 && JSON.stringify(firstLeased.labels) === '["DUPLICATE"]');
  const again = await send(TAB, PHONE, nowMs + 5_000);
  check("(al) the same tab re-sends it (its answer was lost): the same job, the same lease, nothing new", again?.outcome === "queued" && again.duplicate && again.id === firstLeased?.id && again.leased?.epoch === 1 && (await PrintJob.countDocuments({})) === 1);
  const otherTab = await send("live-direct-tab-2");
  check("(al) another tab of the device (a reload): Phase 1's answer, no lease (its lease expires: REPRINT)", otherTab?.outcome === "already-resolved");
  const otherDevice = await send(TAB, "live-direct-phone-2");
  check("(al) another device: Phase 1's answer, no lease", otherDevice?.outcome === "already-resolved");
  const late = await send(TAB, PHONE, nowMs + PRINT_LEASE_MS + 1);
  check("(al) a lease that ran out is never handed back", late?.outcome === "already-resolved");

  await seedPrintHost({ deviceId: HOST, label: "Counter PC", setBy: STAFF, nowMs });
  const hostElsewhere = await enqueueDirectPrintJob({ ...billPrintJob(await wireOrder(await seedRealOrder({ status: "Completed", kotRound: 1 })), { reprint: true }), queuedBy: STAFF, idempotencyKey: "live-key-0003-direct", originDeviceId: PHONE, leaseTabId: TAB, nowMs });
  check("(al) another device is the host: not direct (null), Phase 1's enqueue makes it for the host", hostElsewhere === null);

  await freshHost(nowMs);
  const { orderId, refs } = await payNow(HOST, nowMs, TAB);
  const resend = await enqueueDirectPrintJob({ ...kotPrintJob(await wireOrder(orderId), 1), queuedBy: STAFF, originDeviceId: HOST, leaseTabId: TAB, nowMs: nowMs + 3_000 });
  check("(al) the host's own order answer lost: its re-sent KOT gets the KOT's lease back, and no second job", resend?.outcome === "queued" && resend.duplicate && resend.id === refs[0]?.id && resend.leased?.epoch === 1 && (await PrintJob.countDocuments({ orderId })) === 2);
}

export async function legAM(nowMs: number): Promise<void> {
  console.log("\n(am) a creation lease that runs out follows §7's rules; the ack answers whether the line holds more");
  await freshHost(nowMs);
  const { refs } = await payNow(HOST, nowMs, TAB);
  const [kotRef, billRef] = refs;
  const kotAck = await ackPrintJob({ id: kotRef?.id ?? "", deviceId: HOST, epoch: 1, outcome: "printed", nowMs: nowMs + 3_000 });
  check("(am) the KOT's ack: printed, and more:true (the bill waits on the line)", kotAck.applied && kotAck.status === "printed" && kotAck.more === true);
  const billLease = await leasePrintJobs({ deviceId: HOST, tabId: TAB, dismissedBy: STAFF, nowMs: nowMs + 3_100 });
  check("(am) the bill is leased next", billLease.jobs[0]?.id === billRef?.id);
  const billAck = await ackPrintJob({ id: billRef?.id ?? "", deviceId: HOST, epoch: 1, outcome: "printed", nowMs: nowMs + 6_000 });
  check("(am) the bill's ack: more:false, so the agent leases nothing more", billAck.applied && billAck.status === "printed" && billAck.more === false);
  const repeat = await ackPrintJob({ id: billRef?.id ?? "", deviceId: HOST, epoch: 1, outcome: "printed", nowMs: nowMs + 7_000 });
  check("(am) a repeated ack changes nothing and says nothing about more", !repeat.applied && repeat.reason === "resolved" && repeat.more === undefined);

  await freshHost(nowMs);
  const dead = await payNow(HOST, nowMs, TAB);
  const later = nowMs + PRINT_LEASE_MS + 1_000;
  const [running, ranOut] = [await readJobsForDevice(HOST, nowMs + 1_000), await readJobsForDevice(HOST, later)];
  check("(am) the pulse and the wake count what a lease can act on: never a running lease (the bill only), but one that ran out", running.count === 1 && ranOut.count === 2);
  await leasePrintJobs({ deviceId: HOST, tabId: "live-direct-tab-new", dismissedBy: STAFF, nowMs: later });
  const kot = await rowOf(dead.refs[0]?.id ?? "");
  check("(am) the tab died before printing: its KOT's lease expires into REPRINT, counted once", kot?.status === "queued" && JSON.stringify(kot.labels) === '["REPRINT"]' && kot.uncertainAttempts === 1);
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const billOnly = await createOrderPrintJobs({ order: await Order.findById(orderId).lean(), slips: [{ kind: "bill" }], originDeviceId: HOST, leaseTabId: TAB, queuedBy: STAFF, nowMs });
  await leasePrintJobs({ deviceId: HOST, tabId: "live-direct-tab-new", dismissedBy: STAFF, nowMs: later });
  check("(am) a bill made leased whose tab died asks the cashier (needs-confirm)", billOnly[0]?.status === "leased" && (await rowOf(billOnly[0].id))?.status === "needs-confirm");
  const refused = await payNow(HOST, nowMs, TAB);
  const no = await ackPrintJob({ id: refused.refs[0]?.id ?? "", deviceId: HOST, epoch: 1, outcome: "failed", sent: "no", error: "Printer not connected", nowMs: nowMs + 2_000 });
  check("(am) a creation lease its printer refused goes back in line, never counted, with no more hint", no.applied && no.status === "queued" && no.nextAttemptAt !== null && no.more === undefined && (await rowOf(refused.refs[0]?.id ?? ""))?.uncertainAttempts === 0);
}
