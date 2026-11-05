import { PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";

// PX-2 (spec §6.9 B7; §14 R4): the toast a failed write raises for a slip printed for a print JOB (the agent's path). The
// lane's sentences end "then print the slip again", which is false for a job: one not connected waits and prints by
// itself, and one that may have reached paper moves on by its own rules (a labelled retry, a bill to check, or could not
// print). So the toast says only what is always true. The lane constants stay byte-identical: they are also the job's
// lastError, which printWriteOutcomeOf reads. Client-safe, pure.

export const JOB_NOT_CONNECTED_TOAST =
  "The printer is not connected. The slip waits and prints by itself once it is back: tap the printer icon to reconnect.";
export const JOB_MAYBE_TOAST = "The printer stopped answering. Check the paper: the printer icon shows what still waits.";

/** A job's slip's toast for the bridge's failure sentence: not connected (nothing sent) and anything that may be on
 *  paper say the job's truth; any other refusal (Bluetooth off, the slip too long, …) keeps its own words. */
export function jobPrintToastOf(message: string): string {
  if (message === PRINTER_NOT_CONNECTED_MESSAGE) return JOB_NOT_CONNECTED_TOAST;
  if (message === PRINT_HOST_PRINT_FAILED_MESSAGE || printWriteOutcomeOf(new Error(message)).sent === "maybe") return JOB_MAYBE_TOAST;
  return message;
}
