import { PRINT_JOB_LOG_MAX, type PrintJobLabel } from "@pos/shared/print-lifecycle";
import {
  PRINTER_UNREACHABLE_HOLD_MS,
  PRINTER_UNREACHABLE_SKIP_MS,
  printerActiveWriter,
  printerBackupOf,
  printerSkipEndsFor,
  printerSkippedWriters,
  printerWriterCanPrint,
  type PrinterFailover,
  type PrinterHealthReport,
} from "@pos/shared/print-failover";
import { printerWriterDeviceId, routablePrinterOf, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import { Printer } from "@/models/Printer";
import { PrintJob } from "@/models/PrintJob";
import { readOnlinePrintDevices } from "@/lib/print-device";
import { listPrinters } from "@/lib/print-printers";
import { publishPrintStatus } from "@/lib/realtime-publish";

// Printing redesign, Phase 3 (spec §9.3): the server half of failover. A network printer is written by its primary
// while that device is online and reaches it; otherwise by an online device that can write network printers (the
// shared rule: @pos/shared/print-failover printerActiveWriter). Job creation (the routing read), the lease, a staff
// retry, a Test print and the sweep all ask who writes a printer now through readPrinterFailover; an ack that says its
// writer could not reach the printer skips that writer for it (at least 5 minutes, then until its own lease names the
// printer again) and moves the waiting slips to the next.
// Spec §9.4: the sweep moves the waiting slips of a printer whose device is offline to its backup printer.
// No new request: who is online comes from the heartbeat that already rides the wake. Never calls connectDB(). No
// console.*.

const WAITING = ["queued", "needs-confirm", "failed"];
const BACKUP_LABEL: PrintJobLabel = "BACKUP PRINTER";

/** Whether who-is-online matters to these printers: a routable network printer (§9.3) or, with `backups`, a routable
 *  printer with a backup (§9.4, the sweep). */
function needsFailover(printers: readonly PrinterConfig[], backups: boolean): boolean {
  return routablePrinters(printers).some((printer) => printer.connection.kind === "lan" || (backups && printer.backupPrinterId !== undefined));
}

/** Who is online now (one bounded read), or null with no read when no printer needs it: the setup's writers, as in
 *  Phase 2. */
export async function readPrinterFailover(printers: readonly PrinterConfig[], nowMs: number, backups = false): Promise<PrinterFailover | null> {
  if (!needsFailover(printers, backups)) return null;
  return { online: await readOnlinePrintDevices(nowMs), nowMs };
}

/** One printer's waiting slips follow the device that writes it now (one write; a leased slip is left to its lease).
 *  When any moved, that device is told of the line's head at once (one realtime request), instead of at its next pulse. */
export async function retargetPrinterJobs(printerId: string, writer: string, nowMs: number): Promise<number> {
  const at = new Date(nowMs);
  const moved = await PrintJob.updateMany(
    { printerId, status: { $in: WAITING }, targetDeviceId: { $ne: writer } },
    { $set: { targetDeviceId: writer }, $push: { log: { $each: [{ at, event: "retargeted", deviceId: writer }], $slice: -PRINT_JOB_LOG_MAX } } },
  );
  const count = moved.modifiedCount ?? 0;
  if (count > 0) await announcePrinterHead(printerId, writer);
  return count;
}

/** Tells a printer's writer of the oldest slip queued on its line (one read, one realtime request), so it leases now. */
async function announcePrinterHead(printerId: string, writer: string): Promise<void> {
  if (writer === "") return;
  const head = await PrintJob.findOne({ printerId, status: "queued" }).sort({ createdAt: 1, _id: 1 }).select("_id").lean();
  if (head !== null) publishPrintStatus({ id: String(head._id), status: "queued", target: writer, printerId });
}

/** §9.4: a printer whose device is offline (no heartbeat for 90 s; a network printer with no online device left to take
 *  it over), or, since the 3A review gate (m-D), a network printer that every writer could not reach (printerWriterCanPrint),
 *  sends its waiting slips to its backup printer, when the backup's device can print it: each queued slip that was
 *  never tried, or only refused before any byte (no uncertain attempt), moves with BACKUP PRINTER first among its
 *  labels and a 'retargeted' log, and the backup's writer is told of its head. A slip that may have printed, a bill
 *  waiting for the cashier and a slip being printed stay; so does every slip of a printer with no backup (every device's
 *  panel says its device is offline, print-attention.ts). The device back, the slips not moved print there, in order.
 *  One write per such printer (a pipeline update), none when its device is online. */
export async function moveToBackupPrinters(printers: readonly PrinterConfig[], failover: PrinterFailover, nowMs: number): Promise<number> {
  const at = new Date(nowMs);
  let moved = 0;
  for (const printer of printers) {
    const backup = printerBackupOf(printers, printer);
    if (backup === null || printerWriterCanPrint(printer, failover) || !printerWriterCanPrint(backup, failover)) continue;
    const writer = printerActiveWriter(backup, failover) ?? "";
    const res = await PrintJob.updateMany({ printerId: printer.id, status: "queued", uncertainAttempts: { $in: [0, null] } }, [
      {
        $set: {
          printerId: backup.id,
          targetDeviceId: writer,
          labels: { $concatArrays: [[BACKUP_LABEL], { $filter: { input: { $ifNull: ["$labels", []] }, cond: { $ne: ["$$this", BACKUP_LABEL] } } }] },
          log: {
            $slice: [
              { $concatArrays: [{ $ifNull: ["$log", []] }, [{ at, event: "retargeted", deviceId: writer, detail: `backup printer: ${printer.name} -> ${backup.name}` }]] },
              -PRINT_JOB_LOG_MAX,
            ],
          },
        },
      },
    ]);
    const count = res.modifiedCount ?? 0;
    if (count > 0) await announcePrinterHead(backup.id, writer);
    moved += count;
  }
  return moved;
}

/** §9.3: a writer that could not reach a network printer (its ack: failed, sent "no", reason "unreachable") is skipped
 *  for it (at least 5 minutes, then until its own lease names the printer again: endPrinterSkipOf), so another device
 *  that can write network printers takes it over. Only the printer's writer now is skipped: an ack from a device that
 *  no longer writes it changes nothing. Session 3C (the 3B review's m-2): or a `candidate`, a device that may take the
 *  printer over and whose beat says it cannot reach it, skipped ahead of time. One write to the printer (the skips that
 *  still hold, this device's renewed); when the writer changes, the waiting slips move to the new one at once. Returns
 *  who writes it now. */
export async function recordPrinterUnreachable(input: { printerId: string; deviceId: string; nowMs: number; candidate?: boolean }): Promise<string | null> {
  const printer = routablePrinterOf(await listPrinters(), input.printerId);
  if (printer === null || printer.connection.kind !== "lan") return null;
  const failover = { online: await readOnlinePrintDevices(input.nowMs), nowMs: input.nowMs };
  const before = printerActiveWriter(printer, failover);
  if (before !== input.deviceId && input.candidate !== true) return before;
  // A skip holds while its `until` (the end of its first 5 minutes) is later than this (printerSkipHolds).
  const heldFrom = new Date(input.nowMs + PRINTER_UNREACHABLE_SKIP_MS - PRINTER_UNREACHABLE_HOLD_MS);
  const until = new Date(input.nowMs + PRINTER_UNREACHABLE_SKIP_MS);
  await Printer.updateOne({ _id: printer.id }, [
    {
      $set: {
        unreachable: {
          $concatArrays: [
            { $filter: { input: { $ifNull: ["$unreachable", []] }, cond: { $and: [{ $gt: ["$$this.until", heldFrom] }, { $ne: ["$$this.deviceId", input.deviceId] }] } } },
            [{ deviceId: input.deviceId, until }],
          ],
        },
      },
    },
  ]);
  const skips = [...(printer.unreachable ?? []).filter((skip) => skip.deviceId !== input.deviceId), { deviceId: input.deviceId, until: until.toISOString() }];
  const writer = printerActiveWriter({ ...printer, unreachable: skips }, failover);
  if (writer !== null && writer !== before) await retargetPrinterJobs(printer.id, writer, input.nowMs);
  return writer;
}

/** Session 3B (the 3A review gate, I-A and M-8 d): a beat's settled link for a network printer starts or ends this
 *  device's skip for it. "disconnected" from its writer now skips it, exactly as an "unreachable" ack does: a page never
 *  leases a printer it knows is down (Phase 1's rule), so without this a writer that learned it cannot reach a printer
 *  without a print (its app's probe), or a device that took one over but cannot reach it, would hold its slips, never
 *  leased and never acked, while another device could print them. "connected" from a device skipped for it ends its skip
 *  once the first 5 minutes are up, exactly as its lease naming the printer does, so the primary gets its printer back
 *  at its next beat. Only a network printer; a skip already held, or one not yet past its 5 minutes, writes nothing.
 *  Session 3C (the 3B review's m-2): "disconnected" from a device that may take the printer over (its beat says
 *  `lanFailover`; the setup names another device) skips it too, ahead of time, so a failover never picks a candidate that
 *  cannot print it and waits for that device's first beat as the writer. Returns how many skips it started or ended (one
 *  write each). */
export async function skipUnreachableFromBeat(input: {
  deviceId: string;
  lanFailover?: boolean;
  reports: readonly PrinterHealthReport[];
  printers: readonly PrinterConfig[];
  failover: PrinterFailover;
  nowMs: number;
}): Promise<number> {
  let writes = 0;
  for (const report of input.reports) {
    const printer = routablePrinterOf(input.printers, report.printerId);
    if (printer === null || printer.connection.kind !== "lan") continue;
    if (report.link === "connected") {
      if (!printerSkipEndsFor(printer, input.deviceId, input.nowMs)) continue;
      await endPrinterSkipOf(printer, input.deviceId, input.nowMs);
      writes += 1;
      continue;
    }
    if (report.link !== "disconnected") continue;
    const candidate = input.lanFailover === true && printerWriterDeviceId(printer) !== input.deviceId;
    if (!candidate && printerActiveWriter(printer, input.failover) !== input.deviceId) continue;
    if (printerSkippedWriters(printer, input.nowMs).includes(input.deviceId)) continue;
    await recordPrinterUnreachable({ printerId: printer.id, deviceId: input.deviceId, nowMs: input.nowMs, candidate });
    writes += 1;
  }
  return writes;
}

/** §9.3 (Session 3A's final review, I-1): a device's lease that names a network printer it is skipped for ends that skip
 *  once its first 5 minutes are up (printerSkipEndsFor): a page names only a printer it can print to now, so its app
 *  reaches the printer again. Without this a skip would run out on time alone and send the printer back to a writer
 *  that still cannot reach it, while the device that can sits idle. One write, only then (a page from before Phase 3 is
 *  never skipped, so it costs nothing); a failed write keeps the skip until the device's next lease. Returns the
 *  printer as that lease sees it. */
export async function endPrinterSkipOf(printer: PrinterConfig, deviceId: string, nowMs: number): Promise<PrinterConfig> {
  if (!printerSkipEndsFor(printer, deviceId, nowMs)) return printer;
  const ended = await Printer.updateOne({ _id: printer.id }, { $pull: { unreachable: { deviceId, until: { $lte: new Date(nowMs) } } } })
    .then(() => true)
    .catch(() => false);
  return ended ? { ...printer, unreachable: (printer.unreachable ?? []).filter((skip) => skip.deviceId !== deviceId || Date.parse(skip.until) > nowMs) } : printer;
}
