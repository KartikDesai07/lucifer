import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// Printer UX PX-2 (spec §6.9 B6): the app retries a printer that dropped by itself (disconnected → connecting →
// disconnected …), and the dot flickered red ↔ "Checking…" on every try. A "connecting" right after a settled
// "disconnected" or "needs-tap" now reads as that settled state until the printer connects (or settles otherwise);
// "connected" always shows at once. Applied to this device's printer ("local") and to each of the app's printers (its
// native id; "device:<printer id>" for a browser's or an older app's one printer) BEFORE printerDotOf / dotPrintersOf,
// so the header button and the panel read the same value. A manual Reconnect says "Reconnecting…" on its own button.

export type HeldStatusMemory = Map<string, PrinterStatus>;

// The settled states a retry is not allowed to hide (a printer that has never settled is simply being checked).
const HELD: readonly PrinterStatus[] = ["disconnected", "needs-tap"];

/** The status to show for `key`. Idempotent for one input, so every reader of one page memory gets the same answer. */
export function heldPrinterStatusOf(memory: HeldStatusMemory, key: string, status: PrinterStatus): PrinterStatus {
  if (status !== "connecting") {
    memory.set(key, status);
    return status;
  }
  const settled = memory.get(key);
  return settled !== undefined && HELD.includes(settled) ? settled : status;
}

/** One memory per page: the button and the panel (and each mount of them) share it. */
export const PAGE_HELD_STATUS: HeldStatusMemory = new Map();
