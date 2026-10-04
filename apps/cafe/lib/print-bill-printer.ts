// Printing redesign, Phase 2 Session 2D (plan decision 7, spec §8): this device's own bill printer, chosen in the
// printer panel and kept in this device's storage, never on the server (an ordering-only device has no PrintDevice
// row, and rows go after 7 days unseen). Every print request names it (x-pos-bill-printer); absent, bills and End
// of day go to the default bill printer. A stale id is harmless: the server counts it only while that printer is
// routable (the 2B gate's ruling R4). The same safe-storage discipline as lib/pos-device-prefs.ts: a staff
// device's storage is outside this app's control, so nothing here ever throws. Zero React.
export const BILL_PRINTER_KEY = "pos.bill-printer.v1";

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
