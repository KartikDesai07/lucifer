import type { PrintActionData, PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { printWriteOutcomeOf } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1D (spec §10; the owner's decision after Session 1B): the one
// waiting-slips panel, its count on the printer button, and the 20 s alarm, as pure rules. Every slip that
// is not printed and needs a person shows in one of three groups, in plain words, with how long it has
// waited and why. No React, no fetch; the server's words (lease, epoch, attempts) never reach the screen.

export type PrintWaitingGroup = "printer" | "bill" | "failed";

export const PRINT_WAITING_TITLES: Record<PrintWaitingGroup, string> = {
  printer: "Waiting for the printer",
  bill: "Check the bill",
  failed: "Couldn't print",
};

const GROUP_ORDER: readonly PrintWaitingGroup[] = ["printer", "bill", "failed"];
const SERVER_WORDS = /lease|epoch|attempt|limits/i;

function groupOf(row: PrintAttentionRow): PrintWaitingGroup {
  return row.status === "needs-confirm" ? "bill" : row.status === "failed" ? "failed" : "printer";
}

export function printWaitingAge(createdAt: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - Date.parse(createdAt)) / 60_000);
  if (!(minutes >= 1)) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

export function printWaitingReason(row: PrintAttentionRow, nowMs: number): string {
  if (row.status === "needs-confirm") return "It may already have printed. Check the printer.";
  if (row.status === "failed") {
    return row.lastError && !SERVER_WORDS.test(row.lastError) ? row.lastError : "Tried twice. Check the printer, then retry.";
  }
  // Queued: a stale slip needs a tap whatever its printer does (the agent never leases it by itself).
  if (nowMs - Date.parse(row.createdAt) > PRINT_HOST_MAX_AGE_MS) return "Waiting over 30 minutes: print it now, or clear it.";
  if (row.lastError && printWriteOutcomeOf(new Error(row.lastError)).sent === "no") return "The printer is off or not connected.";
  const repeat = row.labels.find((label) => label === "REPRINT" || label === "DUPLICATE");
  if (repeat) return `Waiting to print again, marked ${repeat}.`;
  return "Not printed yet.";
}

export interface PrintWaitingSection {
  group: PrintWaitingGroup;
  title: string;
  rows: Array<{ row: PrintAttentionRow; reason: string; age: string }>;
}

export function printWaitingGroups(rows: readonly PrintAttentionRow[], nowMs: number): PrintWaitingSection[] {
  return GROUP_ORDER.map((group) => ({
    group,
    title: PRINT_WAITING_TITLES[group],
    rows: rows.filter((row) => groupOf(row) === group).map((row) => ({ row, reason: printWaitingReason(row, nowMs), age: printWaitingAge(row.createdAt, nowMs) })),
  })).filter((section) => section.rows.length > 0);
}

/** The printer button's count: "" when nothing waits, "20+" when the feed was cut at its limit. */
export function printWaitingBadgeOf(pulse: Pick<PosPulseData, "printAttention" | "printAttentionTruncated"> | undefined): string {
  const count = pulse?.printAttention?.length ?? 0;
  if (count === 0) return "";
  return pulse?.printAttentionTruncated ? `${count}+` : String(count);
}

/** The button's accessible name: the count comes first while slips wait. */
export function printWaitingName(base: string, badge: string): string {
  return badge === "" ? base : `${badge} slip${badge === "1" ? "" : "s"} waiting — open printer setup`;
}

/** The 20 s alarm (spec §10): a KOT this device asked for or prints, or a bill it should check, once per
 *  slip (`rung`) until the slip leaves the feed. A device with no identity hears nothing. */
export function printAlarmRows(rows: readonly PrintAttentionRow[], deviceId: string, rung: ReadonlySet<string>): PrintAttentionRow[] {
  if (deviceId === "") return [];
  return rows.filter(
    (row) =>
      !rung.has(row.id) &&
      (row.originDeviceId === deviceId || row.targetDeviceId === deviceId) &&
      (row.kind === "kot" || (row.kind === "bill" && row.status === "needs-confirm")),
  );
}

export function printAlarmMessage(row: PrintAttentionRow): string {
  if (row.status === "needs-confirm") return `${row.label} may not have printed.`;
  if (row.status === "failed") return `${row.label} could not print.`;
  return `${row.label} has not printed yet.`;
}

/** What a Retry / Print now tap says when the server did not apply it (null: done). */
export function printRetryNotice(answer: PrintActionData): string | null {
  if (answer.applied) return null;
  if (answer.status === "queued" && answer.reason === "wrong-status") return "It prints by itself as soon as the printer is ready.";
  return "Already handled.";
}
