/**
 * Phase 1 live legs, part 2: the device heartbeat (v), the cashier's and staff decisions (w), and
 * Idempotency-Key enqueues (x). See lifecycle.ts for the run order.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PrintJob } from "@/models/PrintJob";
import { PrintDevice } from "@/models/PrintDevice";
import { dismissQueuedPrintJobsForClearedHost, enqueuePrintJob } from "@/lib/print-queue";
import { ackPrintJob } from "@/lib/print-lease";
import { confirmPrintJob, retryPrintJob } from "@/lib/print-job-actions";
import { beatPrintDevice, countOnlineAgents, touchPrintDevice } from "@/lib/print-device";
import { billPrintJob, kotPrintJob } from "@/lib/print-routing";
import { baseOrderFields, check, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost, lease, queueBill, queueKot, rowOf, setRaw } from "./lifecycle";

export async function legV(nowMs: number): Promise<void> {
  console.log("\n(v) the device heartbeat writes at most once per 30 s");
  await PrintDevice.deleteMany({});
  const beat = {
    deviceId: "live-tablet",
    label: "Kitchen tablet",
    shell: "android" as const,
    capabilities: { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false },
    appVersion: "1.0.0",
    nativeProtocol: 1,
  };
  await beatPrintDevice(beat, nowMs);
  await beatPrintDevice({ ...beat, label: "Renamed" }, nowMs + 1_000);
  let row = await PrintDevice.findOne({ deviceId: "live-tablet" }).lean();
  check("(v) a second beat within 30 s writes nothing, and does not throw", row?.label === "Kitchen tablet" && row?.lastSeenAt.getTime() === nowMs);
  await beatPrintDevice({ ...beat, label: "Renamed" }, nowMs + 31_000);
  row = await PrintDevice.findOne({ deviceId: "live-tablet" }).lean();
  check("(v) a beat after 30 s refreshes the row", row?.label === "Renamed" && row?.lastSeenAt.getTime() === nowMs + 31_000);
  await beatPrintDevice({ ...beat, deviceId: "live-pc", shell: "windows" }, nowMs + 31_000);
  check("(v) two devices seen in the last 90 s count as two agents", (await countOnlineAgents(nowMs + 31_000)) === 2);
  await touchPrintDevice("live-pc", nowMs + 70_000);
  check("(v) a lease refreshes a known device", (await PrintDevice.findOne({ deviceId: "live-pc" }).lean())?.lastSeenAt.getTime() === nowMs + 70_000);
  await touchPrintDevice("live-unknown", nowMs + 70_000);
  check("(v) a lease never creates a device row", (await PrintDevice.countDocuments({ deviceId: "live-unknown" })) === 0);
  check("(v) with nobody online the count is still 1 (it divides the wake cap)", (await countOnlineAgents(nowMs + 600_000)) === 1);
}

export async function legW(nowMs: number): Promise<void> {
  console.log("\n(w) the cashier's decision and Print again");
  await freshHost(nowMs);
  const bill = await queueBill(nowMs);
  await lease(nowMs);
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: 1, outcome: "failed", sent: "maybe", error: "paper jam", nowMs });
  let row = await rowOf(bill);
  check("(w) a bill that may have printed waits for the cashier", row?.status === "needs-confirm" && row?.lastError === "paper jam");
  const again = await confirmPrintJob({ id: bill, decision: "reprint", staff: STAFF, nowMs: nowMs + 1 });
  row = await rowOf(bill);
  check("(w) 'Print again' queues it with DUPLICATE, counters reset, approved", again.applied && row?.status === "queued" && JSON.stringify(row?.labels) === '["DUPLICATE"]' && row?.attempts === 0 && row?.approvedAt !== undefined);
  const second = await lease(nowMs + 2);
  check("(w) the DUPLICATE copy is leased next, epoch 2", second.jobs[0]?.id === bill && second.jobs[0]?.epoch === 2 && second.jobs[0]?.labels.includes("DUPLICATE") === true);
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: 2, outcome: "failed", sent: "maybe", nowMs: nowMs + 3 });
  const said = await confirmPrintJob({ id: bill, decision: "printed", staff: STAFF, nowMs: nowMs + 4 });
  row = await rowOf(bill);
  check("(w) 'It printed' resolves it, stamped with the cashier", said.applied && row?.status === "printed" && row?.printedBy === STAFF);
  const late = await confirmPrintJob({ id: bill, decision: "dismiss", staff: STAFF, nowMs: nowMs + 5 });
  check("(w) a decision on a job that is not waiting for one is refused", !late.applied && late.reason === "wrong-status");

  const other = await queueBill(nowMs);
  await lease(nowMs + 6);
  await ackPrintJob({ id: other, deviceId: HOST, epoch: 1, outcome: "failed", sent: "maybe", nowMs: nowMs + 7 });
  await confirmPrintJob({ id: other, decision: "dismiss", staff: STAFF, nowMs: nowMs + 8 });
  const dropped = await rowOf(other);
  check("(w) 'Dismiss' ends it as the cashier's", dropped?.status === "dismissed" && dropped?.dismissReason === "cashier" && dropped?.dismissedBy === STAFF);

  const kot = await queueKot(nowMs);
  await lease(nowMs + 9);
  await ackPrintJob({ id: kot, deviceId: HOST, epoch: 1, outcome: "failed", sent: "maybe", permanent: true, error: "TOO_LARGE", nowMs: nowMs + 10 });
  check("(w) a permanent error fails the job at once", (await rowOf(kot))?.status === "failed");
  const retried = await retryPrintJob({ id: kot, nowMs: nowMs + 11 });
  row = await rowOf(kot);
  check("(w) Print again requeues it with REPRINT (it may have printed), counters reset", retried.applied && row?.status === "queued" && JSON.stringify(row?.labels) === '["REPRINT"]' && row?.attempts === 0 && row?.uncertainAttempts === 0);

  // Spec §7.1: clearing the host dismisses every unresolved job, but never a leased one (its writer
  // may be printing it; the lease expires in 90 s). Session 1A final-review fix I1.
  const parked = await queueBill(nowMs);
  const stopped = await queueKot(nowMs);
  const writing = await queueKot(nowMs);
  await setRaw(parked, { status: "needs-confirm", epoch: 1, attempts: 1, uncertainAttempts: 1 });
  await setRaw(stopped, { status: "failed", epoch: 1, attempts: 8 });
  await setRaw(writing, { status: "leased", epoch: 1, attempts: 1, lease: { deviceId: HOST, tabId: "tab-a", epoch: 1, expiresAt: new Date(nowMs + 90_000) } });
  const torn = await dismissQueuedPrintJobsForClearedHost(STAFF);
  const [parkedRow, stoppedRow, writingRow, retriedRow] = await Promise.all([rowOf(parked), rowOf(stopped), rowOf(writing), rowOf(kot)]);
  check("(w) clearing the host dismisses a bill waiting for the cashier", parkedRow?.status === "dismissed" && parkedRow?.dismissReason === "host-cleared");
  check("(w) clearing the host dismisses a failed job", stoppedRow?.status === "dismissed" && stoppedRow?.dismissReason === "host-cleared");
  check("(w) clearing the host still dismisses a queued job", retriedRow?.status === "dismissed" && retriedRow?.dismissReason === "host-cleared");
  check("(w) clearing the host never tears down a leased job, and counts only what it dismissed", writingRow?.status === "leased" && torn === 3);
}

export async function legX(nowMs: number): Promise<void> {
  console.log("\n(x) a client-started repeat dedupes on its Idempotency-Key and carries its label");
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const reprint = billPrintJob(baseOrderFields({ _id: orderId }), { reprint: true });
  const key = "live-key-0001-bill";
  const first = await enqueuePrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: key, originDeviceId: "live-order-phone", nowMs });
  const retry = await enqueuePrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: key, originDeviceId: "live-order-phone", nowMs });
  const firstId = first.outcome === "queued" ? first.id : null;
  check("(x) a retried reprint with the same key is one job", firstId !== null && retry.outcome === "queued" && retry.duplicate && retry.id === firstId);
  const row = await PrintJob.findOne({ jobKey: `reprint:${key}` }).lean();
  check("(x) it carries DUPLICATE, the host as target, and the asking device", JSON.stringify(row?.labels) === '["DUPLICATE"]' && row?.targetDeviceId === HOST && row?.originDeviceId === "live-order-phone" && row?.log?.[0]?.event === "created");
  const tapAgain = await enqueuePrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: "live-key-0002-bill", nowMs });
  check("(x) a second tap (a new key) is a second copy", tapAgain.outcome === "queued" && tapAgain.id !== firstId);
  const tab = kotPrintJob(baseOrderFields({ _id: orderId }), null);
  const kotReprint = await enqueuePrintJob({ ...tab, queuedBy: STAFF, idempotencyKey: "live-key-0003-kot", nowMs });
  const kotRow = kotReprint.outcome === "queued" ? await rowOf(kotReprint.id) : null;
  check("(x) a whole-tab KOT reprint carries REPRINT", JSON.stringify(kotRow?.labels) === '["REPRINT"]');
}
