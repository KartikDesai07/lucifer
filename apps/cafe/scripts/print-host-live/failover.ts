/**
 * Phase 3 Session 3A live leg (ba) — failover (spec §9.3) against a REAL MongoDB: a network printer whose primary is
 * offline is written by an online device that may take it over, and job creation, the lease, a staff Retry, a Test
 * print and the sweep all agree on who; a page from before Phase 3 never takes one over; a device printer never moves;
 * a writer that could not reach the printer is skipped for it for 5 minutes and the waiting slip moves to the next
 * writer at once. The outlet helpers are shared with legs bb and bc. Run by scripts/verify-print-host-live.ts after
 * leg az.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PRINTER_UNREACHABLE_SKIP_MS } from "@pos/shared/print-failover";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { Category } from "@/models/Category";
import { Order } from "@/models/Order";
import { PrintDevice } from "@/models/PrintDevice";
import { PrintJob } from "@/models/PrintJob";
import { Printer } from "@/models/Printer";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { beatPrintDevice } from "@/lib/print-device";
import { recordPrinterUnreachable } from "@/lib/print-failover";
import { retryPrintJob } from "@/lib/print-job-actions";
import { ackPrintJob, leasePrintJobs } from "@/lib/print-lease";
import { createOrderPrintJobs } from "@/lib/print-order-jobs";
import { createPrinterTestJob } from "@/lib/print-printer-test";
import { createPrinter, listPrinters } from "@/lib/print-printers";
import { createStation, listStations } from "@/lib/print-stations";
import { routePrinterJobs } from "@/lib/print-sweep";
import { check, resetCollections } from "./harness";
import { STAFF, rowOf, setRaw } from "./lifecycle";

export const KITCHEN = "live-fo-kitchen";
export const COUNTER = "live-fo-counter";
export const BAR = "live-fo-bar";
const OLD = "live-fo-old-page";
const PHONE = "live-fo-phone";
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };
const CAPS = { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false };

export interface FailoverOutlet {
  kitchen: string;
  bar: string;
  counter: string;
  paneer: string;
  mojito: string;
}

/** A device whose wake was just seen (a fresh heartbeat); `lanFailover` false is a page from before Phase 3. */
export async function online(deviceId: string, nowMs: number, lanFailover = true): Promise<void> {
  await PrintDevice.deleteOne({ deviceId });
  await beatPrintDevice({ deviceId, label: deviceId, shell: "android", capabilities: { ...CAPS, lanFailover } }, nowMs);
}

/** A device last seen two minutes before `nowMs` (no heartbeat for 90 s: offline). */
export async function offline(deviceId: string, nowMs: number): Promise<void> {
  await PrintDevice.updateOne({ deviceId }, { $set: { lastSeenAt: new Date(nowMs - 120_000) } });
}

function body(name: string, over: Partial<PrinterBody>): PrinterBody {
  return { name, connection: { kind: "lan", host: "10.0.0.70", port: 9100 }, paper: 80, slips: NO_SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

async function idOf(made: Promise<{ ok: boolean; data?: { id: string } }>): Promise<string> {
  const result = await made;
  return result.ok && result.data !== undefined ? result.data.id : "";
}

/** The kitchen's network printer (written by the kitchen tablet), the bar's own Bluetooth printer (the bar phone), and
 *  the counter's network printer (bills, End of day; written by the counter). Paneer cooks in the kitchen, the Mojito
 *  at the bar. */
export async function failoverOutlet(over: { bar?: Partial<PrinterBody> } = {}): Promise<FailoverOutlet> {
  await Promise.all([
    resetCollections(),
    Order.deleteMany({}),
    Station.deleteMany({}),
    Printer.deleteMany({}),
    Category.deleteMany({}),
    Product.deleteMany({}),
    PrintDevice.deleteMany({}),
  ]);
  const [kitchenStation] = await listStations();
  const barStation = await idOf(createStation({ name: "Bar" }));
  const food = await Category.create({ name: "Food" });
  const drinks = await Category.create({ name: "Drinks", stationId: barStation });
  const paneer = await Product.create({ name: "Paneer Tikka", categoryId: food._id, price: 250 });
  const mojito = await Product.create({ name: "Mojito", categoryId: drinks._id, price: 150 });
  const kitchen = await idOf(createPrinter(body("Kitchen", { connection: { kind: "lan", host: "10.0.0.71", port: 9100 }, primaryDeviceId: KITCHEN, slips: { ...NO_SLIPS, kotStations: [kitchenStation?.id ?? ""], notices: true } })));
  const counter = await idOf(createPrinter(body("Counter", { connection: { kind: "lan", host: "10.0.0.72", port: 9100 }, primaryDeviceId: COUNTER, slips: { ...NO_SLIPS, bill: true, eod: true } })));
  const bar = await idOf(
    createPrinter(body("Bar", { connection: { kind: "device", deviceId: BAR, transport: "bt-classic", address: "AA:BB:CC" }, slips: { ...NO_SLIPS, kotStations: [barStation], notices: true }, ...over.bar })),
  );
  return { kitchen, bar, counter, paneer: String(paneer._id), mojito: String(mojito._id) };
}

/** A fresh order's round-1 KOT (Paneer and a Mojito), asked for by a waiter phone: each station's job, by printer. */
export async function kotOf(o: FailoverOutlet, nowMs: number): Promise<{ kitchen?: PrintJobRef; bar?: PrintJobRef }> {
  const doc = await Order.create({
    orderId: `ORD-3A-${new mongoose.Types.ObjectId().toHexString()}`,
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
  });
  const refs = await createOrderPrintJobs({ order: await Order.findById(doc._id).lean(), slips: [{ kind: "kot", round: 1 }], originDeviceId: PHONE, queuedBy: STAFF, nowMs });
  return { kitchen: refs.find((ref) => ref.printerId === o.kitchen), bar: refs.find((ref) => ref.printerId === o.bar) };
}

const lease = (deviceId: string, printerIds: string[], nowMs: number) => leasePrintJobs({ deviceId, tabId: `${deviceId}-tab`, tokenSlips: true, printerIds, dismissedBy: STAFF, nowMs });
const skipsOf = async (printerId: string) => (await listPrinters()).find((printer) => printer.id === printerId)?.unreachable ?? [];

export async function legBA(nowMs: number): Promise<void> {
  console.log("\n(ba) failover (§9.3): a network printer whose primary is offline is written by a device that may take it over; one that cannot reach it is skipped for 5 minutes");
  const o = await failoverOutlet();
  await Promise.all([online(KITCHEN, nowMs), online(COUNTER, nowMs), online(BAR, nowMs)]);
  const first = await kotOf(o, nowMs);
  check("(ba) every device online: the kitchen's slip is the kitchen tablet's, the bar's the bar phone's", first.kitchen?.targetDeviceId === KITCHEN && first.bar?.targetDeviceId === BAR);

  await Promise.all([offline(KITCHEN, nowMs), offline(BAR, nowMs)]);
  const away = await kotOf(o, nowMs);
  check("(ba) the kitchen tablet offline: a new kitchen slip goes to the counter, which may write network printers; the bar's own printer never moves", away.kitchen?.targetDeviceId === COUNTER && away.bar?.targetDeviceId === BAR);
  const swept = await routePrinterJobs(nowMs + 1_000);
  const moved = await rowOf(first.kitchen?.id ?? "");
  check("(ba) the sweep moves the kitchen slip that waited for the tablet to the counter, logged 'retargeted'", moved?.targetDeviceId === COUNTER && moved.log?.at(-1)?.event === "retargeted" && swept.retargeted >= 1);
  const taken = await lease(COUNTER, [o.kitchen, o.counter], nowMs + 2_000);
  check("(ba) the counter leases the kitchen printer's line, its oldest slip first, and claims it", taken.jobs.length === 1 && taken.jobs[0]?.id === first.kitchen?.id && (await rowOf(first.kitchen?.id ?? ""))?.targetDeviceId === COUNTER);
  await ackPrintJob({ id: taken.jobs[0]?.id ?? "", deviceId: COUNTER, epoch: taken.jobs[0]?.epoch ?? 0, outcome: "printed", tokenSlips: true, nowMs: nowMs + 3_000 });
  check("(ba) ... never the bar's own printer, whatever it names", (await lease(COUNTER, [o.bar], nowMs + 3_000)).jobs.length === 0);
  const test = await createPrinterTestJob({ printerId: o.kitchen, queuedBy: STAFF, nowMs: nowMs + 3_000 });
  check("(ba) a Test print of the kitchen printer goes to the counter too", test.ok && test.data.targetDeviceId === COUNTER);

  await online(KITCHEN, nowMs + 4_000);
  await routePrinterJobs(nowMs + 4_000);
  check("(ba) the tablet back online: the kitchen's waiting slip goes home", (await rowOf(away.kitchen?.id ?? ""))?.targetDeviceId === KITCHEN);
  check("(ba) ... and the counter no longer leases it", (await lease(COUNTER, [o.kitchen], nowMs + 4_000)).jobs.length === 0);

  await Promise.all([offline(KITCHEN, nowMs + 5_000), offline(COUNTER, nowMs + 5_000), online(OLD, nowMs + 5_000, false)]);
  const old = await kotOf(o, nowMs + 5_000);
  check("(ba) a page from before Phase 3 never takes a printer over: with no other writer the slip waits for the tablet", old.kitchen?.targetDeviceId === KITCHEN);
  check("(ba) ... and its lease gets nothing from it", (await lease(OLD, [o.kitchen], nowMs + 5_000)).jobs.length === 0);
  await online(COUNTER, nowMs + 6_000);
  await setRaw(old.kitchen?.id ?? "", { status: "failed" });
  const retried = await retryPrintJob({ id: old.kitchen?.id ?? "", nowMs: nowMs + 6_000 });
  check("(ba) a staff Retry puts it on the line of the device that writes the printer now: the counter", retried.applied && (await rowOf(old.kitchen?.id ?? ""))?.targetDeviceId === COUNTER);

  await PrintJob.deleteMany({});
  await online(KITCHEN, nowMs + 7_000);
  const u = await kotOf(o, nowMs + 7_000);
  const mine = await lease(KITCHEN, [o.kitchen], nowMs + 7_500);
  const refused = await ackPrintJob({ id: mine.jobs[0]?.id ?? "", deviceId: KITCHEN, epoch: mine.jobs[0]?.epoch ?? 0, outcome: "failed", sent: "no", reason: "unreachable", error: "NOT_CONNECTED", nowMs: nowMs + 8_000 });
  const skips = await skipsOf(o.kitchen);
  check(
    "(ba) the tablet cannot reach its printer: the refusal lands (queued, no attempt counted) and the tablet is skipped for it for 5 minutes",
    refused.status === "queued" && skips.length === 1 && skips[0]?.deviceId === KITCHEN && Date.parse(skips[0]?.until ?? "") === nowMs + 8_000 + PRINTER_UNREACHABLE_SKIP_MS,
  );
  const movedNow = await rowOf(u.kitchen?.id ?? "");
  check("(ba) ... and its slip moves to the counter at once, with no sweep, logged 'retargeted'", movedNow?.targetDeviceId === COUNTER && movedNow.log?.at(-1)?.event === "retargeted" && movedNow.uncertainAttempts === 0);
  const counterTakes = await lease(COUNTER, [o.kitchen], nowMs + 11_000);
  check("(ba) the counter leases it", counterTakes.jobs[0]?.id === u.kitchen?.id);
  check("(ba) while skipped, the tablet gets nothing from its own printer", (await lease(KITCHEN, [o.kitchen], nowMs + 11_000)).jobs.length === 0);
  await ackPrintJob({ id: counterTakes.jobs[0]?.id ?? "", deviceId: COUNTER, epoch: counterTakes.jobs[0]?.epoch ?? 0, outcome: "failed", sent: "no", reason: "unreachable", nowMs: nowMs + 12_000 });
  check("(ba) the counter cannot reach it either: both are skipped, and the slip goes back to its primary (it waits, visibly)", (await rowOf(u.kitchen?.id ?? ""))?.targetDeviceId === KITCHEN && (await skipsOf(o.kitchen)).length === 2);
  const late = await recordPrinterUnreachable({ printerId: o.kitchen, deviceId: BAR, nowMs: nowMs + 13_000 });
  check("(ba) a device that does not write it now changes nothing", late === KITCHEN && (await skipsOf(o.kitchen)).length === 2);
  check("(ba) a device printer is never skipped (only network printers fail over)", (await recordPrinterUnreachable({ printerId: o.bar, deviceId: BAR, nowMs: nowMs + 13_000 })) === null && (await skipsOf(o.bar)).length === 0);

  const later = nowMs + 12_000 + PRINTER_UNREACHABLE_SKIP_MS + 1_000;
  await Promise.all([online(KITCHEN, later), online(COUNTER, later)]);
  check("(ba) five minutes on, the skips have run out: a new kitchen slip is the tablet's again", (await kotOf(o, later)).kitchen?.targetDeviceId === KITCHEN);
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}
