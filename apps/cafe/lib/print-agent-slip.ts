import { PRINT_ACK_ERROR_MAX_CHARS, printBannerText } from "@pos/shared/print-lifecycle";
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import type { PrintAgentAckBody } from "@/lib/print-agent-types";
import { PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_EOD_READY_TIMEOUT_MS, hostPrintSlipOf, type HostPrintSlip, type SlipPrintTarget } from "@/lib/print-host-slips";
import type { PrintWriteOutcome } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §7.5, §7.7): what the in-page agent prints for one leased job,
// and what it reports when that fails. Split out of print-agent.ts at the 2A review gate to keep that file
// near its ~300-line budget; print-agent.ts re-exports every name.

/** How long the agent waits for the bridge to settle one slip: past the bridge's own bounds (the end-of-day
 *  figures' wait, then the dispatch watchdog), so only a slip the watchdog gave up on reaches it. Such a
 *  slip may have printed, so it is acked "maybe". */
export const PRINT_AGENT_SLIP_DEADLINE_MS = PRINT_HOST_EOD_READY_TIMEOUT_MS + PRINT_HOST_DISPATCH_TIMEOUT_MS + 5_000;

export function failedAckBody(deviceId: string, epoch: number, outcome: PrintWriteOutcome): PrintAgentAckBody {
  const error = outcome.message.trim().slice(0, PRINT_ACK_ERROR_MAX_CHARS).trim();
  return {
    deviceId,
    epoch,
    outcome: "failed",
    sent: outcome.sent,
    ...(outcome.permanent ? { permanent: true as const } : {}),
    ...(error !== "" ? { error } : {}),
  };
}

/** The slip the host bridge prints for one leased job: today's renderer props (print-host-slips.ts),
 *  plus the job's labels as the one banner on top (spec §7.7). An end-of-day summary takes none. Session 2E: a job
 *  on a Windows printer this PC prints by name carries that printer's target; Session 2F1: one on one of the POS app's
 *  printers (bridge v2) carries that printer's id. */
export function printAgentSlipOf(job: LeasedPrintJob, todayKey: string, target?: SlipPrintTarget): HostPrintSlip {
  const slip = hostPrintSlipOf(job.payload, todayKey);
  const banner = printBannerText(job.labels);
  const labelled: HostPrintSlip = banner === "" || slip.surface === "eod" ? slip : { ...slip, banner };
  return target === undefined ? labelled : { ...labelled, target };
}
