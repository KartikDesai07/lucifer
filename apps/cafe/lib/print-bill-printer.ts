// Printing redesign, Phase 2 Session 2D (plan decision 7, spec §8): this device's own bill printer, chosen in the
// printer panel and kept in this device's storage, never on the server (an ordering-only device has no PrintDevice
// row, and rows go after 7 days unseen). Every print request names it (x-pos-bill-printer); absent, bills and End
// of day go to the default bill printer. A stale id is harmless: the server counts it only while that printer is
// routable and takes bills (the 2B gate's ruling R4; the 2D review gate). The same safe-storage discipline as
// lib/pos-device-prefs.ts: a staff
// device's storage is outside this app's control, so nothing here ever throws. Zero React.
import { routablePrinterOf, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";

export const BILL_PRINTER_KEY = "pos.bill-printer.v1";
/** The picker's value for "the default bill printer". */
export const BILL_PRINTER_DEFAULT = "default";

const CHOICE_GONE = "The printer chosen before is switched off or gone, so bills go to the default.";

export type BillPrinterChoice = {
  /** The printer this device's bills print at, as routing chooses it, or BILL_PRINTER_DEFAULT. */
  value: string;
  /** The printers offered: every routable printer that takes bills. */
  options: PrinterConfig[];
  /** Words for a choice the setup changed under it; null when there is nothing to say. */
  note: string | null;
};

/** Session 2D's final review (M-6): the picker says what routing does. The server sends this device's bills to its
 *  choice while that printer is routable and takes bills (chosenBillPrinter; the 2D review gate), else to the default
 *  bill printer, so a choice whose Bill box was unticked later shows the default, and says why. */
export function billPrinterChoiceOf(printers: readonly PrinterConfig[], chosen: string | null): BillPrinterChoice {
  const billPrinters = routablePrinters(printers).filter((printer) => printer.slips.bill);
  if (chosen === null) return { value: BILL_PRINTER_DEFAULT, options: billPrinters, note: null };
  if (billPrinters.some((printer) => printer.id === chosen)) return { value: chosen, options: billPrinters, note: null };
  const routed = routablePrinterOf(printers, chosen);
  const note = routed === null ? CHOICE_GONE : `${routed.name} no longer takes bills, so this device's bills go to the default. Choose another printer to change it.`;
  return { value: BILL_PRINTER_DEFAULT, options: billPrinters, note };
}

const PRINTER_ID_PATTERN = /^[0-9a-f]{24}$/i;

/** A stored value as a printer id, or null for anything else. */
export function billPrinterIdOf(raw: string | null): string | null {
  return raw !== null && PRINTER_ID_PATTERN.test(raw) ? raw : null;
}

export function readBillPrinterId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return billPrinterIdOf(window.localStorage.getItem(BILL_PRINTER_KEY));
  } catch {
    return null;
  }
}

/** null: back to the default bill printer. A quota or disabled-storage failure is swallowed. */
export function writeBillPrinterId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id === null) window.localStorage.removeItem(BILL_PRINTER_KEY);
    else window.localStorage.setItem(BILL_PRINTER_KEY, id);
  } catch {
    // Nothing persisted, nothing crashed: the default bill printer until it is chosen again.
  }
}
