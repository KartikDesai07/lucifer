/**
 * Phase 2 Session 2C live legs — printers mode (spec §8, §9.3; plan decisions 1–5, 15) against a REAL MongoDB:
 * creation routed by station with a full copy, a bill with copies, and a slip no printer takes (an); a lease per
 * printer line, only by its writer (ao); the sweep and a staff retry when a printer's writer changes or the printer
 * goes (ap); the repair of a routed round, and the 2B gate's re-delivery bound (aq). Run by
 * scripts/verify-print-host-live.ts after legs ak–am. Each leg sets the outlet up itself and ends in simple mode.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PRINTER_GONE_MESSAGE, PRINT_JOB_NO_PRINTER } from "@pos/shared/print-printers";
import { PRINT_DIRECT_LEASE_DETAIL } from "@pos/shared/print-lifecycle";
import { Category } from "@/models/Category";
import { Order } from "@/models/Order";
import { PrintJob } from "@/models/PrintJob";
import { Printer } from "@/models/Printer";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { createPrinter, deletePrinter, replacePrinter } from "@/lib/print-printers";
import { createStation, listStations } from "@/lib/print-stations";
import { createOrderPrintJobs, enqueueDirectPrintJob } from "@/lib/print-order-jobs";
import { ackPrintJob, leasePrintJobs, readJobsForDevice } from "@/lib/print-lease";
import { retryPrintJob } from "@/lib/print-job-actions";
import { dismissQueuedPrintJobsForClearedHost } from "@/lib/print-queue";
import { repairMissingKotJobs } from "@/lib/print-repair";
import { routePrinterJobs, routeWaitingPrintJobs } from "@/lib/print-sweep";
import { kotPrintJob } from "@/lib/print-routing";
import { check, resetCollections } from "./harness";
import { HOST, STAFF, rowOf, setRaw } from "./lifecycle";

const COUNTER = "live-counter-device";
const KITCHEN = "live-kitchen-device";
const BAR = "live-bar-device";
const TAB = "live-counter-tab";
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

interface Outlet {
  kitchenStation: string;
  barStation: string;
  kitchen: string;
  bar: string;
  counter: string;
  paneer: string;
  mojito: string;
}

function body(name: string, over: Partial<PrinterBody>): PrinterBody {
  return { name, connection: { kind: "lan", host: "10.0.0.9", port: 9100 }, paper: 80, slips: NO_SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

async function idOf(made: Promise<{ ok: boolean; data?: { id: string } }>): Promise<string> {
  const result = await made;
  return result.ok && result.data !== undefined ? result.data.id : "";
}

/** A kitchen (LAN, written by the kitchen tablet), a bar (the bar phone's own printer) and a counter (LAN, written
 *  by the counter device: bills in two copies, the full copy, notices, End of day). Paneer cooks in the kitchen
 *  (Food has no station: the default), the Mojito at the bar (Drinks). */
async function outlet(): Promise<Outlet> {
  // Orders too: the repair (aq) must see only this leg's rounds, never an earlier leg's server-owned ones.
  await Promise.all([resetCollections(), Order.deleteMany({}), Station.deleteMany({}), Printer.deleteMany({}), Category.deleteMany({}), Product.deleteMany({})]);
  const [kitchenStation] = await listStations();
  const barStation = await idOf(createStation({ name: "Bar" }));
  const kitchenId = kitchenStation?.id ?? "";
  const food = await Category.create({ name: "Food" });
  const drinks = await Category.create({ name: "Drinks", stationId: barStation });
  const paneer = await Product.create({ name: "Paneer Tikka", categoryId: food._id, price: 250 });
  const mojito = await Product.create({ name: "Mojito", categoryId: drinks._id, price: 150 });
  const kitchen = await idOf(createPrinter(body("Kitchen", { connection: { kind: "lan", host: "10.0.0.61", port: 9100 }, primaryDeviceId: KITCHEN, slips: { ...NO_SLIPS, kotStations: [kitchenId], notices: true } })));
  const bar = await idOf(createPrinter(body("Bar", { connection: { kind: "device", deviceId: BAR, transport: "bt-classic", address: "AA:BB" }, slips: { ...NO_SLIPS, kotStations: [barStation], notices: true } })));
  const counter = await idOf(createPrinter(body("Counter", { primaryDeviceId: COUNTER, slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true }, copies: { kot: 1, bill: 2 } })));
  return { kitchenStation: kitchenId, barStation, kitchen, bar, counter, paneer: String(paneer._id), mojito: String(mojito._id) };
}

/** A paid order with Paneer and a Mojito in round 1 (a server-owned round when `printDevice` is given). */
async function order(o: Outlet, printDevice?: string): Promise<string> {
  const doc = await Order.create({
    orderId: `ORD-2C-${new mongoose.Types.ObjectId().toHexString()}`,
    customerName: "Walk-in",
    items: [
      { productId: o.paneer, name: "Paneer Tikka", price: 250, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
      { productId: o.mojito, name: "Mojito", price: 150, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
    ],
    subtotal: 400,
    discount: 0,
    total: 400,
    paidAmount: 400,
    payment: "Cash",
    status: "Completed",
    receiver: "Staff",
    kotRounds: 1,
    ...(printDevice !== undefined ? { kotPrintDevices: [printDevice] } : {}),
  });
  return String(doc._id);
}

async function payNow(orderId: string, device: string, nowMs: number, ready: string[] = [], tab?: string) {
  return createOrderPrintJobs({
    order: await Order.findById(orderId).lean(),
    slips: [{ kind: "kot", round: 1 }, { kind: "bill" }],
    originDeviceId: device,
    ...(tab !== undefined ? { leaseTabId: tab } : {}),
    readyPrinterIds: ready,
    queuedBy: STAFF,
    nowMs,
  });
}

const linesOf = async (id: string): Promise<string> => {
  const row = await PrintJob.findById(id).select("payload").lean();
  const payload = JSON.parse(row?.payload ?? "{}") as { snapshot?: { items?: Array<{ name: string }> }; station?: { mode: string } };
  return `${payload.station?.mode ?? "-"}:${(payload.snapshot?.items ?? []).map((item) => item.name).join("+")}`;
};

async function simpleModeAgain(): Promise<void> {
  await Printer.deleteMany({});
}

export async function legAN(nowMs: number): Promise<void> {
  console.log("\n(an) printers mode: one job per printer line, by station with the full copy; the counter's own slip leased to it");
  const o = await outlet();
  check("(an) a station name differing only in case is refused (409, the 2A gate's M7)", !(await createStation({ name: "bar" })).ok);
  const orderId = await order(o);
  const refs = await payNow(orderId, COUNTER, nowMs, [o.counter], TAB);
  const byPrinter = new Map(refs.map((ref) => [ref.printerId, ref]));
  const [kitchen, bar, full, bill] = [byPrinter.get(o.kitchen), byPrinter.get(o.bar), refs.find((r) => r.printerId === o.counter && r.kind === "kot"), refs.find((r) => r.kind === "bill")];
  check("(an) Pay Now makes four jobs: the kitchen's, the bar's, the counter's full copy, and the bill", refs.length === 4 && kitchen !== undefined && bar !== undefined && full !== undefined && bill !== undefined);
  check("(an) each station slip waits for its writer, queued: the kitchen tablet, the bar phone", kitchen?.status === "queued" && kitchen.targetDeviceId === KITCHEN && bar?.status === "queued" && bar.targetDeviceId === BAR);
  check("(an) the counter's full copy is made leased to its tab (decision 15 per printer line); the bill waits behind it", full?.status === "leased" && full.leased?.printerId === o.counter && bill?.status === "queued" && bill.targetDeviceId === COUNTER);
  check("(an) each slip holds its own lines: the kitchen Paneer, the bar the Mojito, the full copy both (ALL STATIONS)", (await linesOf(kitchen?.id ?? "")) === "station:Paneer Tikka" && (await linesOf(bar?.id ?? "")) === "station:Mojito" && (await linesOf(full?.id ?? "")) === "all:Paneer Tikka+Mojito");
  const fullRow = await rowOf(full?.id ?? "");
  const billRow = await PrintJob.findById(bill?.id ?? "").select("jobKey copies").lean();
  check("(an) keys add the printer and the part; the bill's two copies are one job", fullRow?.jobKey === `kot:${orderId}:1:${o.counter}:all` && billRow?.jobKey === `bill:${orderId}:${o.counter}:-` && billRow?.copies === 2);
  check("(an) the direct job was one write, its log 'leased(direct)'", fullRow?.updatedAt.getTime() === fullRow?.createdAt.getTime() && fullRow?.log?.[1]?.detail === PRINT_DIRECT_LEASE_DETAIL);
  const again = await payNow(orderId, COUNTER, nowMs, [o.counter], TAB);
  check("(an) a replay makes nothing new: the same four jobs", again.length === 4 && (await PrintJob.countDocuments({ orderId })) === 4);
  const phone = await payNow(await order(o), "live-phone", nowMs, [o.counter], TAB);
  check("(an) a device that writes no printer gets nothing leased, whatever it names", phone.length === 4 && phone.every((ref) => ref.leased === undefined));
  await deletePrinter(o.counter);
  const orphan = await payNow(await order(o), COUNTER, nowMs);
  const noBill = orphan.find((ref) => ref.kind === "bill");
  const failed = await PrintJob.findById(noBill?.id ?? "").select("status printerId lastError log targetDeviceId").lean();
  check("(an) with no bill printer the bill is made failed at once, visibly ('none', its reason, its log)", noBill?.status === "failed" && failed?.printerId === PRINT_JOB_NO_PRINTER && failed.lastError === "No printer is set up for bills." && failed.targetDeviceId === COUNTER && failed.log?.map((e) => e.event).join() === "created,failed");
  await simpleModeAgain();
}

export async function legAO(nowMs: number): Promise<void> {
  console.log("\n(ao) a lease per printer line, only by its writer; a stuck bar job never blocks the kitchen");
  const o = await outlet();
  await payNow(await order(o), COUNTER, nowMs);
  const wrong = await leasePrintJobs({ deviceId: BAR, tabId: "bar-tab", printerIds: [o.kitchen], dismissedBy: STAFF, nowMs });
  check("(ao) a device naming a printer it does not write gets nothing from it", wrong.jobs.length === 0);
  const kitchen = await leasePrintJobs({ deviceId: KITCHEN, tabId: "kitchen-tab", printerIds: [o.kitchen, o.bar], dismissedBy: STAFF, nowMs });
  check("(ao) the kitchen tablet leases its own printer's slip only", kitchen.jobs.length === 1 && kitchen.jobs[0]?.printerId === o.kitchen);
  const barJob = await leasePrintJobs({ deviceId: BAR, tabId: "bar-tab", printerIds: [o.bar], dismissedBy: STAFF, nowMs });
  check("(ao) the bar phone leases the bar's", barJob.jobs.length === 1 && barJob.jobs[0]?.printerId === o.bar);
  const acked = await ackPrintJob({ id: kitchen.jobs[0]?.id ?? "", deviceId: KITCHEN, epoch: 1, outcome: "printed", nowMs: nowMs + 1_000 });
  check("(ao) the kitchen's ack: printed, and more:false (its own line is empty, whatever waits elsewhere)", acked.status === "printed" && acked.more === false);
  await payNow(await order(o), COUNTER, nowMs + 2_000);
  const next = await leasePrintJobs({ deviceId: BAR, tabId: "bar-tab", printerIds: [o.bar], dismissedBy: STAFF, nowMs: nowMs + 3_000 });
  check("(ao) the bar's next slip waits behind its leased one (head of line per printer)", next.jobs.length === 0 && next.retryAt !== null);
  const kitchen2 = await leasePrintJobs({ deviceId: KITCHEN, tabId: "kitchen-tab", printerIds: [o.kitchen], dismissedBy: STAFF, nowMs: nowMs + 3_000 });
  check("(ao) ... and never blocks the kitchen's", kitchen2.jobs.length === 1 && kitchen2.jobs[0]?.printerId === o.kitchen);
  // A fresh outlet where the kitchen tablet writes both the kitchen and the bar printer. Session 2D's save refuses a
  // second enabled printer for one device (until 2E), so the row is written with the model: the server still leases
  // both lines of one writer.
  const two = await outlet();
  await Printer.updateOne({ _id: two.bar }, { $set: { connection: { kind: "device", deviceId: KITCHEN, transport: "bt-classic", address: "AA:BB" } } });
  await payNow(await order(two), COUNTER, nowMs);
  const counted = await readJobsForDevice(KITCHEN, nowMs + 1_000);
  const both = await leasePrintJobs({ deviceId: KITCHEN, tabId: "kitchen-tab", printerIds: [two.kitchen, two.bar], dismissedBy: STAFF, nowMs: nowMs + 1_000 });
  const pair = [two.kitchen, two.bar].sort().join();
  check("(ao) a device writing two printers counts and leases both lines in one call, one job each", counted.count === 2 && both.jobs.map((job) => job.printerId).sort().join() === pair);
  check("(ao) its jobs-for-me names both printers, so a stale printer list reads itself again (the 2C review, I-2)", [...(counted.printerIds ?? [])].sort().join() === pair);
  await simpleModeAgain();
}

export async function legAP(nowMs: number): Promise<void> {
  console.log("\n(ap) the sweep: a printer job follows its printer's writer, or fails when its printer is gone; simple mode never moves it");
  const o = await outlet();
  const refs = await payNow(await order(o), COUNTER, nowMs);
  const kitchenRef = refs.find((ref) => ref.printerId === o.kitchen);
  const barRef = refs.find((ref) => ref.printerId === o.bar);
  await routeWaitingPrintJobs(HOST, nowMs);
  check("(ap) simple mode's move to a host never touches a printer job", (await rowOf(kitchenRef?.id ?? ""))?.targetDeviceId === KITCHEN);
  await replacePrinter(o.kitchen, body("Kitchen", { connection: { kind: "lan", host: "10.0.0.61", port: 9100 }, primaryDeviceId: "live-new-kitchen", slips: { ...NO_SLIPS, kotStations: [o.kitchenStation], notices: true } }));
  await deletePrinter(o.bar);
  const moved = await routePrinterJobs(nowMs + 1_000);
  const kitchenRow = await rowOf(kitchenRef?.id ?? "");
  const barRow = await rowOf(barRef?.id ?? "");
  check("(ap) a printer re-saved with another printing device takes its waiting job along", kitchenRow?.targetDeviceId === "live-new-kitchen" && kitchenRow.log?.at(-1)?.event === "retargeted" && moved.retargeted >= 1);
  check("(ap) a removed printer's waiting job fails visibly, never guessed onto another printer", barRow?.status === "failed" && barRow.lastError === PRINTER_GONE_MESSAGE && moved.failed === 1);
  const refused = await retryPrintJob({ id: barRef?.id ?? "", nowMs: nowMs + 2_000 });
  check("(ap) a staff Retry on it is refused: its printer is gone (ruling R2)", !refused.applied && refused.reason === "printer-gone");
  const kitchenId = kitchenRef?.id ?? "";
  await setRaw(kitchenId, { status: "failed", targetDeviceId: KITCHEN });
  const retried = await retryPrintJob({ id: kitchenId, nowMs: nowMs + 2_500 });
  const retriedRow = await rowOf(kitchenId);
  check("(ap) a Retry on a printer that still takes slips puts the job on its current writer's line, in the same write (the 2C review, I-3)", retried.applied && retriedRow?.status === "queued" && retriedRow.targetDeviceId === "live-new-kitchen");
  await setRaw(kitchenId, { targetDeviceId: KITCHEN });
  const old = await leasePrintJobs({ deviceId: KITCHEN, tabId: "kitchen-tab", printerIds: [o.kitchen], dismissedBy: STAFF, nowMs: nowMs + 3_000 });
  const claimed = await leasePrintJobs({ deviceId: "live-new-kitchen", tabId: "new-tab", printerIds: [o.kitchen], dismissedBy: STAFF, nowMs: nowMs + 3_000 });
  check("(ap) a job still aimed at the old writer: the old one gets nothing, the printer's writer leases it and claims it (I-3)", old.jobs.length === 0 && claimed.jobs[0]?.id === kitchenId && (await rowOf(kitchenId))?.targetDeviceId === "live-new-kitchen");
  const orphanId = new mongoose.Types.ObjectId();
  await PrintJob.collection.insertOne({ _id: orphanId, kind: "eod", payload: JSON.stringify({ kind: "eod", dateKey: "2026-10-04", dateLabel: "4 Oct" }), label: "End of day", queuedBy: STAFF, status: "queued", targetDeviceId: COUNTER, printerId: o.counter, createdAt: new Date(nowMs), updatedAt: new Date(nowMs) });
  await dismissQueuedPrintJobsForClearedHost(STAFF);
  check("(ap) Stop printing here never cancels a printer's slip (one no device asked for included)", (await rowOf(String(orphanId)))?.status === "queued");
  const billId = refs.find((ref) => ref.kind === "bill")?.id ?? "";
  await setRaw(billId, { status: "needs-confirm" });
  await deletePrinter(o.counter);
  await routePrinterJobs(nowMs + 4_000);
  check("(ap) a bill waiting for the cashier's answer keeps waiting for it when its printer goes (the 2C review, I-1)", (await rowOf(billId))?.status === "needs-confirm" && (await rowOf(String(orphanId)))?.status === "failed");
  await simpleModeAgain();
}

export async function legAQ(nowMs: number): Promise<void> {
  console.log("\n(aq) the repair routes a server-owned round that has no job; the 2B gate's re-delivery bound");
  const o = await outlet();
  const orderId = await order(o, COUNTER);
  const repaired = await repairMissingKotJobs(nowMs);
  const keys = (await PrintJob.find({ orderId }).select("jobKey").lean()).map((row) => row.jobKey ?? "").sort();
  check("(aq) a round with no job at all is routed again with today's setup: the kitchen, the bar and the full copy", repaired === 3 && keys.join() === [`kot:${orderId}:1:${o.bar}:${o.barStation}`, `kot:${orderId}:1:${o.counter}:all`, `kot:${orderId}:1:${o.kitchen}:${o.kitchenStation}`].sort().join());
  await PrintJob.deleteOne({ jobKey: `kot:${orderId}:1:${o.bar}:${o.barStation}` });
  check("(aq) a round with some of its jobs is left alone (one request made them together)", (await repairMissingKotJobs(nowMs + 1_000)) === 0 && (await PrintJob.countDocuments({ orderId })) === 2);
  await simpleModeAgain();
  await resetCollections();
  const simple = await order(o);
  const wire = JSON.parse(JSON.stringify(await Order.findById(simple).lean())) as Parameters<typeof kotPrintJob>[0];
  await createOrderPrintJobs({ order: await Order.findById(simple).lean(), slips: [{ kind: "kot", round: 1 }], originDeviceId: HOST, queuedBy: STAFF, nowMs });
  const leased = await leasePrintJobs({ deviceId: HOST, tabId: TAB, dismissedBy: STAFF, nowMs });
  const kot = kotPrintJob(wire, 1);
  const resend = (at: number) => enqueueDirectPrintJob({ payload: kot.payload, label: kot.label, queuedBy: STAFF, originDeviceId: HOST, leaseTabId: TAB, nowMs: at });
  const soon = await resend(nowMs + 10_000);
  check("(aq) a lease the tab took through the lease call is handed back to it within one request timeout (the 2B gate's M-3)", leased.jobs.length === 1 && soon?.outcome === "queued" && soon.leased?.id === leased.jobs[0]?.id);
  const late = await resend(nowMs + 16_000);
  check("(aq) later, never (the 2B gate's I-A): the lease is left to expire into one REPRINT", late?.outcome === "already-resolved");
}
