// Every sentence the print lanes may show the operator. The tray notification,
// the log and the web app's toast all carry exactly ONE of these (or a driver
// reason passed through sanitizeFailureReason) — never a foreign string, never
// the slip's HTML. Pure (no electron import) so the IPC handler, the job
// runner and both print lanes can import it without a cycle, and so node:test
// can read it directly.
import { PRINT_FAILED_PREFIX, PRINT_FAILURE_REASON_MAX_CHARS } from "./shared";

export const PRINT_TIMEOUT_MESSAGE =
  "The printer did not answer. Check the printer and print again.";
export const PRINT_REJECTED_MESSAGE = "This print request was refused.";
export const PRINT_NO_ORIGIN_MESSAGE = "No server address is set.";
// A blank slip is never sent to the printer (owner rule 2026-09-11): a
// document with no body text, or one whose paint never arrived, is refused
// with one of these — the Windows notification and the log both carry it.
export const PRINT_EMPTY_MESSAGE = "That slip had nothing to print.";
export const PRINT_NOT_READY_MESSAGE = "The slip did not finish drawing. Print it again.";
export const PRINT_TOO_LARGE_MESSAGE = "This slip is too large to print.";
// Owner rule 2026-09-17: a slip must never be handed to a device that writes a
// FILE instead of paper. Silent printing to the Windows default sent every
// slip to whatever that happened to be — on the counter PC a "nul:" port
// device that swallowed it, or a "PORTPROMPT:" one that opened a save-file
// dialog. Both are refused now, out loud, with the tray notification saying
// what to do. A printer must be CHOSEN; there is no implicit fallback.
export const PRINT_NO_PRINTER_MESSAGE =
  "No printer is chosen for this PC. Open Settings, then Printing, and pick the printer.";
export const PRINT_NOT_A_PRINTER_MESSAGE =
  "The chosen printer saves files instead of printing. Open Settings, then Printing, and pick the real printer.";

// Chromium's failure reasons are short English strings ("Invalid deviceName
// provided", "Print job canceled"). Anything else is not forwarded verbatim —
// it is bounded, printable ASCII, or replaced by the generic message.
export function sanitizeFailureReason(reason: unknown): string {
  if (typeof reason !== "string") return PRINT_REJECTED_MESSAGE;
  const clean = reason.replace(/[^\x20-\x7e]/g, "").trim();
  if (clean.length === 0 || clean.length > PRINT_FAILURE_REASON_MAX_CHARS) return PRINT_REJECTED_MESSAGE;
  return PRINT_FAILED_PREFIX + clean;
}
