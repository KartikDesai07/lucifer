import { DESKTOP_PRINT_EMPTY_MESSAGE } from "@/lib/desktop-shell-document";
import { DESKTOP_PRINT_TOO_LARGE_MESSAGE } from "@/lib/desktop-shell";
import { PRINT_HOST_EMPTY_SLIP_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE } from "@/lib/print-host-slips";
import { NO_PRINTER_MESSAGE } from "@/lib/printer/lane-print";
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
]);

/** Refused before any byte left, and refused again every time: too large, or a blank slip. */
const NEVER_PRINTS: ReadonlySet<string> = new Set([
  PRINTER_TOO_LARGE_MESSAGE,
  RASTER_TOO_LARGE_MESSAGE,
  DESKTOP_PRINT_TOO_LARGE_MESSAGE,
  DESKTOP_PRINT_EMPTY_MESSAGE,
  PRINT_HOST_EMPTY_SLIP_MESSAGE,
]);

const UNKNOWN_FAILURE_MESSAGE = "may have printed";

export function printWriteOutcomeOf(error: unknown): PrintWriteOutcome {
  if (error instanceof PrintWriteError) return { sent: error.sent, permanent: error.permanent, message: error.message };
  const message = error instanceof Error && error.message.trim() !== "" ? error.message : UNKNOWN_FAILURE_MESSAGE;
  if (NEVER_PRINTS.has(message)) return { sent: "no", permanent: true, message };
  if (NOTHING_SENT.has(message)) return { sent: "no", permanent: false, message };
  return { sent: "maybe", permanent: false, message };
}
