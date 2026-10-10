import type { FilterQuery } from "mongoose";
import { PRINTER_HEALTH_REFRESH_MS, printerActiveWriter, type PrinterFailover, type PrinterHealth, type PrinterHealthReport } from "@pos/shared/print-failover";
import { routablePrinterOf, type PrinterConfig } from "@pos/shared/print-printers";
import { Printer, type IPrinter } from "@/models/Printer";

// Printing redesign, Phase 3 (spec §10): printer health rides the heartbeat. A writer's wake carries the state of each
// printer it writes (its link, and paper, cover and error where DLE EOT can say); the server keeps it on the printer
// when it changed, or to refresh a steady one every 5 minutes, and only from the device that writes that printer now.
// Every device reads it with the printers, and the waiting-slips feed names a printer's problem beside its slips
// (print-attention.ts). No request of its own. A report is compared with the kept health in memory first (the
// printers the wake already read), so a wake that changes nothing costs no Atlas operation, even at the 3 s cadence of
// a socket that is down (the planning review, M-2); a change is one small filtered write per printer, all at once.
// Never calls connectDB(). No console.*.

/** Lets a report through only when it says something new (another writer, link, paper, cover or error), or the kept one
 *  is due a refresh. An absent paper, cover or error matches a kept one that has none ($ne null). */
export function printerHealthChangedFilter(printerId: string, deviceId: string, report: PrinterHealthReport, nowMs: number): FilterQuery<IPrinter> {
  return {
    _id: printerId,
    $or: [
      { "health.deviceId": { $ne: deviceId } },
      { "health.link": { $ne: report.link } },
      { "health.paper": { $ne: report.paper ?? null } },
      { "health.cover": { $ne: report.cover ?? null } },
      { "health.error": { $ne: report.error ?? null } },
      { "health.at": { $lt: new Date(nowMs - PRINTER_HEALTH_REFRESH_MS) } },
    ],
  };
}

/** Whether a report says something new against the kept health (another writer, link, paper, cover or error), or the
 *  kept one is due its refresh: the same test as printerHealthChangedFilter, made in memory before any write. */
export function printerHealthNeedsWrite(kept: PrinterHealth | undefined, deviceId: string, report: PrinterHealthReport, nowMs: number): boolean {
  if (kept === undefined) return true;
  return (
    kept.deviceId !== deviceId ||
    kept.link !== report.link ||
    kept.paper !== report.paper ||
    kept.cover !== report.cover ||
    (kept.error === true) !== (report.error === true) ||
    Date.parse(kept.at) < nowMs - PRINTER_HEALTH_REFRESH_MS
  );
}

/** Keeps what a writer reported for each printer it writes now; a report for any other printer (one it does not write,
 *  one taken over by another device, one deleted or switched off) is dropped, and one that changes nothing costs nothing.
 *  Returns how many printers were written. */
export async function recordPrinterHealth(input: {
  deviceId: string;
  reports: readonly PrinterHealthReport[];
  printers: readonly PrinterConfig[];
  failover: PrinterFailover | null;
  nowMs: number;
}): Promise<number> {
  const writes = input.reports.flatMap((report) => {
    const printer = routablePrinterOf(input.printers, report.printerId);
    if (printer === null || printerActiveWriter(printer, input.failover) !== input.deviceId) return [];
    if (!printerHealthNeedsWrite(printer.health, input.deviceId, report, input.nowMs)) return [];
    const health = {
      link: report.link,
      ...(report.paper !== undefined ? { paper: report.paper } : {}),
      ...(report.cover !== undefined ? { cover: report.cover } : {}),
      ...(report.error === true ? { error: true } : {}),
      deviceId: input.deviceId,
      at: new Date(input.nowMs),
    };
    return [Printer.updateOne(printerHealthChangedFilter(printer.id, input.deviceId, report, input.nowMs), { $set: { health } })];
  });
  const results = await Promise.all(writes);
  return results.reduce((sum, res) => sum + res.modifiedCount, 0);
}
