import { DESKTOP_PRINT_EMPTY_MESSAGE } from "@/lib/desktop-shell-document";
import { DESKTOP_PRINT_TOO_LARGE_MESSAGE, isDesktopShell, shellErrorMessage } from "@/lib/desktop-shell";
import { DESKTOP_SHELL_NEVER_PRINTS, DESKTOP_SHELL_NOT_READY_MESSAGE, DESKTOP_SHELL_REFUSALS } from "@/lib/desktop-shell-messages";
import { PRINT_HOST_EMPTY_SLIP_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { NO_PRINTER_MESSAGE, laneFailureMessage } from "@/lib/printer/lane-print";
import { RASTER_FAILED_MESSAGE, RASTER_TOO_LARGE_MESSAGE } from "@/lib/printer/raster";
import {
  NATIVE_BLUETOOTH_BLOCKED_MESSAGE,
  NATIVE_BLUETOOTH_OFF_MESSAGE,
  NATIVE_BUSY_MESSAGE,
  NATIVE_LOCATION_OFF_MESSAGE,
} from "@/lib/printer/transport-native";
import {
  PRINTER_ELSEWHERE_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_TOO_LARGE_MESSAGE,
} from "@/lib/printer/web-printer-types";

// Printing redesign, Phase 1 Session 1C (spec §7.5): what one failed print tells the server. The
// agent acks a failure with `sent: "no"` ONLY when nothing can have reached the printer; anything
// else is "maybe" (a KOT then retries once with REPRINT, a bill asks the cashier). Every sentence the
// print lanes throw is curated (lane-print.ts LANE_MESSAGES), so the sentence IS the code: a refusal
// made before any byte left, a payload that can never print, or "it may already be on paper". An
// error this file does not know is "maybe", the safe direction: it never authorizes an unlabelled
// repeat. The write queue is unchanged (device-printer-write.ts): the agent prints one job at a time,
// so a job never waits behind another there, and its "write failed" stays "maybe".

export type PrintWriteSent = "no" | "maybe";

/** A failure whose sender knows its class (the host bridge's own refusals). Keeps its operator
 *  sentence as `message`, so laneFailureMessage and every toast read it exactly as before. */
export class PrintWriteError extends Error {
  readonly sent: PrintWriteSent;
  readonly permanent: boolean;
  constructor(message: string, sent: PrintWriteSent, permanent = false) {
    super(message);
    this.name = "PrintWriteError";
    this.sent = sent;
    this.permanent = permanent;
  }
}

export interface PrintWriteOutcome {
  sent: PrintWriteSent;
  /** Retrying cannot help (too large, blank): the job goes straight to failed. */
  permanent: boolean;
  /** The operator sentence, for the job's lastError (the server cuts it to 200 chars). */
  message: string;
}

/** Refused before any byte left: no printer here, not connected, owned by another tab, Bluetooth
 *  off or blocked, the printer busy, the slip could not be drawn, or its figures never loaded. */
const NOTHING_SENT: ReadonlySet<string> = new Set([
  PRINT_HOST_EOD_TIMEOUT_MESSAGE,
  NO_PRINTER_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_ELSEWHERE_MESSAGE,
  RASTER_FAILED_MESSAGE,
  NATIVE_BUSY_MESSAGE,
  NATIVE_BLUETOOTH_OFF_MESSAGE,
  NATIVE_BLUETOOTH_BLOCKED_MESSAGE,
  NATIVE_LOCATION_OFF_MESSAGE,
  ...DESKTOP_SHELL_REFUSALS,
  DESKTOP_SHELL_NOT_READY_MESSAGE,
]);

/** Refused before any byte left, and refused again every time: too large, or a blank slip. */
const NEVER_PRINTS: ReadonlySet<string> = new Set([
  PRINTER_TOO_LARGE_MESSAGE,
  RASTER_TOO_LARGE_MESSAGE,
  DESKTOP_PRINT_TOO_LARGE_MESSAGE,
  DESKTOP_PRINT_EMPTY_MESSAGE,
  PRINT_HOST_EMPTY_SLIP_MESSAGE,
  ...DESKTOP_SHELL_NEVER_PRINTS,
]);

/** Refused because of the slip itself, not the printer (owner, 1C gate I3): it could not be drawn, or
 *  its figures never loaded. The second one for a job while the printer is ready fails that job. */
const SLIP_REFUSALS: ReadonlySet<string> = new Set([RASTER_FAILED_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE, DESKTOP_SHELL_NOT_READY_MESSAGE]);

/** A Windows app refusal: its own sentence tells staff what to fix on the PC (the panel shows it as is). */
export function isDesktopShellRefusal(message: string): boolean {
  return DESKTOP_SHELL_REFUSALS.includes(message);
}

/** The sentence a failed slip carries to its caller (the agent) and the toast. In the Windows app, the shell's own
 *  curated sentence, unwrapped from the IPC layer's "Error invoking remote method …: Error: …": wrapped, every
 *  Windows failure read as an unknown "may have printed" (the Phase 1 final gate, I-3). Elsewhere a lane's own
 *  sentence, else the bridge's generic one (unchanged). */
export function hostPrintFailureMessage(error: unknown, desktop: boolean = isDesktopShell()): string {
  if (desktop) return shellErrorMessage(error);
  return laneFailureMessage(error) ?? PRINT_HOST_PRINT_FAILED_MESSAGE;
}
export const PRINT_SLIP_REFUSALS_MAX = 2;

export function isSlipRefusal(outcome: PrintWriteOutcome): boolean {
  return outcome.sent === "no" && !outcome.permanent && SLIP_REFUSALS.has(outcome.message);
}

const UNKNOWN_FAILURE_MESSAGE = "may have printed";

export function printWriteOutcomeOf(error: unknown): PrintWriteOutcome {
  if (error instanceof PrintWriteError) return { sent: error.sent, permanent: error.permanent, message: error.message };
  const message = error instanceof Error && error.message.trim() !== "" ? error.message : UNKNOWN_FAILURE_MESSAGE;
  if (NEVER_PRINTS.has(message)) return { sent: "no", permanent: true, message };
  if (NOTHING_SENT.has(message)) return { sent: "no", permanent: false, message };
  return { sent: "maybe", permanent: false, message };
}
