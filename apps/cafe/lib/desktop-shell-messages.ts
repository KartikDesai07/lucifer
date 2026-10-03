// The Windows app's own print sentences (apps/desktop/src/print-messages.ts, raw-spool.ts): copied, since
// this app cannot import the shell's package, and pinned word for word in lib/print-write-outcome.test.ts. They
// let the print agent tell a refusal from a slip that may be on paper (spec §7.5's Windows row; the Phase 1
// final gate, I-3). They reach the page wrapped by the IPC layer; lib/desktop-shell.ts shellErrorMessage
// unwraps them. Pure: no imports.

/** Thrown before any byte left, for the printer's sake: no printer chosen, a printer that writes files, no
 *  server address, no spooler, the chosen printer not found. Never an attempt. */
export const DESKTOP_SHELL_REFUSALS: readonly string[] = [
  "No printer is chosen for this PC. Open Settings, then Printing, and pick the printer.",
  "The chosen printer saves files instead of printing. Open Settings, then Printing, and pick the real printer.",
  "No server address is set.",
  "Direct printing is not available on this PC. Open Settings, then Printing, and choose the Windows driver method.",
  "The chosen printer was not found on this PC. Open Settings, then Printing, and pick it again.",
];
/** Refused before any byte left because of the slip itself: it did not finish drawing (owner, 1C gate I3). */
export const DESKTOP_SHELL_NOT_READY_MESSAGE = "The slip did not finish drawing. Print it again.";
/** Refused every time: a blank slip, or one too long to print. */
export const DESKTOP_SHELL_NEVER_PRINTS: readonly string[] = ["That slip had nothing to print.", "This slip is too large to print."];
