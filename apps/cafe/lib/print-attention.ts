import type { FilterQuery } from "mongoose";
import { PRINT_KOT_ALARM_MS, type PrintJobLabel } from "@pos/shared/print-lifecycle";
import { printerProblemOf, type PrinterFailover } from "@pos/shared/print-failover";
import { PRINT_JOB_NO_PRINTER, routablePrinterOf, type PrinterConfig } from "@pos/shared/print-printers";
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS, type PrintAttentionRow } from "@pos/shared/print-agent-wire";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { readOnlinePrintDevices } from "@/lib/print-device";
import { listPrinters } from "@/lib/print-printers";

// Printing redesign, Phase 1 Session 1D (spec §10): the one waiting-slips panel's feed. Every device
// reads the same rows on the existing 20 s pulse (one bounded, index-backed read; no new request):
//   · Waiting for the printer: still queued 20 s after it was made (PRINT_KOT_ALARM_MS) — its printer
//     is off or not ready, or the slip is stale and needs a tap;
//   · Check the bill: needs-confirm;
//   · Couldn't print: failed.
// A slip being printed right now (leased) waits for nobody. The rows also carry the asking and the
// printing device, so both can sound the 20 s alarm without a per-device read. The read takes the
// NEWEST rows (owner, after Session 1D: a new problem always shows and rings, however long the backlog)
// and hands them over oldest first. Phase 3 (spec §9.4, §10): a row on a printer also says why that printer cannot
// print now (its device is offline, it is out of paper, ...), from two small reads made only when such a row waits.
// Read-only; never calls connectDB() (the route does); no console.*.

const ATTENTION_STATUSES: ReadonlySet<PrintJobStatus> = new Set(["queued", "needs-confirm", "failed"]);

export function printAttentionFilter(nowMs: number): FilterQuery<IPrintJob> {
  const since = new Date(nowMs - PRINT_ATTENTION_WINDOW_MS);
  // Two branches, each riding {status:1, createdAt:1, _id:1}.
  return {
    $or: [
      { status: { $in: ["needs-confirm", "failed"] }, createdAt: { $gte: since } },
      { status: "queued", createdAt: { $gte: since, $lte: new Date(nowMs - PRINT_KOT_ALARM_MS) } },
    ],
  };
}

export function printAttentionRowOf(doc: {
  _id: unknown;
  kind: PrintJobKind;
  label: string;
  status: PrintJobStatus;
  labels?: PrintJobLabel[];
  createdAt: Date;
  lastError?: string;
  originDeviceId?: string;
  targetDeviceId?: string;
  approvedAt?: Date;
  printerId?: string;
}): PrintAttentionRow | null {
  // A status this panel never shows (deploy skew, a row that moved mid-read) degrades one row, never the pulse.
  if (!ATTENTION_STATUSES.has(doc.status)) return null;
  return {
    id: String(doc._id),
    kind: doc.kind,
    label: doc.label,
    status: doc.status as PrintAttentionRow["status"],
    labels: doc.labels ?? [],
    createdAt: doc.createdAt.toISOString(),
    ...(doc.lastError ? { lastError: doc.lastError } : {}),
    ...(doc.originDeviceId ? { originDeviceId: doc.originDeviceId } : {}),
    ...(doc.targetDeviceId ? { targetDeviceId: doc.targetDeviceId } : {}),
    ...(doc.approvedAt ? { approved: true as const } : {}),
    // Session 2C: printers mode names the printer the slip waits on.
    ...(doc.printerId ? { printerId: doc.printerId } : {}),
  };
}

export async function readPrintAttention(nowMs: number): Promise<{ rows: PrintAttentionRow[]; truncated: boolean }> {
  const docs = await PrintJob.find(printAttentionFilter(nowMs))
    .select("kind label status labels createdAt lastError originDeviceId targetDeviceId printerId approvedAt")
    // The newest rows, on the same index (a merge of its scans, no in-memory sort: the 1D gate's explain()).
    .sort({ createdAt: -1, _id: -1 })
    // One row more than it shows, so a cut is a real cut: exactly 20 waiting reads "20", not "20+", and the
    // alarm keeps a cut-off slip's notice only when something really was cut off (the Phase 1 final gate, M5).
    .limit(PRINT_ATTENTION_LIMIT + 1)
    .lean();
  // The newest 20, shown oldest first.
  const rows = docs
    .slice(0, PRINT_ATTENTION_LIMIT)
    .reverse()
    .map(printAttentionRowOf)
    .filter((row): row is PrintAttentionRow => row !== null);
  return { rows: await withPrinterProblems(rows, nowMs), truncated: docs.length > PRINT_ATTENTION_LIMIT };
}

/** Phase 3 (spec §9.4, §10): each slip still waiting for its printer (queued) says that printer's problem; every other
 *  row is as it was (a failed slip or a bill to check says why it stopped in its own words: the planning review, M-4). */
export function printAttentionProblemsOf(rows: readonly PrintAttentionRow[], printers: readonly PrinterConfig[], failover: PrinterFailover): PrintAttentionRow[] {
  return rows.map((row) => {
    const printer = row.status !== "queued" || row.printerId === undefined ? null : routablePrinterOf(printers, row.printerId);
    const problem = printer === null ? null : printerProblemOf(printer, failover);
    return problem === null ? row : { ...row, problem };
  });
}

/** The printers and who is online, read only while a slip waits on a printer (queued: not for the 3 hours a failed row
 *  stays in the feed); a failed read leaves the rows as they are (the feed never fails for it). */
async function withPrinterProblems(rows: PrintAttentionRow[], nowMs: number): Promise<PrintAttentionRow[]> {
  if (!rows.some((row) => row.status === "queued" && row.printerId !== undefined && row.printerId !== PRINT_JOB_NO_PRINTER)) return rows;
  try {
    const [printers, online] = await Promise.all([listPrinters(), readOnlinePrintDevices(nowMs)]);
    return printAttentionProblemsOf(rows, printers, { online, nowMs });
  } catch {
    return rows;
  }
}
