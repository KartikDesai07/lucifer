import type { Types } from "mongoose";
import type { OfflineRound } from "@pos/shared/offline-kot";
import { lifecycleOf, planOfflinePrinted, type PrintJobLifecycleDoc } from "@pos/shared/print-lifecycle";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { kotRoundOfIdemKey } from "@pos/shared/order-idem";
import { PrintJob } from "@/models/PrintJob";
import { failure, serverError, success } from "@/lib/api-helpers";
import { applyPrintJobPlan } from "@/lib/print-lease";
import { offlineDetailOf, offlineLineOfJobKey, offlineTakenAtKept, offlineVerdictOf, withOfflineEcho, type OfflineAsk } from "@/lib/print-offline-jobs";
import { createOrderPrintJobs, openingSlipsOf, printIntentOf, withPrintJobs, type OrderPrintSlip, type PrintIntent } from "@/lib/print-order-jobs";
import type { Order } from "@/types";

// Printing Phase 5 (spec 2026-11-03 §5.8–5.9): what the two order routes do with the `offline` field around the order
// write, and the replay of a request that carries it. The pure rules are in print-offline-jobs.ts (which job creation
// imports, so this file, which imports job creation, keeps the two apart).

export const OFFLINE_NEEDS_DEVICE = "An offline round needs this device's id.";
export const OFFLINE_SLIPS_UNMADE = "Saved; its slips are not made yet.";

/** The field and the asking device, or the 400: an offline round's jobs are made for the device that printed it, so
 *  it must come with the print headers (`x-pos-print-agent` + `x-pos-device-id`). No field: no ask. */
export function offlineAskOf(req: Request, offline: OfflineRound | undefined): { ask: OfflineAsk | undefined } | { error: Response } {
  if (offline === undefined) return { ask: undefined };
  const intent = printIntentOf(req);
  if (intent === null) return { error: failure(OFFLINE_NEEDS_DEVICE, 400) };
  return { ask: { round: offline, deviceId: intent.deviceId } };
}

/** An offline round whose jobs could not be made (createOrderPrintJobs rethrows only for it), or a replay that could
 *  not finish: the order is saved, the answer is 503, and the device sends it again under its key. */
export function offlineSlipsUnmade(error: unknown): Response {
  return serverError(OFFLINE_SLIPS_UNMADE, error, 503);
}

type ReplayRow = PrintJobLifecycleDoc & { _id: Types.ObjectId; jobKey?: string; targetDeviceId?: string };

/** The replay of a round whose first send landed without the field or lost its answer (a half-way send printed with
 *  "Print KOT here"): each KOT job of the round still queued and never tried, on a line the field names as printed, is
 *  moved to printed (one CAS per job on its status, epoch and attempts 0). A job printed, leased or tried stays: it
 *  may already be on paper. A DB error is thrown (the replay answers 503 and is sent again), never swallowed: a job
 *  left queued would print the line a second time, unlabelled. */
export async function markOfflineRoundPrinted(input: { orderObjectId: string; round: number; ask: OfflineAsk; nowMs: number }): Promise<number> {
  const rows = await PrintJob.find({ orderId: input.orderObjectId, kind: "kot", status: "queued", attempts: 0 })
    // PX-2 (R7): the clear request too, or a slip carrying a leftover one could never pass the CAS (printJobCasFilter).
    .select("kind status createdAt epoch attempts uncertainAttempts nextAttemptAt labels jobKey targetDeviceId dismissRequestedAt dismissRequestedBy")
    .lean<ReplayRow[]>();
  let moved = 0;
  for (const row of rows) {
    const line = row.jobKey === undefined ? null : offlineLineOfJobKey(row.jobKey, input.orderObjectId, input.round);
    if (line === null || offlineVerdictOf({ ...line, targetDeviceId: row.targetDeviceId ?? "" }, input.ask) !== "printed") continue;
    const job = lifecycleOf(row);
    const plan = planOfflinePrinted(job, input.ask.deviceId, offlineDetailOf(input.ask.round.ref), input.nowMs);
    if (plan.ok && (await applyPrintJobPlan(row._id, job, plan.patch, { attempts: 0 }))) moved += 1;
  }
  return moved;
}

/** Makes any of the round's jobs that are missing, with their verdicts (the rows that exist collide on their keys and
 *  stay): the round's KOT, plus a sale's bill when the request asks to print it (the create route's printsBillNow; the
 *  re-check's N3). A creation error is thrown (the replay answers 503). */
export async function ensureOfflineRoundJobs(input: {
  order: unknown;
  slips: OrderPrintSlip[];
  ask: OfflineAsk;
  intent: PrintIntent;
  queuedBy: string;
  nowMs: number;
}): Promise<PrintJobRef[]> {
  return createOrderPrintJobs({
    order: input.order,
    slips: input.slips,
    originDeviceId: input.intent.deviceId,
    leaseTabId: input.intent.leaseTabId,
    readyPrinterIds: input.intent.readyPrinterIds,
    billPrinterId: input.intent.billPrinterId,
    offline: input.ask,
    queuedBy: input.queuedBy,
    nowMs: input.nowMs,
  });
}

/** A replay answer (the send's key was already used) to a request with the field: the lines printed offline are made
 *  printed, the missing jobs made, and the answer carries them and the echo, as a first answer does (spec §5.8–5.9).
 *  `roundKey`: the round's key on the items route; absent on the create (round 1). Every other answer (no field, a
 *  refusal, a bill still being numbered) is passed on unchanged. The CAS runs first, so the jobs the answer names say
 *  their real state and a line moved to printed no longer holds its printer's line. */
export async function offlineReplayAnswer(response: Response, ask: OfflineAsk | undefined, intent: PrintIntent | null, staff: string | null | undefined, roundKey?: string): Promise<Response>;
export async function offlineReplayAnswer(response: Response | null, ask: OfflineAsk | undefined, intent: PrintIntent | null, staff: string | null | undefined, roundKey?: string): Promise<Response | null>;
export async function offlineReplayAnswer(
  response: Response | null,
  ask: OfflineAsk | undefined,
  intent: PrintIntent | null,
  staff: string | null | undefined,
  roundKey?: string,
): Promise<Response | null> {
  if (response === null || ask === undefined || intent === null || response.status !== 200) return response;
  try {
    const order = ((await response.clone().json()) as { data: Order }).data;
    const round = roundKey === undefined ? 1 : kotRoundOfIdemKey(order, roundKey);
    if (round === undefined) return response;
    const nowMs = Date.now();
    await markOfflineRoundPrinted({ orderObjectId: String(order._id), round, ask, nowMs });
    const bill = roundKey === undefined && intent.bill && order.status === "Completed" ? [{ kind: "bill" as const }] : [];
    const slips: OrderPrintSlip[] = roundKey === undefined ? [...openingSlipsOf(order, 1), ...bill] : [{ kind: "kot", round }];
    const refs = await ensureOfflineRoundJobs({ order, slips, ask, intent, queuedBy: staff ?? "", nowMs });
    const kept = offlineTakenAtKept(order, round, ask.round.takenAt) ? ask.round.takenAt : null;
    return success(withOfflineEcho(withPrintJobs(order, refs), ask.round, kept));
  } catch (error) {
    return offlineSlipsUnmade(error);
  }
}
