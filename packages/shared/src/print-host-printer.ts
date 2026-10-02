// ─────────────────────────────────────────────────────────────────────────────
// Printer-connection contract for the print host (Bluetooth-print plan W1).
// Single-homed here (not in print-job.ts, which is at its line budget) so the
// cafe SERVER (beat schema, PrintHost model, state mapper) and the cafe CLIENT
// (beat reporter, printer dot) agree on one vocabulary. Pure and client-safe.
// ─────────────────────────────────────────────────────────────────────────────

/** What the host stores and the pulse serves: the host's printer is reachable
 *  or it is not. Absence (the wire `null`) means "the lane cannot tell". */
export const PRINT_HOST_PRINTER_STATES = ["connected", "disconnected"] as const;
export type PrintHostPrinterState = (typeof PRINT_HOST_PRINTER_STATES)[number];

/** Beat-only third value: "this host's lane cannot tell" (system print
 *  window). The beat route maps it to an `$unset` — it is never stored. */
export const PRINT_HOST_BEAT_PRINTER_UNKNOWN = "unknown" as const;

/** Every value a beat body's `printer` field may carry. */
export const PRINT_HOST_BEAT_PRINTER_VALUES = [
  ...PRINT_HOST_PRINTER_STATES,
  PRINT_HOST_BEAT_PRINTER_UNKNOWN,
] as const;
export type PrintHostBeatPrinter = (typeof PRINT_HOST_BEAT_PRINTER_VALUES)[number];
