import type { QueryClient } from "@tanstack/react-query";

import type { PrintAckData } from "@pos/shared/print-agent-wire";
import { REFETCH_INTERVALS } from "@pos/shared/query";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import type { PrintAgentAckBody } from "@/lib/print-agent-types";
import { withoutAttentionRows } from "@/lib/print-waiting-view";

// PX-2 (spec §6.9 B4): a slip this device just printed leaves the Not printed list at once, on this device: the server
// applied its printed ack, so the cached pulse drops that row (no request; other devices see it go on their next pulse,
// 20 s while slips wait). The write is a manual cache write: the alarm's listener hears it (the slip's notice goes),
// and the page agent's own pulse listener skips it, so a printed slip never kicks a trailing lease (F-I1).

/** Takes a printed slip off the cached feed when the server applied its printed ack and the cached answer is fresh and
 *  idle (else it leaves at the next answer, as before); any other answer (a failed ack, a printed ack not applied: a late
 *  one, a lease lost) leaves the cache untouched. Hands the answer on unchanged, so the agent's ack reads it as before.
 *  `nowMs`: a test seam. */
export function dropPrintedFromPulse<A extends Pick<PrintAckData, "applied" | "status">>(
  qc: Pick<QueryClient, "getQueryState" | "setQueryData">,
  id: string,
  body: Pick<PrintAgentAckBody, "outcome">,
  answer: A,
  nowMs: number = Date.now(),
): A {
  if (body.outcome === "printed" && answer.applied && answer.status === "printed") {
    const state = qc.getQueryState<PosPulseData>(POS_PULSE_KEYS.all);
    // Every cache write restarts the pulse's interval timer, and the host's beat rides each real answer: only a fresh,
    // idle answer is edited, so a long drain never holds the host's pulse off past the 180 s offline read (Ruling S), and
    // a pulse in flight (read before the ack) never writes the slip back. The pulse keeps its own time (the anchor).
    const fresh = state !== undefined && state.fetchStatus === "idle" && nowMs - state.dataUpdatedAt < REFETCH_INTERVALS.POS_PULSE;
    if (fresh && state.data?.printAttention?.some((row) => row.id === id) === true) {
      qc.setQueryData<PosPulseData>(POS_PULSE_KEYS.all, (data) => withoutAttentionRows(data, new Set([id])), { updatedAt: state.dataUpdatedAt });
    }
  }
  return answer;
}
