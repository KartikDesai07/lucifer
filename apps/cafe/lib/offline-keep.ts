// An offline send, start to end (Printing Phase 5, spec 5.2–5.6; plan Task 11): the entry is written FIRST, under the
// outbox lock (a write the storage refused, a full outbox, a number past O-9999 or too many lines: nothing prints and
// staff are told); then each here line prints through the page's one bridge, behind any slip already printing; then
// the outcomes are stored. The paper never waits on the cart: the send answers as soon as the entry is kept.

import type { OutboxStore } from "@/lib/offline-outbox-store";
import { offlineLinesOf, type OfflineLinePlan } from "@/lib/offline-lines";
import { patchEntry } from "@/lib/offline-outbox";
import { SEND_OFFLINE_NOT_KEPT } from "@/lib/pos-send";
import type { HostPrintSlip } from "@/lib/print-host-slips";
import {
  OFFLINE_FULL_MESSAGE,
  OFFLINE_ORDER_SENT_MESSAGE,
  offlineKeptMessage,
  planOfflineKeep,
  printOfflineLines,
  type OfflineKeepPlan,
  type OfflineKeepRequest,
  type OfflineSlipOutcome,
} from "@/lib/offline-send";

/** The entries whose paper is still printing on this page: the replay waits for them (their here lines say "maybe"
 *  until then, which would make the server print them again as REPRINT). */
export const offlinePrinting = new Set<string>();

export interface OfflineKeepDeps {
  update: OutboxStore["update"];
  /** The slip of one line (lib/offline-lines.ts offlineLineSlip, as lib/offline-here.ts offlineSlipFor reaches it). May throw. */
  slipOf: (line: OfflineLinePlan, ref: string) => HostPrintSlip;
  /** Through the page's one bridge (PrintHostProvider's queueOfflineSlip). */
  print: (slip: HostPrintSlip, line: OfflineLinePlan) => Promise<OfflineSlipOutcome>;
  nameOf: (printerId: string | null) => string;
}

export type OfflineKeepResult = { kept: true; message: string | null; printed: Promise<void> } | { kept: false; message: string };

const REFUSED: Record<Exclude<Extract<OfflineKeepPlan, { ok: false }>["reason"], "duplicate">, string> = {
  full: OFFLINE_FULL_MESSAGE,
  "order-sent": OFFLINE_ORDER_SENT_MESSAGE,
  "too-many-lines": SEND_OFFLINE_NOT_KEPT,
  number: SEND_OFFLINE_NOT_KEPT,
};

export async function keepOfflineSend(req: OfflineKeepRequest, deps: OfflineKeepDeps): Promise<OfflineKeepResult> {
  let planned: OfflineKeepPlan | null = null;
  const written = await deps.update((record) => {
    planned = planOfflineKeep(record, req);
    return planned.ok ? planned.record : null;
  });
  const outcome = planned as OfflineKeepPlan | null;
  if (outcome !== null && !outcome.ok) {
    // Already kept under this key: its paper is out (or on its way); a second keep would print it twice.
    if (outcome.reason === "duplicate") return { kept: true, message: null, printed: Promise.resolve() };
    return { kept: false, message: REFUSED[outcome.reason] };
  }
  if (outcome === null || written !== "written") return { kept: false, message: SEND_OFFLINE_NOT_KEPT };
  const { entry, plan } = outcome;
  const message = offlineKeptMessage({ ref: entry.ref, sale: req.sale, plan, print: req.print, nameOf: deps.nameOf });
  if (!plan.some((line) => line.here)) return { kept: true, message, printed: Promise.resolve() };
  offlinePrinting.add(entry.key);
  const printed = (async () => {
    try {
      const outcomes = await printOfflineLines(plan, async (index) => {
        let slip: HostPrintSlip;
        try {
          slip = deps.slipOf(plan[index], entry.ref);
        } catch {
          return "no"; // a slip this page cannot draw sent nothing: the line waits for the server
        }
        return deps.print(slip, plan[index]);
      });
      const lines = offlineLinesOf(plan, outcomes);
      await deps.update((record) => (record.entries.some((e) => e.key === entry.key) ? patchEntry(record, entry.key, { lines }) : null));
    } catch {
      // The entry keeps its here lines as "maybe": the server prints them as REPRINT, never unlabelled.
    } finally {
      offlinePrinting.delete(entry.key);
    }
  })();
  return { kept: true, message, printed };
}
