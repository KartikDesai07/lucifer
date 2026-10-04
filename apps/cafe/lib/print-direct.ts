import type { Types } from "mongoose";
import { REQUEST_TIMEOUT_MS } from "@pos/shared/api-client";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { PRINT_LEASE_MS, lifecycleOf, type PrintJobLease } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintJob } from "@/models/PrintJob";
import { leasedJobOf, printJobLineFilter, printerLineFilter } from "@/lib/print-lease";

// Phase 2 Session 2B (spec §7.11, plan decisions 15 and 16): direct print on the asking device. When the tab
// that drains a device's slips, and can print right now, asks for slips that print on that same device, the
// first one is made already leased to it and the answer carries the lease: the tab prints at once, with no
// lease request and no realtime message. These are the server's rules for it; print-order-jobs.ts applies
// them. Never calls connectDB(). No console.*.

/** The asking tab, for a job whose line is the asking device's own (the caller's rule). `direct`: make the job
 *  already leased to it. */
export interface PrintJobAskingTab {
  tabId: string;
  direct: boolean;
}

/** Nothing waits on this device's line ahead of a slip made now (§7.6): no job leased, and no queued job that
 *  is fresh or approved (a parked one never blocks the line). One read on the line index. */
export async function printLineIsFree(deviceId: string, nowMs: number): Promise<boolean> {
  return (await PrintJob.findOne(printJobLineFilter(deviceId, nowMs)).select("_id").lean()) === null;
}

/** Session 2C (printers mode): the same, for one printer's line (decision 15 per printer line). */
export async function printerLineIsFree(printerId: string, nowMs: number): Promise<boolean> {
  return (await PrintJob.findOne(printerLineFilter(printerId, nowMs)).select("_id").lean()) === null;
}

/** What a job found under its key is read with when the asking tab may be handed it again. */
export const PRINT_REDELIVERY_SELECT =
  "kind status label orderId createdAt targetDeviceId epoch attempts uncertainAttempts nextAttemptAt labels lease payload copyIndex printerId copies";

export interface PrintRedeliveryRow {
  _id: Types.ObjectId;
  kind: PrintJobKind;
  status: PrintJobStatus;
  label: string;
  orderId?: string;
  createdAt: Date;
  targetDeviceId?: string;
  epoch?: number;
  attempts?: number;
  uncertainAttempts?: number;
  nextAttemptAt?: Date;
  labels?: string[];
  lease?: PrintJobLease;
  payload?: string;
  copyIndex?: number;
  printerId?: string;
  copies?: number;
}

/** A job its key already names that is still leased to the asking device's very tab, its lease still running:
 *  the answer that carried it was lost (spec §7.11), so the same lease is handed over again. The agent ignores a
 *  job it already holds (its id and epoch), so a delivery that did arrive still prints once. Anything else:
 *  null, and the caller answers as in Phase 1 (a tab reloaded since has a new id; its lease expires).
 *  The 2B review gate (I-A): only within one request timeout of the lease's start. The agent may hold a job 60 s
 *  (PRINT_DIRECT_HOLD_MS) while its drain lock is elsewhere; a later hand-back could print after the lease ran out,
 *  beside another window's REPRINT. An older lease is left to expire into one REPRINT (a bill: the cashier). */
export function redeliveryOf(row: PrintRedeliveryRow, who: { deviceId: string; tabId: string }, nowMs: number): LeasedPrintJob | null {
  const job = lifecycleOf(row);
  const lease = job.lease;
  if (job.status !== "leased" || lease === undefined || row.payload === undefined || row.targetDeviceId !== who.deviceId) return null;
  if (lease.deviceId !== who.deviceId || lease.tabId !== who.tabId || lease.epoch !== job.epoch || lease.expiresAt.getTime() <= nowMs) return null;
  if (lease.expiresAt.getTime() - nowMs < PRINT_LEASE_MS - REQUEST_TIMEOUT_MS) return null;
  let payload: PrintJobPayload;
  try {
    const parsed = printJobPayloadSchema.safeParse(JSON.parse(row.payload) as unknown);
    if (!parsed.success) return null;
    payload = parsed.data;
  } catch {
    return null;
  }
  return leasedJobOf(row, { epoch: job.epoch, attempts: job.attempts, labels: job.labels }, payload);
}

/** Decision 16, no realtime message to yourself: a new queued job is announced to the device that prints it
 *  (its "queued" print-status, and the host's print-job nudge) unless the same request made a job leased to
 *  the asking tab on that line. That tab is printing already, and its ack's `more` brings it to the rest. A
 *  job made leased is never announced, and a job found under its key is not new. */
export function announcesQueuedJob(job: { created: boolean; status: PrintJobStatus }, directOnLine: boolean): boolean {
  return job.created && job.status === "queued" && !directOnLine;
}
