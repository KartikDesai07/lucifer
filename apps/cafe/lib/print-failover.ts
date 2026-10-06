import { PRINT_JOB_LOG_MAX, type PrintJobLabel } from "@pos/shared/print-lifecycle";
import { PRINTER_UNREACHABLE_SKIP_MS, printerActiveWriter, printerBackupOf, printerWriterOnline, type PrinterFailover } from "@pos/shared/print-failover";
import { routablePrinterOf, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import { Printer } from "@/models/Printer";
import { PrintJob } from "@/models/PrintJob";
import { readOnlinePrintDevices } from "@/lib/print-device";
import { listPrinters } from "@/lib/print-printers";
import { publishPrintStatus } from "@/lib/realtime-publish";

// Printing redesign, Phase 3 (spec §9.3): the server half of failover. A network printer is written by its primary
// while that device is online and reaches it; otherwise by an online device that can write network printers (the
// shared rule: @pos/shared/print-failover printerActiveWriter). Job creation (the routing read), the lease, a staff
// retry, a Test print and the sweep all ask who writes a printer now through readPrinterFailover; an ack that says its
// writer could not reach the printer skips that writer for it for 5 minutes and moves the waiting slips to the next.
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
 *  it over) sends its waiting slips to its backup printer, when the backup's device is online: each queued slip that was
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
    if (backup === null || printerWriterOnline(printer, failover) || !printerWriterOnline(backup, failover)) continue;
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
 *  for it for 5 minutes, so another device that can write network printers takes it over. Only the printer's writer
 *  now is skipped: an ack from a device that no longer writes it changes nothing. One write to the printer (the skips
 *  that still run, this device's renewed); when the writer changes, the waiting slips move to the new one at once.
 *  Returns who writes it now. */
export async function recordPrinterUnreachable(input: { printerId: string; deviceId: string; nowMs: number }): Promise<string | null> {
  const printer = routablePrinterOf(await listPrinters(), input.printerId);
  if (printer === null || printer.connection.kind !== "lan") return null;
  const failover = { online: await readOnlinePrintDevices(input.nowMs), nowMs: input.nowMs };
  const before = printerActiveWriter(printer, failover);
  if (before !== input.deviceId) return before;
  const now = new Date(input.nowMs);
  const until = new Date(input.nowMs + PRINTER_UNREACHABLE_SKIP_MS);
  await Printer.updateOne({ _id: printer.id }, [
    {
      $set: {
        unreachable: {
          $concatArrays: [
            { $filter: { input: { $ifNull: ["$unreachable", []] }, cond: { $and: [{ $gt: ["$$this.until", now] }, { $ne: ["$$this.deviceId", input.deviceId] }] } } },
            [{ deviceId: input.deviceId, until }],
          ],
        },
      },
    },
  ]);
  const skips = [...(printer.unreachable ?? []).filter((skip) => skip.deviceId !== input.deviceId), { deviceId: input.deviceId, until: until.toISOString() }];
  const writer = printerActiveWriter({ ...printer, unreachable: skips }, failover);
  if (writer !== null && writer !== input.deviceId) await retargetPrinterJobs(printer.id, writer, input.nowMs);
  return writer;
}
