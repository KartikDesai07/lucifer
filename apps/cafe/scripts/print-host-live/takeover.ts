/**
 * Phase 3 Session 3B live leg (bd) — the server half of the page's takeover (spec §9.3; the 3A review gate, M-8 d)
 * against a REAL MongoDB: a beat that says a device cannot reach a network printer it writes now skips it, as an
 * "unreachable" ack does, and the waiting slip moves to the next device that can take the printer over; the beats after
 * it write nothing; a device that does not write the printer now, a device printer, or a "connected" beat never skip; the
 * wake's answer names the printers a device took over; the devices read says which device can take one over. Run by
 * scripts/verify-print-host-live.ts after leg bc.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINTER_UNREACHABLE_SKIP_MS, printersTakenOverBy, type PrinterHealthReport } from "@pos/shared/print-failover";
import { PrintDevice } from "@/models/PrintDevice";
import { Printer } from "@/models/Printer";
import { listPrintDevices, readOnlinePrintDevices } from "@/lib/print-device";
import { skipUnreachableFromBeat } from "@/lib/print-failover";
import { listPrinters } from "@/lib/print-printers";
import { routePrinterJobs } from "@/lib/print-sweep";
import { check } from "./harness";
import { rowOf } from "./lifecycle";
import { BAR, COUNTER, KITCHEN, failoverOutlet, kotOf, offline, online } from "./failover";

/** What the wake does with a beat's printers after the health: who is online, then the skips its links ask for. */
async function beat(deviceId: string, reports: PrinterHealthReport[], nowMs: number): Promise<number> {
  return skipUnreachableFromBeat({ deviceId, reports, printers: await listPrinters(), failover: { online: await readOnlinePrintDevices(nowMs), nowMs }, nowMs });
}

const skipsOf = async (printerId: string) => ((await listPrinters()).find((printer) => printer.id === printerId)?.unreachable ?? []).map((skip) => skip.deviceId).sort().join();
const takenOverBy = async (deviceId: string, nowMs: number) => printersTakenOverBy(await listPrinters(), deviceId, { online: await readOnlinePrintDevices(nowMs), nowMs });

export async function legBD(nowMs: number): Promise<void> {
  console.log("\n(bd) the page's takeover, server half (§9.3): a beat that cannot reach a network printer it writes now skips it; the wake names what a device took over");
  const o = await failoverOutlet();
  // The bar phone also says lanFailover (the outlet's helpers make every device a Phase 3 page), and its id sorts before
  // the counter's, so it is the first to take the kitchen's network printer over.
  await Promise.all([online(KITCHEN, nowMs), online(COUNTER, nowMs), online(BAR, nowMs)]);
  check("(bd) every primary online: no device has taken anything over", (await takenOverBy(BAR, nowMs)).length === 0);
  check("(bd) a device that does not write the printer now, reporting it down, skips nothing", (await beat(COUNTER, [{ printerId: o.kitchen, link: "disconnected" }], nowMs)) === 0 && (await skipsOf(o.kitchen)) === "");
  check("(bd) a device printer reported down never skips (only network printers fail over)", (await beat(BAR, [{ printerId: o.bar, link: "disconnected" }], nowMs)) === 0 && (await skipsOf(o.bar)) === "");

  await offline(KITCHEN, nowMs + 1_000);
  const waiting = await kotOf(o, nowMs + 1_000);
  check("(bd) the kitchen tablet offline: the bar phone takes the kitchen printer over, and the wake tells it so", (await takenOverBy(BAR, nowMs + 1_000)).join() === o.kitchen && (await rowOf(waiting.kitchen?.id ?? ""))?.targetDeviceId === BAR);
  check("(bd) a 'connected' beat never skips", (await beat(BAR, [{ printerId: o.kitchen, link: "connected" }], nowMs + 1_500)) === 0 && (await skipsOf(o.kitchen)) === "");
  const skipped = await beat(BAR, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 2_000);
  check(
    "(bd) the bar phone's beat says it cannot reach the kitchen printer: it is skipped, and the waiting slip moves to the counter at once",
    skipped === 1 && (await skipsOf(o.kitchen)) === BAR && (await rowOf(waiting.kitchen?.id ?? ""))?.targetDeviceId === COUNTER,
  );
  check("(bd) ... and the wake now tells the counter, not the bar phone", (await takenOverBy(COUNTER, nowMs + 2_000)).join() === o.kitchen && (await takenOverBy(BAR, nowMs + 2_000)).length === 0);
  const before = await Printer.findById(o.kitchen).select("updatedAt").lean<{ updatedAt: Date }>();
  check(
    "(bd) the bar phone's next beats, still down, write nothing (its skip holds)",
    (await beat(BAR, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 3_000)) === 0 &&
      (await Printer.findById(o.kitchen).select("updatedAt").lean<{ updatedAt: Date }>())?.updatedAt.getTime() === before?.updatedAt.getTime(),
  );
  await beat(COUNTER, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 4_000);
  check(
    "(bd) the counter cannot reach it either: both skipped, the slip waits for its primary (visibly: its device is offline)",
    (await skipsOf(o.kitchen)) === [BAR, COUNTER].sort().join() && (await rowOf(waiting.kitchen?.id ?? ""))?.targetDeviceId === KITCHEN,
  );
  // The 3A review gate (I-A): the primary back, its beat says it reaches the printer; past its 5 minutes that ends its
  // skip, as its lease naming the printer would, and the sweep sends the waiting slip home.
  await online(KITCHEN, nowMs + 4_500);
  await beat(KITCHEN, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 4_500);
  const early = await beat(KITCHEN, [{ printerId: o.kitchen, link: "connected" }], nowMs + 5_000);
  check("(bd) the kitchen tablet back but unable to reach it is skipped too; its 'connected' beat inside its 5 minutes ends nothing", early === 0 && (await skipsOf(o.kitchen)).includes(KITCHEN));
  const later = nowMs + 4_500 + PRINTER_UNREACHABLE_SKIP_MS + 1_000;
  await Promise.all([online(KITCHEN, later), online(COUNTER, later), online(BAR, later)]);
  const ended = await beat(KITCHEN, [{ printerId: o.kitchen, link: "connected" }], later);
  await routePrinterJobs(later);
  check(
    "(bd) past them, its 'connected' beat ends its skip: the kitchen printer is its own again and the sweep sends the slip home",
    ended === 1 && !(await skipsOf(o.kitchen)).includes(KITCHEN) && (await rowOf(waiting.kitchen?.id ?? ""))?.targetDeviceId === KITCHEN,
  );

  // The 3A review gate (m-D): a network printer that every writer is skipped for, with a backup, moves its waiting slips
  // there (labelled), as a printer whose device is offline does.
  await Printer.updateOne({ _id: o.kitchen }, { $set: { backupPrinterId: o.counter } });
  await beat(KITCHEN, [{ printerId: o.kitchen, link: "disconnected" }], later + 1_000);
  const stuck = await kotOf(o, later + 1_000);
  await routePrinterJobs(later + 1_000);
  const toBackup = await rowOf(stuck.kitchen?.id ?? "");
  check(
    "(bd) every writer skipped for the kitchen printer, its primary online: its waiting slip goes to its backup, labelled BACKUP PRINTER",
    (await skipsOf(o.kitchen)) === [BAR, COUNTER, KITCHEN].sort().join() && toBackup?.printerId === o.counter && (toBackup.labels ?? []).join() === "BACKUP PRINTER",
  );
  const devices = await listPrintDevices(later + 1_000);
  check("(bd) the devices read says which devices can take a network printer over", devices.length === 3 && devices.every((device) => device.lanFailover === true));
  await online(COUNTER, later + 2_000, false);
  check("(bd) ... and says nothing for a page from before Phase 3", (await listPrintDevices(later + 2_000)).find((device) => device.deviceId === COUNTER)?.lanFailover === undefined);
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}
