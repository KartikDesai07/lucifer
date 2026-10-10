/**
 * Phase 3 Session 3C live leg (be) — who may take a network printer over (spec §9.3; the 3A review gate's G-1 and the
 * 3B review's m-2) against a REAL MongoDB: a device counts as able to take one over only while its own wake is fresh
 * (PrintDevice.beatAt), never because its leases keep it online; the wake's heartbeat write is due again even right after
 * a lease touched the device; and a device that may take a printer over, whose beat says it cannot reach it, is skipped
 * for it ahead of time (once), so a failover never picks it first. Run by scripts/verify-print-host-live.ts after leg bd.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import type { PrinterHealthReport } from "@pos/shared/print-failover";
import { PrintDevice } from "@/models/PrintDevice";
import { Printer } from "@/models/Printer";
import { beatPrintDevice, listPrintDevices, readOnlinePrintDevices, touchPrintDevice } from "@/lib/print-device";
import { skipUnreachableFromBeat } from "@/lib/print-failover";
import { listPrinters } from "@/lib/print-printers";
import { routePrinterJobs } from "@/lib/print-sweep";
import { check } from "./harness";
import { rowOf } from "./lifecycle";
import { BAR, COUNTER, KITCHEN, failoverOutlet, kotOf, offline, online } from "./failover";

const CAPS = { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false, lanFailover: true };

/** What the wake does with a beat's printers after the health, for a device that says (or not) it may take one over. */
async function beat(deviceId: string, lanFailover: boolean, reports: PrinterHealthReport[], nowMs: number): Promise<number> {
  return skipUnreachableFromBeat({ deviceId, lanFailover, reports, printers: await listPrinters(), failover: { online: await readOnlinePrintDevices(nowMs), nowMs }, nowMs });
}

const skipsOf = async (printerId: string) => ((await listPrinters()).find((printer) => printer.id === printerId)?.unreachable ?? []).map((skip) => skip.deviceId).sort().join();
const takesOver = async (deviceId: string, nowMs: number) => (await readOnlinePrintDevices(nowMs)).find((device) => device.deviceId === deviceId)?.lanFailover === true;

export async function legBE(nowMs: number): Promise<void> {
  console.log("\n(be) who may take a printer over (§9.3; G-1, m-2): only a device whose own wake is fresh; a candidate that cannot reach a printer is skipped ahead of time");
  const o = await failoverOutlet();
  await Promise.all([online(KITCHEN, nowMs), online(COUNTER, nowMs), online(BAR, nowMs)]);
  check("(be) every device's wake fresh: each may take a printer over", (await takesOver(BAR, nowMs)) && (await takesOver(COUNTER, nowMs)));

  // G-1: the bar phone's printer moved to another device, so its page stopped polling the wake two minutes ago; a lease
  // of its own keeps it online. The bar phone's id sorts first, so without G-1 it would take the kitchen printer over.
  await PrintDevice.updateOne({ deviceId: BAR }, { $set: { lastSeenAt: new Date(nowMs - 120_000), beatAt: new Date(nowMs - 120_000) } });
  await touchPrintDevice(BAR, nowMs + 1_000);
  const seen = (await readOnlinePrintDevices(nowMs + 1_000)).find((device) => device.deviceId === BAR);
  check("(be) a device online only by its lease (its wake stopped) is online, yet may not take a printer over (G-1)", seen !== undefined && seen.lanFailover === false);
  check("(be) ... and the devices read does not say it can", (await listPrintDevices(nowMs + 1_000)).find((device) => device.deviceId === BAR)?.lanFailover === undefined);
  await offline(KITCHEN, nowMs + 2_000);
  const first = await kotOf(o, nowMs + 2_000);
  check("(be) the kitchen tablet offline: the counter, whose wake is fresh, takes the kitchen printer over, never the bar phone", (await rowOf(first.kitchen?.id ?? ""))?.targetDeviceId === COUNTER);

  // The wake's own write is due once beatAt is 30 s old, even though the lease touched lastSeenAt a second ago.
  await beatPrintDevice({ deviceId: BAR, label: BAR, shell: "android", capabilities: CAPS }, nowMs + 2_500);
  check("(be) the bar phone's wake again, a moment after its lease: the heartbeat writes, and it may take a printer over again", await takesOver(BAR, nowMs + 2_500));

  // m-2: the kitchen tablet back, the bar phone (a candidate: it says lanFailover, the setup names the tablet) beats that
  // it cannot reach the kitchen printer: it is skipped ahead of time, once, and nothing moves.
  await online(KITCHEN, nowMs + 3_000);
  await routePrinterJobs(nowMs + 3_000);
  const ahead = await beat(BAR, true, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 3_500);
  check(
    "(be) a candidate's beat that cannot reach a network printer skips it ahead of time (one write); the slip stays with its primary",
    ahead === 1 && (await skipsOf(o.kitchen)) === BAR && (await rowOf(first.kitchen?.id ?? ""))?.targetDeviceId === KITCHEN,
  );
  const before = await Printer.findById(o.kitchen).select("updatedAt").lean<{ updatedAt: Date }>();
  check(
    "(be) ... once: its next beats, still down, write nothing",
    (await beat(BAR, true, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 4_000)) === 0 &&
      (await Printer.findById(o.kitchen).select("updatedAt").lean<{ updatedAt: Date }>())?.updatedAt.getTime() === before?.updatedAt.getTime(),
  );
  check(
    "(be) a page from before 3C (no lanFailover) that does not write the printer skips nothing",
    (await beat(COUNTER, false, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 4_000)) === 0 && (await skipsOf(o.kitchen)) === BAR,
  );
  await offline(KITCHEN, nowMs + 5_000);
  const second = await kotOf(o, nowMs + 5_000);
  check("(be) the kitchen tablet offline again: the counter takes the printer over at once, never the skipped bar phone (m-2)", (await rowOf(second.kitchen?.id ?? ""))?.targetDeviceId === COUNTER);
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}
