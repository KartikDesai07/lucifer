import type { OfflineRound } from "@pos/shared/offline-kot";
import { failure, serverError } from "@/lib/api-helpers";
import type { OfflineAsk } from "@/lib/print-offline-jobs";
import { printIntentOf } from "@/lib/print-order-jobs";

// Printing Phase 5 (spec 2026-11-03 §5.9): what the two order routes do with the `offline` field around the order
// write. The pure rules are in print-offline-jobs.ts (which job creation imports, so this file, which imports job
// creation, keeps the two apart).

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

/** An offline round whose jobs could not be made (createOrderPrintJobs rethrows only for it): the order is saved, the
 *  answer is 503, and the device sends it again under its key, whose replay makes them. */
export function offlineSlipsUnmade(error: unknown): Response {
  return serverError(OFFLINE_SLIPS_UNMADE, error, 503);
}
