import { SELF_ORDER_RECEIVER } from "@pos/shared/public";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { claimKotPrint } from "@/lib/pos-pulse";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { createOrderPrintJobs, wireOrderOf, type PrintIntent } from "@/lib/print-order-jobs";
import type { Order } from "@/types";

// Printing redesign, Phase 1 Session 1C: the server half of the in-page agent that is not a lifecycle
// route. Never calls connectDB() (the routes do). No console.*.
//
// The job-aware self-order lane (ruling R4, after the Session 1B final review's C1). The lane that wins
// /kot-claim no longer prints the KOT on its own page: when it asks as an agent, the SAME request makes
// the KOT a print job (today's key, kot:<orderId>:<round>) for the device that prints now (the host,
// or the claiming device with no host), so the slip gets lease → write → ack, a labelled retry and the
// readback. There is one creator per KOT, because the claim CAS still lets exactly one lane win, so
// nothing can race the public auto-accept: that stays exactly as live today and makes no job.
// A failed create keeps the claim won (the D9 marker is never reopened) and names no job, so the lane
// enqueues the KOT itself under the same key (the 1C client's missing-ref rule). No new request, no new
// write beyond the job itself.

export type AgentKotClaimResult =
  | { claimed: false; reason: "no-order" | "raced" | "not-eligible" }
  | { claimed: true; order: Order & { printJobs?: PrintJobRef[] }; kotRound: number };

export async function claimKotPrintForAgent(id: string, intent: PrintIntent, nowMs: number): Promise<AgentKotClaimResult> {
  const result = await claimKotPrint(id);
  if (!result.claimed) return result;
  const printJobs = await createOrderPrintJobs({
    order: result.order,
    slips: [{ kind: "kot", round: result.kotRound }],
    originDeviceId: intent.deviceId,
    queuedBy: SELF_ORDER_RECEIVER,
    nowMs,
  });
  const order = wireOrderOf(result.order);
  return { claimed: true, order: printJobs.length > 0 ? { ...order, printJobs } : order, kotRound: result.kotRound };
}

/** GET /api/order-requests/pulse?device=<id>: the agent tab that names itself hears how many jobs wait
 *  in its own line (spec §9.1). Anything unusable is ignored, never a 400: the pulse must not fail. */
export function printPulseDeviceOf(url: string): string | null {
  const raw = new URL(url).searchParams.get("device")?.trim() ?? "";
  return raw !== "" && raw.length <= PRINT_HOST_DEVICE_ID_MAX_CHARS ? raw : null;
}
