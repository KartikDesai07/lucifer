// Session 1D: open the top-bar printer sheet from anywhere on the page (the 20 s alarm's Show button).
// On a phone the alarm notice covers the top bar, so it cannot point at the printer icon underneath it.
// A window event, so the sheet's own open state stays inside PrinterStatusButton. Client-only.

const OPEN_PRINTER_PANEL_EVENT = "pos:open-printer-panel";

export function openPrinterPanel(): void {
  window.dispatchEvent(new Event(OPEN_PRINTER_PANEL_EVENT));
}

export function onOpenPrinterPanel(listener: () => void): () => void {
  window.addEventListener(OPEN_PRINTER_PANEL_EVENT, listener);
  return () => window.removeEventListener(OPEN_PRINTER_PANEL_EVENT, listener);
}

// PX-2 (spec §6.9 B5): whether the sheet is open, as the button reports it, so the 20 s alarm never puts a toast over
// it. Module state (one printer button per page); the open event above stays the way to open it (R12).
let panelOpen = false;
const openListeners = new Set<(open: boolean) => void>();

export function setPrinterPanelOpen(open: boolean): void {
  if (open === panelOpen) return;
  panelOpen = open;
  for (const listener of [...openListeners]) listener(open);
}

export function printerPanelIsOpen(): boolean {
  return panelOpen;
}

export function onPrinterPanelOpenChange(listener: (open: boolean) => void): () => void {
  openListeners.add(listener);
  return () => void openListeners.delete(listener);
}

/** The button's one effect: reports the sheet's state, and its cleanup (a close, an unmount) reports it closed, so a
 *  button that goes away never leaves the alarm quiet. */
export function reportPrinterPanelOpen(open: boolean): () => void {
  setPrinterPanelOpen(open);
  return () => setPrinterPanelOpen(false);
}
