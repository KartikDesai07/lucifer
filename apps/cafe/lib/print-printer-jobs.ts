import { PRINT_JOB_NO_PRINTER } from "@pos/shared/print-printers";
import type { PrintJobEnqueueResult } from "@pos/shared/print-job";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { announcesQueuedJob, printerLineIsFree } from "@/lib/print-direct";
import { insertPrintJob, type InsertedPrintJob } from "@/lib/print-job-insert";
import { routePrintRequest, routedJobKey, type PrintRouting, type RoutedPrintJob } from "@/lib/print-printer-routing";
import { printJobKeyOf } from "@/lib/print-queue";
import { readPrintRouting } from "@/lib/print-routing-context";
import type { PrintJobRequest } from "@/lib/print-routing";
import { publishPrintStatus } from "@/lib/realtime-publish";

// Printing redesign, Phase 2 Session 2C (spec §8; plan decisions 1–5, 15, 16): job creation in printers mode.
// Every slip a request makes is routed (lib/print-printer-routing.ts) into one job per printer: on that printer's
// line, aimed at its writer (targetDeviceId), with its copies, under routedJobKey (a replay or a repair collides
// instead of printing twice). A slip no printer takes is made failed at once, so it shows under "Couldn't print".
// The first job a request puts on a printer the asking tab writes and can print now is made already leased to it
// (decision 15); every other new queued job is announced to its writer, and nothing to yourself (decision 16).
// Printers mode makes no "print-job" nudge: no host plays a part. Never calls connectDB(). No console.*.

/** The products a slip's stations are resolved for (spec §6.2): its lines; a void, its voided line (which may
 *  have left the order); End of day, none. */
export function printPayloadProductIds(payload: PrintJobPayload): string[] {
  switch (payload.kind) {
    case "void":
      return [payload.line.productId];
    case "eod":
    case "test":
      return [];
    default:
      return payload.snapshot.items.map((item) => item.productId);
  }
}

/** The asking tab for one routed job (decision 15): only on a printer the asking device writes and names as
 *  ready, and only for the request's first job on that printer (§7.6: one writer, oldest first). `seen` holds
 *  the printers this request already put a job on. */
export function askingTabOf(
  job: Pick<RoutedPrintJob, "printerId" | "writerDeviceId">,
  input: { originDeviceId?: string; leaseTabId?: string; readyPrinterIds: readonly string[] },
  seen: Set<string>,
): string | undefined {
  if (job.printerId === null) return undefined;
  const first = !seen.has(job.printerId);
  seen.add(job.printerId);
  if (!first || input.leaseTabId === undefined || job.writerDeviceId !== input.originDeviceId) return undefined;
  return input.readyPrinterIds.includes(job.printerId) ? input.leaseTabId : undefined;
}

/** Makes every job the requests route to and announces each new queued one to its writer. The caller keeps kind
 *  order (KOT before bill, §7.6). `routed` counts the jobs routing asked for (0: nothing to print). A DB error
 *  throws. A routed job's key falls back to printJobKeyOf only when the slip has no key of its own, and then a
 *  station slip has none either (same kind, order and round), so two printers never share a key. */
export async function createRoutedPrintJobs(input: {
  routing: PrintRouting;
  requests: readonly PrintJobRequest[];
  /** The slip's own key: printJobKeyOf, or a client repeat's reprint:<Idempotency-Key>. */
  baseKeyOf: (request: PrintJobRequest) => string | undefined;
  originDeviceId?: string;
  leaseTabId?: string;
  readyPrinterIds?: readonly string[];
  queuedBy: string;
  nowMs: number;
}): Promise<{ jobs: InsertedPrintJob[]; routed: number }> {
  const asking = { originDeviceId: input.originDeviceId, leaseTabId: input.leaseTabId, readyPrinterIds: input.readyPrinterIds ?? [] };
  const seen = new Set<string>();
  const directOn = new Set<string>();
  const jobs: InsertedPrintJob[] = [];
  let routed = 0;
  for (const request of input.requests) {
    const baseKey = input.baseKeyOf(request);
    for (const job of routePrintRequest(request, input.routing)) {
      routed += 1;
      const jobKey = routedJobKey(baseKey, job);
      const common = { request: job.request, originDeviceId: input.originDeviceId, queuedBy: input.queuedBy, ...(jobKey !== undefined ? { jobKey } : {}), nowMs: input.nowMs };
      if (job.printerId === null) {
        const made = await insertPrintJob({
          ...common,
          targetDeviceId: input.originDeviceId ?? "",
          line: { printerId: PRINT_JOB_NO_PRINTER, copies: 1 },
          failed: job.error ?? "",
        });
        if (made !== null) jobs.push(made);
        continue;
      }
      const tabId = askingTabOf(job, asking, seen);
      const tab = tabId === undefined ? {} : { tab: { tabId, direct: await printerLineIsFree(job.printerId, input.nowMs) } };
      const made = await insertPrintJob({ ...common, targetDeviceId: job.writerDeviceId ?? "", line: { printerId: job.printerId, copies: job.copies }, ...tab });
      if (made === null) continue;
      jobs.push(made);
      if (made.ref.leased !== undefined) directOn.add(job.printerId);
      if (announcesQueuedJob(made, directOn.has(job.printerId))) publishPrintStatus({ id: made.ref.id, status: "queued", target: made.ref.targetDeviceId });
    }
  }
  return { jobs, routed };
}

/** One client-started slip's jobs as the enqueue's answer (the 2B review gate's ruling R1): nothing routed is
 *  "not-routed" (never a local print); one job answers as in simple mode; several answer the first id and every
 *  job, plus the one made leased to the asking tab. All of them found already resolved: "already-resolved". */
export function routedEnqueueResultOf(jobs: readonly InsertedPrintJob[], routed: number): PrintJobEnqueueResult {
  if (routed === 0) return { outcome: "not-routed" };
  const first = jobs[0];
  if (first === undefined) return { outcome: "too-large" };
  const leased = jobs.find((job) => job.ref.leased !== undefined)?.ref.leased;
  const created = jobs.some((job) => job.created);
  if (!created && leased === undefined && jobs.every((job) => job.status !== "queued")) return { outcome: "already-resolved", id: first.ref.id };
  return {
    outcome: "queued",
    id: first.ref.id,
    duplicate: !created,
    ...(leased !== undefined ? { leased } : {}),
    ...(jobs.length > 1 ? { jobs: jobs.map((job) => job.ref) } : {}),
  };
}

/** POST /api/print-jobs in printers mode (spec §7.3): a client-started slip (a reprint, End of day, a cancel
 *  notice, a slip an order answer did not name) is routed like any other, under its own key or the request's
 *  Idempotency-Key. null: simple mode, so the caller's simple-mode enqueue runs unchanged. */
export async function enqueueRoutedPrintJob(input: {
  payload: PrintJobPayload;
  label: string;
  queuedBy: string;
  idempotencyKey?: string;
  originDeviceId?: string;
  leaseTabId?: string;
  readyPrinterIds?: readonly string[];
  billPrinterId?: string;
  nowMs: number;
}): Promise<PrintJobEnqueueResult | null> {
  const routing = await readPrintRouting({
    productIds: printPayloadProductIds(input.payload),
    ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}),
  });
  if (routing === null) return null;
  const baseKey = printJobKeyOf(input.payload) ?? (input.idempotencyKey !== undefined ? `reprint:${input.idempotencyKey}` : undefined);
  const made = await createRoutedPrintJobs({
    routing,
    requests: [{ payload: input.payload, label: input.label }],
    baseKeyOf: () => baseKey,
    originDeviceId: input.originDeviceId,
    leaseTabId: input.leaseTabId,
    readyPrinterIds: input.readyPrinterIds,
    queuedBy: input.queuedBy,
    nowMs: input.nowMs,
  });
  return routedEnqueueResultOf(made.jobs, made.routed);
}
