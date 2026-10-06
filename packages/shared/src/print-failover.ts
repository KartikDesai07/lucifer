// ─────────────────────────────────────────────────────────────────────────────
// Printing redesign, Phase 3 (docs/superpowers/specs/2026-10-02-printing-
// reliability-design.md §9.3, §9.4, §10): failover, the backup printer and
// printer health, the shared rules. The server decides which device writes a
// printer now (apps/cafe/lib/print-failover.ts: the lease, job creation, the
// sweep), moves a printer's waiting slips to its backup (the sweep), keeps the
// health its writer reports (the wake), and every device shows a printer's
// problem beside the slips that wait for it (the pulse's waiting-slips feed).
// Pure and client-safe: no Node, DB or zod imports.
// ─────────────────────────────────────────────────────────────────────────────

import { PRINT_JOB_QUEUED_RETENTION_MS } from "./print-job";
import { printerWriterDeviceId, routablePrinterOf, type PrinterConfig } from "./print-printers";

/** §9.3: a writer that could not reach a network printer is skipped for it at least this long, so another writer gets
 *  its next lease (and the skipped one tries again after it, the same 5 minutes Phase 1's refusal rules allow a dead
 *  printer). */
export const PRINTER_UNREACHABLE_SKIP_MS = 5 * 60 * 1000;
/** §9.3 (Session 3A's final review, I-1): after its first 5 minutes a skip holds until the skipped device's own lease
 *  names the printer again, and at most this long after it began. A page never leases a printer it cannot reach
 *  (holds.open(ready())), so a skip that ran out on time alone would send the printer back to a writer that still
 *  cannot reach it and never says so again, while another device that can sits idle. Beyond 3 hours a waiting slip
 *  is pruned anyway (PRINT_JOB_QUEUED_RETENTION_MS). */
export const PRINTER_UNREACHABLE_HOLD_MS = PRINT_JOB_QUEUED_RETENTION_MS;

/** §9.3: one writer that could not reach a network printer, and when (ISO, server time) its first 5 minutes end: from
 *  then on its own lease that names the printer ends the skip (printerSkipEndsFor), which holds at most
 *  PRINTER_UNREACHABLE_HOLD_MS from when it began. */
export interface PrinterUnreachable {
  deviceId: string;
  until: string;
}

export const PRINTER_LINK_STATES = ["connected", "connecting", "disconnected"] as const;
export type PrinterLinkState = (typeof PRINTER_LINK_STATES)[number];
export const PRINTER_PAPER_STATES = ["ok", "low", "out"] as const;
export type PrinterPaperState = (typeof PRINTER_PAPER_STATES)[number];
export const PRINTER_COVER_STATES = ["closed", "open"] as const;
export type PrinterCoverState = (typeof PRINTER_COVER_STATES)[number];

/** §10: one printer's health as its writer reports it on the wake (the heartbeat: no request of its own). `paper`,
 *  `cover` and `error` come from DLE EOT where the printer answers it (the POS app from Session 3C, the Windows app's
 *  network printers from Session 3E); they are absent where it cannot (BLE, the Windows spooler, an older app). */
export interface PrinterHealthReport {
  printerId: string;
  link: PrinterLinkState;
  paper?: PrinterPaperState;
  cover?: PrinterCoverState;
  error?: true;
}

/** §10: what the server keeps of a printer's last report: the report, the device that sent it, and when. */
export interface PrinterHealth {
  link: PrinterLinkState;
  paper?: PrinterPaperState;
  cover?: PrinterCoverState;
  error?: true;
  deviceId: string;
  at: string;
}

/** §10, §17: a printer's health is written when it changes, and a steady one again at most this often, so it stays fresh
 *  while its writer keeps reporting (a few writes a printer an hour). A report older than PRINTER_HEALTH_STALE_MS, or
 *  from a device that no longer writes the printer, says nothing. */
export const PRINTER_HEALTH_REFRESH_MS = 5 * 60 * 1000;
export const PRINTER_HEALTH_STALE_MS = 2 * PRINTER_HEALTH_REFRESH_MS;

/** §9.3: the devices online now (a heartbeat within PRINT_DEVICE_ONLINE_MS) and whether each can write any network
 *  printer the setup names (PrintDeviceCapabilities.lanFailover: the POS app on bridge v2, the Windows app from 1.12.0),
 *  at server time `nowMs`. */
export interface PrinterFailover {
  online: ReadonlyArray<{ deviceId: string; lanFailover: boolean }>;
  nowMs: number;
}

type WriterOf = Pick<PrinterConfig, "connection" | "primaryDeviceId" | "unreachable">;

/** Whether a skip still holds at `nowMs`: within PRINTER_UNREACHABLE_HOLD_MS of when it began (its `until` minus its
 *  first 5 minutes), unless the skipped device's lease ended it before. */
export function printerSkipHolds(skip: PrinterUnreachable, nowMs: number): boolean {
  return Date.parse(skip.until) - PRINTER_UNREACHABLE_SKIP_MS + PRINTER_UNREACHABLE_HOLD_MS > nowMs;
}

/** The writers a network printer skips now (§9.3): those whose skip still holds. */
export function printerSkippedWriters(printer: Pick<PrinterConfig, "unreachable">, nowMs: number): string[] {
  return (printer.unreachable ?? []).filter((skip) => printerSkipHolds(skip, nowMs)).map((skip) => skip.deviceId);
}

/** §9.3 (Session 3A's final review, I-1): whether this device's lease that names the printer ends its skip now: it holds
 *  one, and the first 5 minutes are up (so a writer that cannot reach the printer pays at most a lease and an ack per 5
 *  minutes). A page names only a printer it can print to now, so naming it means its app reaches the printer again. */
export function printerSkipEndsFor(printer: Pick<PrinterConfig, "unreachable">, deviceId: string, nowMs: number): boolean {
  return (printer.unreachable ?? []).some((skip) => skip.deviceId === deviceId && Date.parse(skip.until) <= nowMs && printerSkipHolds(skip, nowMs));
}

/** The device that writes this printer NOW (§9.3). A device printer: its own device, always. A network printer: its
 *  primary while that device is online and has reached it; otherwise the first online device that can write network
 *  printers and is not skipped for this one (printerSkippedWriters) (by device id, so every server instance and
 *  every request picks the same one); with none, its primary still (its slips wait for it, visibly). Without a
 *  failover read (null), the setup's writer, exactly as in Phase 2. */
export function printerActiveWriter(printer: WriterOf, failover: PrinterFailover | null): string | null {
  const configured = printerWriterDeviceId(printer);
  if (failover === null || printer.connection.kind !== "lan") return configured;
  const skipped = printerSkippedWriters(printer, failover.nowMs);
  const online = (deviceId: string): boolean => failover.online.some((device) => device.deviceId === deviceId);
  if (configured !== null && online(configured) && !skipped.includes(configured)) return configured;
  const others = failover.online
    .filter((device) => device.lanFailover && device.deviceId !== configured && !skipped.includes(device.deviceId))
    .map((device) => device.deviceId)
    .sort();
  return others[0] ?? configured;
}

/** §9.4: whether the device that writes this printer now is online (a heartbeat within 90 s). */
export function printerWriterOnline(printer: WriterOf, failover: PrinterFailover): boolean {
  const writer = printerActiveWriter(printer, failover);
  return writer !== null && failover.online.some((device) => device.deviceId === writer);
}

export const PRINTER_BACKUP_SELF_MESSAGE = "A printer cannot be its own backup. Choose another printer.";
export const PRINTER_BACKUP_UNKNOWN_MESSAGE = "The backup printer no longer exists. Reload and choose again.";

/** §9.4: this printer's backup, while routing may still send it slips (enabled, with a writer, taking a slip); null
 *  with none, with itself, or with one deleted or switched off. */
export function printerBackupOf(printers: readonly PrinterConfig[], printer: Pick<PrinterConfig, "id" | "backupPrinterId">): PrinterConfig | null {
  if (printer.backupPrinterId === undefined || printer.backupPrinterId === printer.id) return null;
  return routablePrinterOf(printers, printer.backupPrinterId);
}

/** §9.4, §10: why a printer cannot print now, worst first: its device is offline; it is out of paper; its cover is open;
 *  it reports an error; it is not connected; and, a warning only, it is low on paper. */
export const PRINTER_PROBLEMS = ["device-offline", "paper-out", "cover-open", "error", "offline", "paper-low"] as const;
export type PrinterProblem = (typeof PRINTER_PROBLEMS)[number];

/** The printer's problem now, or null when none is known: the device that writes it now is offline (§9.4: the
 *  "device is offline" alert); else the worst thing that device last reported, while that report is fresh. */
export function printerProblemOf(printer: WriterOf & Pick<PrinterConfig, "health">, failover: PrinterFailover): PrinterProblem | null {
  const writer = printerActiveWriter(printer, failover);
  if (writer === null) return null;
  if (!failover.online.some((device) => device.deviceId === writer)) return "device-offline";
  const health = printer.health;
  if (health === undefined || health.deviceId !== writer || failover.nowMs - Date.parse(health.at) > PRINTER_HEALTH_STALE_MS) return null;
  if (health.paper === "out") return "paper-out";
  if (health.cover === "open") return "cover-open";
  if (health.error === true) return "error";
  if (health.link === "disconnected") return "offline";
  if (health.paper === "low") return "paper-low";
  return null;
}

/** The words every device shows for a printer's problem, beside the slips that wait for it (no jargon). */
export function printerProblemText(name: string, problem: PrinterProblem): string {
  switch (problem) {
    case "device-offline":
      return `The device that prints ${name} is offline.`;
    case "paper-out":
      return `${name} is out of paper.`;
    case "cover-open":
      return `${name} has its cover open.`;
    case "error":
      return `${name} reports an error. Check it, then switch it off and on.`;
    case "offline":
      return `${name} is not connected.`;
    case "paper-low":
      return `${name} is low on paper.`;
  }
}
