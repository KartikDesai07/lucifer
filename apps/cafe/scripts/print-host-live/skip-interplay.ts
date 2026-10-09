/**
 * Phase 3 Session 3G live leg (bf) — the three signals of a skip together (spec §9.3; the 3B gate review's m-8: each path
 * had its own leg, never their interplay) against a REAL MongoDB, with every step's writes to the printers collection
 * counted (mongoose's debug hook): an "unreachable" ack starts a skip, a beat's settled `disconnected` starts one, a beat's
 * `connected` or a lease naming the printer ends one once its first 5 minutes are up, and inside those 5 minutes neither
 * ends it. A signal that changes nothing writes nothing: no step costs a write it does not need. The beat is the wake's
 * own write path (the heartbeat, the printers' health, the skips: app/api/print-jobs/wake). Run by
 * scripts/verify-print-host-live.ts after leg be.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PRINTER_UNREACHABLE_SKIP_MS, type PrinterHealthReport } from "@pos/shared/print-failover";
import { PrintDevice } from "@/models/PrintDevice";
import { Printer } from "@/models/Printer";
import { beatPrintDevice, readOnlinePrintDevices } from "@/lib/print-device";
import { skipUnreachableFromBeat } from "@/lib/print-failover";
import { recordPrinterHealth } from "@/lib/print-health";
import { ackPrintJob, leasePrintJobs } from "@/lib/print-lease";
import { listPrinters } from "@/lib/print-printers";
import { check } from "./harness";
import { STAFF, rowOf } from "./lifecycle";
import { COUNTER, KITCHEN, failoverOutlet, kotOf } from "./failover";

const CAPS = { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false, lanFailover: true };
const WRITES = new Set(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "bulkWrite", "insertOne", "insertMany", "deleteOne", "deleteMany"]);

/** The writes `step` sends to the printers collection (each one an Atlas operation). The final Phase 3 gate (the 3G
 *  review's m-6): mongoose's debug hook is process-wide: while it is set, every query this process sends is counted, so
 *  never run legs in parallel in one process (verify-print-host-live.ts awaits each leg in turn; leg host.ts's counter
 *  is the same kind). */
async function printerWrites<T>(step: () => Promise<T>): Promise<{ value: T; writes: number }> {
  let writes = 0;
  mongoose.set("debug", (collection: string, method: string) => {
    if (collection === "printers" && WRITES.has(method)) writes += 1;
  });
  try {
    return { value: await step(), writes };
  } finally {
    mongoose.set("debug", false);
  }
}

/** The wake's write path for one beat (the heartbeat, then the printers' health, then the skips it starts or ends): the
 *  printer writes of its health and of its skips, as "health+skips". */
async function beat(deviceId: string, reports: PrinterHealthReport[], nowMs: number): Promise<string> {
  await beatPrintDevice({ deviceId, label: deviceId, shell: "android", capabilities: CAPS }, nowMs);
  const [online, printers] = await Promise.all([readOnlinePrintDevices(nowMs), listPrinters()]);
  const failover = { online, nowMs };
  const health = await printerWrites(() => recordPrinterHealth({ deviceId, reports, printers, failover, nowMs }));
  const skips = await printerWrites(() => skipUnreachableFromBeat({ deviceId, lanFailover: true, reports, printers, failover, nowMs }));
  return `${health.writes}+${skips.writes}`;
}

const lease = (deviceId: string, printerIds: string[], nowMs: number) => printerWrites(() => leasePrintJobs({ deviceId, tabId: `${deviceId}-tab`, tokenSlips: true, printerIds, dismissedBy: STAFF, nowMs }));
const skipsOf = async (printerId: string) => ((await listPrinters()).find((printer) => printer.id === printerId)?.unreachable ?? []).map((skip) => skip.deviceId).sort().join();

export async function legBF(nowMs: number): Promise<void> {
  console.log("\n(bf) a skip's three signals together (§9.3; the 3B gate review's m-8): ack, beat and lease start and end it in either order, each change one write, nothing else written");
  const o = await failoverOutlet();
  const at = (s: number) => nowMs + s * 1_000;
  const both = async (s: number) => {
    await Promise.all([PrintDevice.deleteOne({ deviceId: KITCHEN }), PrintDevice.deleteOne({ deviceId: COUNTER })]);
    await Promise.all([beatPrintDevice({ deviceId: KITCHEN, label: KITCHEN, shell: "android", capabilities: CAPS }, at(s)), beatPrintDevice({ deviceId: COUNTER, label: COUNTER, shell: "android", capabilities: CAPS }, at(s))]);
  };
  const up: PrinterHealthReport[] = [{ printerId: o.kitchen, link: "connected" }];
  const down: PrinterHealthReport[] = [{ printerId: o.kitchen, link: "disconnected" }];
  await both(0);
  check("(bf) the kitchen tablet's first beat (its printer connected) writes the printer's health once, no skip", (await beat(KITCHEN, up, at(0))) === "1+0");
  check("(bf) ... and its next beat, nothing changed, writes nothing", (await beat(KITCHEN, up, at(30))) === "0+0");

  // The ack starts the skip; the beat ends it.
  const first = await kotOf(o, at(31));
  const mine = await lease(KITCHEN, [o.kitchen], at(32));
  const job = mine.value.jobs[0];
  check("(bf) the tablet leases its printer's slip (no skip to end: no printer write)", job?.id === first.kitchen?.id && mine.writes === 0);
  const refused = await printerWrites(() => ackPrintJob({ id: job?.id ?? "", deviceId: KITCHEN, epoch: job?.epoch ?? 0, outcome: "failed", sent: "no", reason: "unreachable", nowMs: at(33) }));
  check("(bf) its 'unreachable' ack starts its skip: one write; the slip moves to the counter", refused.writes === 1 && (await skipsOf(o.kitchen)) === KITCHEN && (await rowOf(first.kitchen?.id ?? ""))?.targetDeviceId === COUNTER);
  await both(60);
  check("(bf) its beat saying the printer is down, while skipped, writes nothing (no second skip; the health is not its to report now)", (await beat(KITCHEN, down, at(60))) === "0+0" && (await skipsOf(o.kitchen)) === KITCHEN);
  await both(120);
  check("(bf) its beat saying the printer is back, inside the skip's 5 minutes, writes nothing; the skip holds", (await beat(KITCHEN, up, at(120))) === "0+0" && (await skipsOf(o.kitchen)) === KITCHEN);
  const early = await lease(KITCHEN, [o.kitchen], at(180));
  check("(bf) its lease naming the printer inside the 5 minutes gets nothing and writes nothing", early.value.jobs.length === 0 && early.writes === 0 && (await skipsOf(o.kitchen)) === KITCHEN);
  const counter = await lease(COUNTER, [o.kitchen], at(181));
  const taken = counter.value.jobs[0];
  if (taken !== undefined) await ackPrintJob({ id: taken.id, deviceId: COUNTER, epoch: taken.epoch, outcome: "printed", tokenSlips: true, nowMs: at(182) });
  check("(bf) the counter prints the slip; its lease writes no printer", taken?.id === first.kitchen?.id && counter.writes === 0);
  const past = 33 + PRINTER_UNREACHABLE_SKIP_MS / 1_000 + 1;
  await both(past);
  check("(bf) past the 5 minutes, the tablet's beat saying the printer is back ends its skip: one write (its health is not the writer's yet)", (await beat(KITCHEN, up, at(past))) === "0+1" && (await skipsOf(o.kitchen)) === "");
  const backHome = await kotOf(o, at(past));
  check("(bf) ... the printer is the tablet's again: a new kitchen slip is its own", backHome.kitchen?.targetDeviceId === KITCHEN);
  check("(bf) ... its next beat ends nothing; as the writer again it owes its health's 5-minute refresh (last written at 0 s): one write", (await beat(KITCHEN, up, at(past + 15))) === "1+0");
  check("(bf) ... and the beat after that writes nothing", (await beat(KITCHEN, up, at(past + 30))) === "0+0");

  // The beat starts the skip; the lease ends it.
  const t = past + 60;
  await both(t);
  check("(bf) the tablet's beat says the printer is down (settled): its skip starts, one write for the health and one for the skip", (await beat(KITCHEN, down, at(t))) === "1+1" && (await skipsOf(o.kitchen)) === KITCHEN);
  const waiting = await kotOf(o, at(t + 1));
  check("(bf) ... a new kitchen slip goes to the counter", waiting.kitchen?.targetDeviceId === COUNTER);
  check("(bf) the same beat again writes nothing", (await beat(KITCHEN, down, at(t + 15))) === "0+0");
  const late = await printerWrites(() => ackPrintJob({ id: waiting.kitchen?.id ?? "", deviceId: KITCHEN, epoch: 1, outcome: "failed", sent: "no", reason: "unreachable", nowMs: at(t + 20) }));
  check("(bf) a late 'unreachable' ack from the tablet, which no longer holds the slip, changes nothing and writes no printer", late.writes === 0 && (await skipsOf(o.kitchen)) === KITCHEN);
  const after = t + PRINTER_UNREACHABLE_SKIP_MS / 1_000 + 1;
  await both(after);
  const home = await lease(KITCHEN, [o.kitchen], at(after));
  check("(bf) past the 5 minutes, the tablet's lease naming the printer (its app reaches it) ends its skip: one write, and it takes its line's oldest slip", home.writes === 1 && (await skipsOf(o.kitchen)) === "" && home.value.jobs[0]?.id === backHome.kitchen?.id);

  // A candidate's beat starts its skip ahead of time; its own beat ends it.
  const c = after + 60;
  await both(c);
  check("(bf) the counter (it may take the printer over) says it cannot reach it: skipped ahead of time, one write", (await beat(COUNTER, down, at(c))) === "0+1" && (await skipsOf(o.kitchen)) === COUNTER);
  check("(bf) ... its next beat, still down, writes nothing", (await beat(COUNTER, down, at(c + 15))) === "0+0");
  const end = c + PRINTER_UNREACHABLE_SKIP_MS / 1_000 + 1;
  await both(end);
  check("(bf) past the 5 minutes its beat saying it reaches the printer ends the skip: one write", (await beat(COUNTER, up, at(end))) === "0+1" && (await skipsOf(o.kitchen)) === "");
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}
