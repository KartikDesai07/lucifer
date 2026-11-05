import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { printerProblemText } from "@pos/shared/print-failover";
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { PRINTER_GONE_MESSAGE, PRINT_JOB_NO_PRINTER } from "@pos/shared/print-printers";
import { printerNameOf, printWaitingAge, printWaitingBadgeOf, printWaitingReason } from "@/lib/print-waiting";
import { isDesktopShellRefusal, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";

// Printer UX, PX-2 Task 3 (spec §6.3): the "Not printed" card's rows, words, buttons and order, as pure
// rules. No React, no request: the card only draws what this says, so a button that must not show (a
// Print button on a slip that prints by itself) cannot slip in through markup.

export type NotPrintedAction = "print-again" | "it-printed" | "try-again" | "print-now" | "clear";

export interface NotPrintedRow {
  id: string;
  label: string;
  age: string;
  /** The bold lead of the reason (bills and failed slips only). */
  strong: string | null;
  reason: string;
  tone: "warn" | "bad" | null;
  actions: NotPrintedAction[];
}

export interface NotPrintedView {
  badge: string;
  summary: string;
  rows: NotPrintedRow[];
  /** Every row's id in the shown order: what "Clear all" sends. */
  ids: string[];
}

/** Rows shown before "Show all". */
export const NOT_PRINTED_SHOWN = 5;

export const NOT_PRINTED_ACTION_WORDS: Record<NotPrintedAction, string> = {
  "print-again": "Print again",
  "it-printed": "It printed",
  "try-again": "Try again",
  "print-now": "Print now",
  clear: "Clear",
};

const GONE_REASON = "No printer takes it now. Print it again from its order.";
const WAIT_BY_ITSELF = "They print by themselves when the printer is ready.";
const NEEDS_YOU = "Tap a button on the ones that need you.";

type Printers = ReadonlyArray<{ id: string; name: string }>;
type Body = Pick<NotPrintedRow, "strong" | "reason" | "tone" | "actions">;

function queuedBody(row: PrintAttentionRow, nowMs: number, printers: Printers): Body {
  const only = (reason: string): Body => ({ strong: null, reason, tone: null, actions: ["clear"] });
  // An approved slip (staff already tapped it) is never "over 30 min" and has no second Print now (R6).
  if (row.approved !== true && nowMs - Date.parse(row.createdAt) > PRINT_HOST_MAX_AGE_MS) {
    return { strong: null, reason: "Waiting over 30 min.", tone: null, actions: ["print-now", "clear"] };
  }
  const name = printerNameOf(printers, row.printerId);
  if (row.problem !== undefined) return only(printerProblemText(name ?? "The printer", row.problem));
  if (row.lastError) {
    const outcome = printWriteOutcomeOf(new Error(row.lastError));
    if (isSlipRefusal(outcome)) return only("Could not be prepared. Tries once more by itself.");
    if (outcome.sent === "no") return only(isDesktopShellRefusal(row.lastError) ? row.lastError : "The printer is off or not connected.");
  }
  const repeat = row.labels.find((label) => label === "REPRINT" || label === "DUPLICATE");
  if (repeat) return only(`Prints again, marked ${repeat}.`);
  return only(name === null ? "Waits for the printer." : `Waits for ${name}.`);
}

function bodyOf(row: PrintAttentionRow, nowMs: number, printers: Printers): Body {
  const bill = row.status === "needs-confirm";
  // Server facts only (R3): a printer missing from this device's cached list is not "gone".
  if (row.status !== "queued" && (row.printerId === PRINT_JOB_NO_PRINTER || row.lastError === PRINTER_GONE_MESSAGE)) {
    return { strong: null, reason: GONE_REASON, tone: bill ? "warn" : "bad", actions: bill ? ["it-printed", "clear"] : ["clear"] };
  }
  if (bill) return { strong: "May have printed.", reason: "Check the printer.", tone: "warn", actions: ["print-again", "it-printed", "clear"] };
  if (row.status === "failed") {
    // printWaitingReason's failed branch is the row's own safe words, or its generic retry line when it has none.
    const own = printWaitingReason(row, nowMs);
    const generic = printWaitingReason({ ...row, lastError: undefined }, nowMs);
    return { strong: "Could not print.", reason: own === generic ? "" : own, tone: "bad", actions: ["try-again", "clear"] };
  }
  return queuedBody(row, nowMs, printers);
}

const RANK = { "needs-confirm": 0, failed: 1, queued: 2 } as const;

export function notPrintedViewOf(rows: readonly PrintAttentionRow[], truncated: boolean, nowMs: number, printers: Printers): NotPrintedView | null {
  if (rows.length === 0) return null;
  // The feed is oldest first: reversing before the stable sort makes each group newest first.
  const ordered = [...rows].reverse().sort((a, b) => RANK[a.status] - RANK[b.status]);
  const needsYou = rows.some((row) => row.status !== "queued");
  return {
    badge: printWaitingBadgeOf({ printAttention: [...rows], printAttentionTruncated: truncated }),
    summary: `${truncated ? "The newest 20. " : ""}${needsYou ? NEEDS_YOU : WAIT_BY_ITSELF}`,
    rows: ordered.map((row) => ({ id: row.id, label: row.label, age: printWaitingAge(row.createdAt, nowMs), ...bodyOf(row, nowMs, printers) })),
    ids: ordered.map((row) => row.id),
  };
}

/** Clear all asks about the slips listed when its confirm opened (PX-2 Task 4 review): a KOT that arrives meanwhile is
 *  never cleared unasked. The snapshot itself (the same array) while any of its slips is still listed; null once none
 *  is (cleared elsewhere, or printed): the confirm closes. */
export function clearAllAskedOf(asked: readonly string[] | null, listed: readonly string[]): readonly string[] | null {
  return asked !== null && asked.some((id) => listed.includes(id)) ? asked : null;
}

/** The pulse cache without these rows (a cleared slip leaves at once); the same object when none is in it. */
export function withoutAttentionRows<T extends { printAttention?: PrintAttentionRow[] }>(data: T | undefined, ids: ReadonlySet<string>): T | undefined {
  if (data?.printAttention === undefined || !data.printAttention.some((row) => ids.has(row.id))) return data;
  return { ...data, printAttention: data.printAttention.filter((row) => !ids.has(row.id)) };
}
