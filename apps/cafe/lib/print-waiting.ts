import type { PrintActionData, PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { isDesktopShellRefusal, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";

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
  // Queued: a stale slip needs a tap whatever its printer does (the agent never leases it by itself),
  // unless staff already tapped it (1D gate M-6: then it only waits for its printer).
  if (!row.approved && nowMs - Date.parse(row.createdAt) > PRINT_HOST_MAX_AGE_MS) return "Waiting over 30 minutes: print it now, or clear it.";
  if (row.lastError) {
    const outcome = printWriteOutcomeOf(new Error(row.lastError));
    // The slip itself was refused once (owner, 1C gate I3): not the printer's fault (1D gate M-6).
    if (isSlipRefusal(outcome)) return "The slip could not be prepared. It tries once more by itself.";
    // The Windows app says what to fix on the PC (no printer chosen, not found): its own words (final gate, I-3).
    if (outcome.sent === "no") return isDesktopShellRefusal(row.lastError) ? row.lastError : "The printer is off or not connected.";
  }
  const repeat = row.labels.find((label) => label === "REPRINT" || label === "DUPLICATE");
  if (repeat) return `Waiting to print again, marked ${repeat}.`;
  return row.approved ? "Waiting for the printer." : "Not printed yet.";
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

/** The button's accessible name: the count comes first while slips wait, then the printer's own state
 *  (1D gate M-5: a screen reader still hears whether the printer is connected). */
export function printWaitingName(base: string, badge: string): string {
  return badge === "" ? base : `${badge} slip${badge === "1" ? "" : "s"} waiting · ${base}`;
}

/** The 20 s alarm (spec §10) is for the device that asked for a slip and the one that prints it: a KOT
 *  that has not printed, a bill to check, and any slip that could not print (the 1D gate: a cancel notice
 *  that failed matters to the kitchen too). A device with no identity hears nothing. */
export function printAlarmWanted(row: PrintAttentionRow, deviceId: string): boolean {
  if (deviceId === "" || (row.originDeviceId !== deviceId && row.targetDeviceId !== deviceId)) return false;
  return row.kind === "kot" || row.status !== "queued";
}

export function printAlarmMessage(row: PrintAttentionRow): string {
  if (row.status === "needs-confirm") return `${row.label} may not have printed.`;
  if (row.status === "failed") return `${row.label} could not print.`;
  return `${row.label} has not printed yet.`;
}

/** A page that opens while slips already wait shows one notice for them, not one per slip (1D gate N-5). */
export function printAlarmSummary(count: number): string {
  return `${count} slip${count === 1 ? "" : "s"} still waiting. Open the printer panel to check.`;
}

/** How long a slip this alarm knows stays remembered after it left the feed: a slip that is merely being
 *  printed for a moment (leased) comes back without ringing again (1D gate M-1). */
export const PRINT_ALARM_FORGET_MS = 60_000;

const GROUP_RANK: Record<PrintWaitingGroup, number> = { printer: 0, bill: 1, failed: 2 };

export interface PrintAlarmMemory {
  group: PrintWaitingGroup;
  createdAt: string;
  seenAt: number;
  shown: boolean;
  /** Its notice went down because the slip left the feed (printed, or leased for a moment), not because
   *  staff acted on it: if it comes back still waiting, so does its notice (the 1E final review). */
  left?: true;
  /** Staff tapped it (Print now, Retry, Print again): its notice went quietly (the Phase 1 final gate, M6). */
  approved?: true;
  /** It already waited when the page opened: the one summary notice stands for it until it leaves the feed or
   *  gets a notice of its own (the Phase 1 final gate, M4). */
  summary?: true;
}

export interface PrintAlarmStep {
  memory: Map<string, PrintAlarmMemory>;
  /** Sound once for this pulse. */
  ring: boolean;
  /** A lasting notice to show (or to re-word: same id) for each of these. */
  show: PrintAttentionRow[];
  /** Notices to take down: their slip left the feed, or staff acted on it. */
  dismiss: string[];
  /** The first pulse of a page: how many of its slips already waited (one notice for all of them). */
  summary: number;
  /** How many slips the summary notice still stands for (0: it goes; the Phase 1 final gate, M4). */
  summaryWaiting: number;
  /** How many slips this device should hear about wait now (0: the summary notice can go too). */
  wanted: number;
}

/** One pulse of the alarm, pure. A slip rings once when it first waits, and again only when it gets worse
 *  (waiting → check the bill → could not print; the 1D gate N-4); a slip staff acted on loses its notice
 *  quietly: its group went down (Retry, Print again), or Print now on a stale slip (the Phase 1 final gate,
 *  M6). With the newest 20 rows read (owner, I-1 option A), a slip older than the page's oldest row
 *  may still wait beyond the cut: while the feed says it was cut, it is kept, notice and all (N-2). */
export function printAlarmStep(
  memory: ReadonlyMap<string, PrintAlarmMemory>,
  feed: { rows: readonly PrintAttentionRow[]; truncated: boolean },
  deviceId: string,
  nowMs: number,
  first: boolean,
): PrintAlarmStep {
  const next = new Map(memory);
  const step: PrintAlarmStep = { memory: next, ring: false, show: [], dismiss: [], summary: 0, summaryWaiting: 0, wanted: 0 };
  const seen = new Set<string>();
  for (const row of feed.rows) {
    if (!printAlarmWanted(row, deviceId)) continue;
    seen.add(row.id);
    step.wanted += 1;
    const group = groupOf(row);
    const approved = row.approved === true ? { approved: true as const } : {};
    const was = next.get(row.id);
    if (was === undefined && first) {
      step.summary += 1;
      next.set(row.id, { group, createdAt: row.createdAt, seenAt: nowMs, shown: false, summary: true, ...approved });
    } else if (was === undefined || GROUP_RANK[group] > GROUP_RANK[was.group]) {
      // A notice of its own: the summary no longer stands for it.
      step.ring = true;
      step.show.push(row);
      next.set(row.id, { group, createdAt: row.createdAt, seenAt: nowMs, shown: true, ...approved });
    } else if (group !== was.group || (row.approved === true && was.approved !== true)) {
      // Staff acted on it: quietly.
      if (was.shown) step.dismiss.push(row.id);
      next.set(row.id, { group, createdAt: was.createdAt, seenAt: nowMs, shown: false, ...approved, ...(was.summary === true ? { summary: true as const } : {}) });
    } else if (was.left === true) {
      // Back from a moment's lease (a refused attempt) and still waiting: its notice comes back, without a
      // second ring. A gap must never read as "printed".
      step.show.push(row);
      next.set(row.id, { group, createdAt: was.createdAt, seenAt: nowMs, shown: true, ...approved });
    } else {
      next.set(row.id, { ...was, seenAt: nowMs });
    }
  }
  const oldest = feed.rows.length > 0 ? Date.parse(feed.rows[0]?.createdAt ?? "") : Number.NaN;
  for (const [id, was] of memory) {
    if (seen.has(id)) continue;
    if (feed.truncated && Date.parse(was.createdAt) < oldest) {
      next.set(id, { ...was, seenAt: nowMs });
      continue;
    }
    if (was.shown) {
      step.dismiss.push(id);
      next.set(id, { ...was, shown: false, left: true });
    }
    if (nowMs - was.seenAt > PRINT_ALARM_FORGET_MS) next.delete(id);
  }
  // Seen (or kept beyond a cut) on this pulse, and still under the summary.
  for (const slip of next.values()) if (slip.summary === true && slip.seenAt === nowMs) step.summaryWaiting += 1;
  return step;
}

/** What a Retry / Print now tap says when the server did not apply it (null: done). */
export function printRetryNotice(answer: PrintActionData): string | null {
  if (answer.applied) return null;
  if (answer.status === "queued" && answer.reason === "wrong-status") return "It prints by itself as soon as the printer is ready.";
  return "Already handled.";
}
