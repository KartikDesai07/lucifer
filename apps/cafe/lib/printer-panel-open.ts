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
