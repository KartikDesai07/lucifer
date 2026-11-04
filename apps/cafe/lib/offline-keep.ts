// An offline send, start to end (Printing Phase 5, spec 5.2–5.6; plan Task 11): the entry is written FIRST, under the
// outbox lock (a write the storage refused, a full outbox, a number past O-9999 or too many lines: nothing prints and
// staff are told); then each here line prints through the page's one bridge, behind any slip already printing; then
// the outcomes are stored. The paper never waits on the cart: the send answers as soon as the entry is kept.

import type { OutboxStore } from "@/lib/offline-outbox-store";
import { offlineLinesOf, type OfflineLinePlan } from "@/lib/offline-lines";
import { patchEntry } from "@/lib/offline-outbox";
import { SEND_OFFLINE_NOT_KEPT } from "@/lib/pos-send";
import type { HostPrintSlip } from "@/lib/print-host-slips";
import type { Order } from "@/types";
import {
  OFFLINE_FULL_MESSAGE,
  OFFLINE_ORDER_SENT_MESSAGE,
  offlineKeptMessage,
  offlineMissedMessage,
  offlineRoundPlan,
  planOfflineKeep,
  printOfflineLines,
  type OfflineKeepPlan,
  type OfflineKeepRequest,
  type OfflinePlanContext,
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

/** `printed`: once the paper is done, what to tell staff about a here line that did not print (null: nothing). */
export type OfflineKeepResult = { kept: true; message: string | null; printed: Promise<string | null> } | { kept: false; message: string };

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
    if (outcome.reason === "duplicate") return { kept: true, message: null, printed: Promise.resolve(null) };
    return { kept: false, message: REFUSED[outcome.reason] };
  }
  if (outcome === null || written !== "written") return { kept: false, message: SEND_OFFLINE_NOT_KEPT };
  const { entry, plan } = outcome;
  const message = offlineKeptMessage({ ref: entry.ref, sale: req.sale, plan, print: req.print, nameOf: deps.nameOf });
  if (!plan.some((line) => line.here)) return { kept: true, message, printed: Promise.resolve(null) };
  return { kept: true, message, printed: printHereLines(entry.key, entry.ref, plan, deps) };
}

/** Prints the plan's here lines through the bridge, then stores their outcomes; the replay waits meanwhile. Answers
 *  what to tell staff about a line that did not print (the review's I3). */
function printHereLines(key: string, ref: string, plan: readonly OfflineLinePlan[], deps: OfflineKeepDeps): Promise<string | null> {
  offlinePrinting.add(key);
  return (async () => {
    let missed: string | null = null;
    try {
      const outcomes = await printOfflineLines(plan, async (index) => {
        let slip: HostPrintSlip;
        try {
          slip = deps.slipOf(plan[index], ref);
        } catch {
          return "no"; // a slip this page cannot draw sent nothing: the line waits for the server
        }
        return deps.print(slip, plan[index]);
      });
      missed = offlineMissedMessage(ref, plan, outcomes, deps.nameOf);
      const lines = offlineLinesOf(plan, outcomes);
      await deps.update((record) => (record.entries.some((e) => e.key === key) ? patchEntry(record, key, { lines }) : null));
    } catch {
      // The entry keeps its here lines as "maybe": the server prints them as REPRINT, never unlabelled.
    } finally {
      offlinePrinting.delete(key);
    }
    return missed;
  })();
}

/** Spec 5.7's "Print KOT here" for a half-way send (staff were told it may print twice): its here lines print with its
 *  own banner, kept as "maybe" first, then their outcomes, so the server marks them printed. Only for an uncertain
 *  entry whose lines never printed here, and never while it is being sent. `base`: the tab a round was added to. */
export async function printEntryHere(key: string, ctx: OfflinePlanContext & { base: Order | null }, deps: OfflineKeepDeps): Promise<{ printed: false } | { printed: true; message: string; done: Promise<string | null> }> {
  let found: { ref: string; plan: OfflineLinePlan[] } | null = null;
  const written = await deps.update((record) => {
    const index = record.entries.findIndex((e) => e.key === key);
    const entry = record.entries[index];
    if (entry === undefined || !entry.uncertain || entry.state === "sending" || entry.lines.some((l) => l.outcome !== "later") || offlinePrinting.has(key)) return null;
    const earlierRounds = record.entries.slice(0, index).filter((e) => e.local === entry.local && e.kind === "round").length;
    const stored = (entry.body ?? {}) as Record<string, unknown>;
    // A round whose tab the POS no longer lists still prints its table (the entry keeps it).
    const body = stored.tableNo === undefined && entry.table !== "" ? { ...stored, tableNo: entry.table } : stored;
    const { plan } = offlineRoundPlan({ key, ref: entry.ref, at: entry.at, base: ctx.base, body, earlierRounds }, ctx);
    if (!plan.some((line) => line.here)) return null;
    found = { ref: entry.ref, plan };
    return patchEntry(record, key, { lines: plan.map((line) => ({ printerId: line.printerId, part: line.part, outcome: line.here ? "maybe" : "later" })) });
  });
  const ready = found as { ref: string; plan: OfflineLinePlan[] } | null;
  if (written !== "written" || ready === null) return { printed: false };
  const message = offlineKeptMessage({ ref: ready.ref, sale: false, plan: ready.plan, print: true, nameOf: deps.nameOf });
  return { printed: true, message, done: printHereLines(key, ready.ref, ready.plan, deps) };
}
