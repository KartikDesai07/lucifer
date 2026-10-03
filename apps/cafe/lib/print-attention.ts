import type { FilterQuery } from "mongoose";
import { PRINT_KOT_ALARM_MS, type PrintJobLabel } from "@pos/shared/print-lifecycle";
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS, type PrintAttentionRow } from "@pos/shared/print-agent-wire";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";

// Printing redesign, Phase 1 Session 1D (spec §10): the one waiting-slips panel's feed. Every device
// reads the same rows on the existing 20 s pulse (one bounded, index-backed read; no new request):
//   · Waiting for the printer: still queued 20 s after it was made (PRINT_KOT_ALARM_MS) — its printer
//     is off or not ready, or the slip is stale and needs a tap;
//   · Check the bill: needs-confirm;
//   · Couldn't print: failed.
// A slip being printed right now (leased) waits for nobody. The rows also carry the asking and the
// printing device, so both can sound the 20 s alarm without a per-device read. The read takes the
// NEWEST rows (owner, after Session 1D: a new problem always shows and rings, however long the backlog)
// and hands them over oldest first. Read-only; never calls connectDB() (the route does); no console.*.

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
  };
}

export async function readPrintAttention(nowMs: number): Promise<{ rows: PrintAttentionRow[]; truncated: boolean }> {
  const docs = await PrintJob.find(printAttentionFilter(nowMs))
    .select("kind label status labels createdAt lastError originDeviceId targetDeviceId approvedAt")
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
  return { rows, truncated: docs.length > PRINT_ATTENTION_LIMIT };
}
