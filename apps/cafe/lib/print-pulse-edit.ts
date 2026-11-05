import type { QueryClient } from "@tanstack/react-query";

import type { PrintAckData } from "@pos/shared/print-agent-wire";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import type { PrintAgentAckBody } from "@/lib/print-agent-types";
import { withoutAttentionRows } from "@/lib/print-waiting-view";

// PX-2 (spec §6.9 B4): a slip this device just printed leaves the Not printed list at once, on this device: the server
// applied its printed ack, so the cached pulse drops that row (no request; other devices see it go on their next pulse,
// 20 s while slips wait). The write is a manual cache write: the alarm's listener hears it (the slip's notice goes),
// and the page agent's own pulse listener skips it, so a printed slip never kicks a trailing lease (F-I1).

/** Takes a printed slip off the cached feed when the server applied its printed ack; any other answer (a failed ack, a
 *  printed ack not applied: a late one, a lease lost) leaves the cache untouched. Hands the answer on unchanged, so the
 *  agent's ack reads it as before. */
export function dropPrintedFromPulse<A extends Pick<PrintAckData, "applied" | "status">>(
  qc: Pick<QueryClient, "getQueryState" | "setQueryData">,
  id: string,
  body: Pick<PrintAgentAckBody, "outcome">,
  answer: A,
): A {
  if (body.outcome === "printed" && answer.applied && answer.status === "printed") {
    const state = qc.getQueryState<PosPulseData>(POS_PULSE_KEYS.all);
    // Only a slip the list shows (most print before they are ever listed): every cache write restarts the pulse's
    // interval timer. The pulse keeps its own time: an edit is no answer (the POS app's hidden tick reads that time).
    if (state?.data?.printAttention?.some((row) => row.id === id) === true) {
      qc.setQueryData<PosPulseData>(POS_PULSE_KEYS.all, (data) => withoutAttentionRows(data, new Set([id])), { updatedAt: state.dataUpdatedAt });
    }
  }
  return answer;
}
