import { isDuplicateKeyError } from "@pos/shared/api";
import { printJobPayloadWithinCap, type PrintJobStatus } from "@pos/shared/print-job";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { directLeaseOf, printJobCreatedLog, printJobFailedAtCreation, printJobInitialLabels, printJobLifecycleInit } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintJob } from "@/models/PrintJob";
import { PRINT_REDELIVERY_SELECT, redeliveryOf, type PrintJobAskingTab, type PrintRedeliveryRow } from "@/lib/print-direct";
import { leasedJobOf } from "@/lib/print-lease";
import { printJobKeyOf, printJobOrderIdOf } from "@/lib/print-queue";
import type { PrintJobRequest } from "@/lib/print-routing";

// Printing redesign: the ONE place a server-made print job is written (spec §7.4). Phase 1 Session 1B wrote it
// for simple mode, Session 2B (spec §7.11) let it be made already leased to the asking tab, and Session 2C
// (printers mode, spec §8) gives it a printer line and copies, or makes it failed at once when no printer takes
// its slip. Moved out of print-order-jobs.ts at the 2B review gate to keep that file near its ~300-line budget.
// Never calls connectDB(). No console.*.

const UNNAMED_STAFF = "Staff";

/** One job made, or the one its key already names (a racing replay, an old tab's enqueue, a repair). */
export interface InsertedPrintJob {
  ref: PrintJobRef;
  created: boolean;
  status: PrintJobStatus;
}

/** Inserts one job. null: its payload fails the schema or the 64 KB cap. A DB error throws.
 *  Session 2B (spec §7.11): `tab` is the asking tab, passed only when this job's line is the asking device's
 *  own. With `direct` the job is made already leased to it, in this one write; and a job its key already
 *  names that is still leased to that very tab is handed back with its lease (an answer lost on the way).
 *  Session 2C: `line` is its printer and copies (printers mode); `failed` makes it failed at once (no printer
 *  takes the slip), never leased. */
export async function insertPrintJob(input: {
  request: PrintJobRequest;
  /** The device whose line holds it (simple mode: the host or the asking device; printers mode: the printer's
   *  writer). "" only for a job failed at creation that no device asked for. */
  targetDeviceId: string;
  originDeviceId?: string;
  queuedBy: string;
  /** Default printJobKeyOf(payload); a client-started repeat passes its `reprint:<key>`, a routed job its
   *  routedJobKey (Session 2C). */
  jobKey?: string;
  tab?: PrintJobAskingTab;
  line?: { printerId: string; copies: number };
  failed?: string;
  nowMs: number;
}): Promise<InsertedPrintJob | null> {
  const parsed = printJobPayloadSchema.safeParse(input.request.payload);
  if (!parsed.success) return null;
  const payload: PrintJobPayload = parsed.data;
  const json = JSON.stringify(payload);
  if (!printJobPayloadWithinCap(json)) return null;
  const jobKey = input.jobKey ?? printJobKeyOf(payload);
  const orderId = printJobOrderIdOf(payload);
  const labels = printJobInitialLabels(payload);
  const failed = input.failed === undefined ? null : printJobFailedAtCreation({ labels, error: input.failed, originDeviceId: input.originDeviceId, nowMs: input.nowMs });
  const who = input.tab === undefined || failed !== null ? null : { deviceId: input.targetDeviceId, tabId: input.tab.tabId };
  const direct = who !== null && input.tab?.direct === true ? directLeaseOf({ labels, who, originDeviceId: input.originDeviceId, nowMs: input.nowMs }) : null;
  try {
    const created = await PrintJob.create({
      kind: payload.kind,
      payload: json,
      label: input.request.label,
      // A Mongoose required string refuses "" (house rule: staff names fall back to "Staff").
      queuedBy: input.queuedBy.trim() || UNNAMED_STAFF,
      ...(orderId !== undefined ? { orderId } : {}),
      ...(jobKey !== undefined ? { jobKey } : {}),
      ...(input.targetDeviceId !== "" ? { targetDeviceId: input.targetDeviceId } : {}),
      ...(input.originDeviceId !== undefined ? { originDeviceId: input.originDeviceId } : {}),
      copyIndex: 0,
      // Omit-empty: a simple-mode job carries neither; one copy is no copies field.
      ...(input.line !== undefined ? { printerId: input.line.printerId, ...(input.line.copies > 1 ? { copies: input.line.copies } : {}) } : {}),
      // Made failed (no printer takes it), leased to the asking tab (its log says "direct"), or queued as in Phase 1.
      ...(failed ?? direct ?? { ...printJobLifecycleInit(input.nowMs, labels), log: [printJobCreatedLog(input.nowMs, input.originDeviceId)] }),
    });
    const ref: PrintJobRef = {
      id: String(created._id),
      kind: payload.kind,
      targetDeviceId: input.targetDeviceId,
      label: input.request.label,
      status: failed !== null ? "failed" : direct === null ? "queued" : "leased",
      ...(direct !== null ? { leased: leasedJobOf(created, direct, payload) } : {}),
      ...(input.line !== undefined ? { printerId: input.line.printerId } : {}),
    };
    return { ref, created: true, status: ref.status };
  } catch (error) {
    if (!isDuplicateKeyError(error) || jobKey === undefined) throw error;
    const existing = await PrintJob.findOne({ jobKey })
      .select(who === null ? "kind status label targetDeviceId printerId" : PRINT_REDELIVERY_SELECT)
      .lean<PrintRedeliveryRow>();
    // Pruned in the instant since the collision: report nothing rather than invent a job.
    if (existing === null) return null;
    const again = who === null ? null : redeliveryOf(existing, who, input.nowMs);
    const ref: PrintJobRef = {
      id: String(existing._id),
      kind: existing.kind,
      targetDeviceId: existing.targetDeviceId ?? input.targetDeviceId,
      label: existing.label,
      status: existing.status,
      ...(again !== null ? { leased: again } : {}),
      ...(existing.printerId !== undefined ? { printerId: existing.printerId } : {}),
    };
    return { ref, created: false, status: existing.status };
  }
}
