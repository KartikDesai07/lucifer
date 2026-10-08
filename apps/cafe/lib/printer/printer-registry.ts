import { devicePrinter } from "@/lib/printer/device-printer";
import { nativePool, poolPrinterCannotPrint } from "@/lib/printer/native-pool";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// Phase 2 Session 2F1 (spec §9.2): this device's printers by the POS app's id. On bridge v2 a printer job names its
// printer and goes to it through the app's list (nativePool(): `printer.print` with that id), this device's own printer
// (the app's default) included, so a printer job never goes to "whatever the app's default is now" (the 2E gate's
// review, I-2). A slip with no printer of its own (simple mode, a manual print) goes to devicePrinter() as before.

/** Writes one finished job to the printer with this app id, through that printer's own queue. */
export function printerWriter(nativeId: string): (bytes: Uint8Array) => Promise<void> {
  return (bytes) => nativePool().write(nativeId, bytes);
}

let lastState: { device: unknown; pool: unknown } | null = null;

/** A value whose identity changes when any printer of this device changes (a refusal's hold is released then):
 *  the device's own printer, or one of the app's other printers. */
export function printersState(): object {
  const device = devicePrinter().getSnapshot();
  const pool = nativePool().getSnapshot();
  if (lastState === null || lastState.device !== device || lastState.pool !== pool) lastState = { device, pool };
  return lastState;
}

/** That printer's state as the app reports it: "none" when the app has no printer with that id. */
export function printerStatusOf(nativeId: string): PrinterStatus {
  return nativePool().printerOf(nativeId)?.status ?? "none";
}

/** Session 3C (spec §10): the app says that printer cannot print now (out of paper, cover open, an error). */
export function printerCannotPrintOf(nativeId: string): boolean {
  const printer = nativePool().printerOf(nativeId);
  return printer !== null && poolPrinterCannotPrint(printer);
}
