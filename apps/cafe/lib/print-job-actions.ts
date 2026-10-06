import type { PrintActionData } from "@pos/shared/print-agent-wire";
import { lifecycleOf, planConfirm, planRetry, type PrintJobDecision, type PrintJobLifecycle, type PrintJobPlan } from "@pos/shared/print-lifecycle";
import { printerWriterDeviceId, routablePrinterOf } from "@pos/shared/print-printers";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { listPrinters } from "./print-printers";

// Printing redesign, Phase 1 (spec §7.2, §7.3): the staff decisions. "Print again?" on a bill that
// may already be on paper (confirm), and Print again on a failed job or Print now on a stale one
// (retry). Allowed from any device that can see the job. Every write is one CAS through
// print-lease.ts. Never calls connectDB(). No console.*.

const ACTION_MAX_STEPS = 2;

async function act(id: string, decide: (job: PrintJobLifecycle) => PrintJobPlan): Promise<PrintActionData> {
  for (let step = 0; step < ACTION_MAX_STEPS; step++) {
    const row = await PrintJob.findById(id)
      .select(`${PRINT_LIFECYCLE_SELECT} targetDeviceId printerId`)
      .lean<PrintLifecycleRow & { targetDeviceId?: string; printerId?: string }>();
    if (row === null) return { applied: false, status: null, reason: "not-found" };
    const job = lifecycleOf(row);
    const plan = decide(job);
    if (!plan.ok) return { applied: false, status: job.status, reason: plan.reason };
    // Session 2C (the 2B gate's ruling R2): back in line only on a printer that still takes slips; a gone one
    // (deleted, switched off, no writer, or none at all) is never guessed onto another printer. A printer that still
    // takes slips gets the job on its current writer's line, in the same write (the 2C gate's review, I-3).
    let patch = plan.patch;
    let target = row.targetDeviceId;
    if (plan.patch.status === "queued" && row.printerId !== undefined) {
      const printer = routablePrinterOf(await listPrinters(), row.printerId);
      if (printer === null) return { applied: false, status: job.status, reason: "printer-gone" };
      target = printerWriterDeviceId(printer) ?? target;
      patch = { ...plan.patch, set: { ...plan.patch.set, ...(target !== undefined ? { targetDeviceId: target } : {}) } };
    }
    if (await applyPrintJobPlan(row._id, job, patch)) {
      // Back in the queue: nudge the printing device, so it leases now rather than on its next poll.
      // Fire-and-forget; the poll still finds it if the nudge is lost.
      if (plan.patch.status === "queued") publishCafeEvent("print-job");
      // Session 1D (D7): also aimed at the device whose line holds it. With no host, agents never lease on
      // the broadcast above (1B M-c), so without this a tap would wait for that device's next pulse.
      if (plan.patch.status === "queued") publishPrintStatus({ id, status: "queued", ...(target ? { target } : {}), ...(row.printerId !== undefined ? { printerId: row.printerId } : {}) });
      return { applied: true, status: plan.patch.status };
    }
  }
  return { applied: false, status: null, reason: "raced" };
}

export function confirmPrintJob(input: { id: string; decision: PrintJobDecision; staff: string; nowMs: number }): Promise<PrintActionData> {
  return act(input.id, (job) => planConfirm(job, input.decision, input.staff, input.nowMs));
}

export function retryPrintJob(input: { id: string; nowMs: number }): Promise<PrintActionData> {
  return act(input.id, (job) => planRetry(job, input.nowMs));
}
