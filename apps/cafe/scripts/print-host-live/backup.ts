/**
 * Phase 3 Session 3A live leg (bb) — the backup printer (spec §9.4) against a REAL MongoDB: saved with a printer (never
 * itself, never a printer that does not exist, cleared when that printer is deleted); the sweep moves the waiting slips
 * of a printer whose device is offline to it, labelled BACKUP PRINTER, while a slip that may have printed stays; a
 * network printer with no device left to take it over moves too; nothing moves with no backup, with the backup's own
 * device offline, or once the device is back. Run by scripts/verify-print-host-live.ts after leg ba.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINTER_BACKUP_SELF_MESSAGE, PRINTER_BACKUP_UNKNOWN_MESSAGE, PRINTER_BACKUP_UNUSABLE_MESSAGE } from "@pos/shared/print-failover";
import { PrintDevice } from "@/models/PrintDevice";
import { Printer } from "@/models/Printer";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { leasePrintJobs } from "@/lib/print-lease";
import { createPrinter, deletePrinter, listPrinters, replacePrinter } from "@/lib/print-printers";
import { routePrinterJobs } from "@/lib/print-sweep";
import { check } from "./harness";
import { STAFF, rowOf, setRaw } from "./lifecycle";
import { BAR, COUNTER, KITCHEN, failoverOutlet, kotOf, offline, online } from "./failover";

const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

export async function legBB(nowMs: number): Promise<void> {
  console.log("\n(bb) the backup printer (§9.4): a printer whose device is offline sends its waiting slips there, labelled BACKUP PRINTER");
  const o = await failoverOutlet();
  const barStation = String((await Station.findOne({ name: "Bar" }).select("_id").lean())?._id ?? "");
  const bar = (over: Partial<PrinterBody>): PrinterBody => ({
    name: "Bar",
    connection: { kind: "device", deviceId: BAR, transport: "bt-classic", address: "AA:BB:CC" },
    paper: 80,
    slips: { ...NO_SLIPS, kotStations: [barStation], notices: true },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  });
  const self = await replacePrinter(o.bar, bar({ backupPrinterId: o.bar }));
  const unknown = await replacePrinter(o.bar, bar({ backupPrinterId: "aaaaaaaaaaaaaaaaaaaaaaaa" }));
  check("(bb) a printer is never its own backup, and a backup must exist (400s, in words)", !self.ok && self.error === PRINTER_BACKUP_SELF_MESSAGE && !unknown.ok && unknown.error === PRINTER_BACKUP_UNKNOWN_MESSAGE);
  // The 3A review gate (m-1): a printer that takes no slip would be an inert backup.
  const spareMade = await createPrinter({ ...bar({}), name: "Spare", connection: { kind: "lan", host: "10.0.0.73", port: 9100 }, primaryDeviceId: COUNTER, slips: NO_SLIPS });
  const spare = spareMade.ok ? spareMade.data.id : "";
  const inert = await replacePrinter(o.bar, bar({ backupPrinterId: spare }));
  const inertNew = await createPrinter({ ...bar({ backupPrinterId: spare }), name: "Bar 2", connection: { kind: "device", deviceId: "live-fo-bar2", transport: "bt-classic", address: "AA:BB:DD" } });
  check("(bb) a backup that takes no slips is refused at save, on an edit and on a new printer (400, in words)", !inert.ok && inert.error === PRINTER_BACKUP_UNUSABLE_MESSAGE && !inertNew.ok && inertNew.error === PRINTER_BACKUP_UNUSABLE_MESSAGE);
  await Printer.updateOne({ _id: o.bar }, { $set: { backupPrinterId: spare } });
  const keptInert = await replacePrinter(o.bar, bar({ backupPrinterId: spare }));
  check("(bb) ... but a backup already saved that stopped taking slips never fails a save that keeps it", keptInert.ok && keptInert.data.backupPrinterId === spare);
  const saved = await replacePrinter(o.bar, bar({ backupPrinterId: o.counter }));
  check("(bb) the bar printer saved with the counter printer as its backup", saved.ok && saved.data.backupPrinterId === o.counter);

  await Promise.all([online(KITCHEN, nowMs), online(COUNTER, nowMs), online(BAR, nowMs)]);
  const fresh = await kotOf(o, nowMs);
  const maybe = await kotOf(o, nowMs);
  await setRaw(maybe.bar?.id ?? "", { uncertainAttempts: 1, labels: ["REPRINT"] });
  await routePrinterJobs(nowMs + 500);
  check("(bb) the bar phone online: nothing moves", (await rowOf(fresh.bar?.id ?? ""))?.printerId === o.bar);

  await offline(BAR, nowMs + 1_000);
  await routePrinterJobs(nowMs + 1_000);
  const moved = await rowOf(fresh.bar?.id ?? "");
  check(
    "(bb) the bar phone offline: its waiting slip moves to the counter printer, for the counter, labelled BACKUP PRINTER",
    moved?.printerId === o.counter && moved.targetDeviceId === COUNTER && (moved.labels ?? []).join() === "BACKUP PRINTER",
  );
  check("(bb) ... logged 'retargeted' with both printers' names", moved?.log?.at(-1)?.event === "retargeted" && moved.log?.at(-1)?.detail === "backup printer: Bar -> Counter");
  const stayed = await rowOf(maybe.bar?.id ?? "");
  check("(bb) a slip that may already have printed stays with the bar printer (REPRINT kept, never doubled elsewhere)", stayed?.printerId === o.bar && (stayed.labels ?? []).join() === "REPRINT");
  const taken = await leasePrintJobs({ deviceId: COUNTER, tabId: "counter-tab", tokenSlips: true, printerIds: [o.counter], dismissedBy: STAFF, nowMs: nowMs + 2_000 });
  check("(bb) the counter leases it and prints the banner BACKUP PRINTER", taken.jobs[0]?.id === fresh.bar?.id && taken.jobs[0]?.labels.join() === "BACKUP PRINTER");

  await online(BAR, nowMs + 3_000);
  const back = await kotOf(o, nowMs + 3_000);
  await routePrinterJobs(nowMs + 3_000);
  check("(bb) the bar phone back: a new slip prints there, and the one that stayed is still its own", (await rowOf(back.bar?.id ?? ""))?.printerId === o.bar && (await rowOf(maybe.bar?.id ?? ""))?.printerId === o.bar);

  await Promise.all([offline(BAR, nowMs + 4_000), offline(COUNTER, nowMs + 4_000), offline(KITCHEN, nowMs + 4_000)]);
  await routePrinterJobs(nowMs + 4_000);
  check("(bb) no device online for the backup either (its primary offline, nobody left to take it over): nothing moves", (await rowOf(back.bar?.id ?? ""))?.printerId === o.bar);
  const kept = await replacePrinter(o.bar, bar({}));
  check("(bb) a save that does not mention the backup keeps it (a page from before 3B saves the whole printer without it)", kept.ok && kept.data.backupPrinterId === o.counter);
  await replacePrinter(o.bar, bar({ backupPrinterId: null }));
  await online(COUNTER, nowMs + 5_000);
  await routePrinterJobs(nowMs + 5_000);
  check("(bb) a printer whose backup was cleared (null) keeps its slips while its device is offline (they wait, visibly)", (await rowOf(back.bar?.id ?? ""))?.printerId === o.bar && !("backupPrinterId" in ((await listPrinters()).find((p) => p.id === o.bar) ?? {})));

  await Printer.updateOne({ _id: o.kitchen }, { $set: { backupPrinterId: o.counter } });
  await Promise.all([offline(KITCHEN, nowMs + 6_000), online(COUNTER, nowMs + 6_000, false)]);
  const lost = await kotOf(o, nowMs + 6_000);
  await routePrinterJobs(nowMs + 6_000);
  const kitchenMoved = await rowOf(lost.kitchen?.id ?? "");
  check("(bb) a network printer with no device left to take it over (only a page from before Phase 3 online) moves to its backup too", kitchenMoved?.printerId === o.counter && (kitchenMoved.labels ?? []).join() === "BACKUP PRINTER");

  await deletePrinter(o.counter);
  check("(bb) deleting the backup printer clears it from every printer that named it", (await listPrinters()).every((printer) => printer.backupPrinterId === undefined) && (await Printer.countDocuments({ backupPrinterId: { $exists: true } })) === 0);
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}
