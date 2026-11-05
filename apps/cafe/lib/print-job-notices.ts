import type { PrintActionData } from "@pos/shared/print-agent-wire";
import { ApiError } from "@/lib/api-client";
import { printRetryNotice } from "@/lib/print-waiting";
import type { NotPrintedAction } from "@/lib/print-waiting-view";

// Printer UX, PX-2 Task 4 (spec §6.3, §6.9 B8, F-M2): what the Not printed card says after a tap, as pure rules. Its
// own hook toasts them; the dashboard band keeps its hooks and words (R10). `drop`: the row leaves the cached list at
// once (the slip is gone on the server), before the one refetch every tap makes.

export type RowNotice = { text: string; tone: "info" | "error"; drop: boolean } | null;

/** The band's words (hooks/use-print-job-actions.ts, which must not change): a copy, pinned equal by the test. */
export const ACTION_ERROR = "That did not go through. Check the connection and try again.";
export const CLEAR_ALL_FAILED = "Could not clear all. Clear them one by one.";

const READY = "It prints as soon as the printer is ready.";
const PRINTING_NOW = "This slip is printing right now.";
const GONE = "This slip is no longer waiting.";

const info = (text: string): RowNotice => ({ text, tone: "info", drop: false });

export function rowAnswerNoticeOf(action: NotPrintedAction, answer: PrintActionData | { dismissed: boolean; reason?: string }): RowNotice {
  // A Clear that applied says nothing: the row just leaves. Not applied is a slip an old print host already took.
  if ("dismissed" in answer) return answer.dismissed ? null : info(PRINTING_NOW);
  // A confirm that applied changes the row on the next pulse (R6): nothing to say. A retry tells when it prints.
  if (answer.applied) return action === "try-again" || action === "print-now" ? info(READY) : null;
  const text = printRetryNotice(answer);
  return text === null ? null : info(text);
}

/** Only the app's own 404 (its JSON envelope) proves the slip is gone; a host's 404 page during a deploy proves
 *  nothing about it (F-M2), so that row stays and the tap can be tried again. */
export function rowErrorNoticeOf(error: unknown): RowNotice {
  if (error instanceof ApiError && error.status === 404 && error.enveloped) return { text: GONE, tone: "info", drop: true };
  return { text: ACTION_ERROR, tone: "error", drop: false };
}

/** Clear all's route is new: an older server (a rollback) answers 404, enveloped or not. Single Clears still work there. */
export function clearAllErrorOf(error: unknown): string {
  return error instanceof ApiError && error.status === 404 ? CLEAR_ALL_FAILED : ACTION_ERROR;
}
