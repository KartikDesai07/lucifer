import { desktopShell } from "@/lib/desktop-shell";
import { bluetoothApi, inAppWebView, serialApi } from "@/lib/printer/capabilities";
import { desktopChosen } from "@/lib/printer/desktop-printer-state";
import { PRINTER_ELSEWHERE_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, devicePrinter } from "@/lib/printer/device-printer";
import { NO_PRINTER_MESSAGE } from "@/lib/printer/lane-print";
import { nativeBridge } from "@/lib/printer/native-bridge";
import { nativePool } from "@/lib/printer/native-pool";

// Which way a slip leaves THIS device, resolved at call time (never cached, so
// a setup change or a late-arriving bridge takes effect without a re-render):
//   desktop - the Windows shell's silent pipeline
//   raster  - a saved device printer (Web Serial, Web Bluetooth or the POS app)
//   none    - inside the POS app with no printer chosen (a print window would do nothing)
//   system  - the browser's print window
//   pending - only ever the server/first-paint value of the hooks
// Capability-keyed only: the presence of an API object, never the browser's
// identity. This is the ONE file in lib/printer that imports the desktop-shell
// seam (and the seam's sibling lane-print.ts must never import this file).
export type PrintLane = "pending" | "desktop" | "raster" | "system" | "none";

export interface PrintCapabilities {
  serial: boolean;
  bluetooth: boolean;
  native: boolean;
}

// What this device tells the host beat: absent (undefined) means "leave the
// server's last report untouched".
export type BeatPrinterReport = "connected" | "disconnected" | "unknown";

// The shell refuses every job while no printer is chosen on this PC.
export const DESKTOP_NO_PRINTER_MESSAGE = "No printer is chosen on this PC. Choose one in printer setup, then print again.";
export const DEVICE_LABEL_TABLET = "Counter tablet";
export const DEVICE_LABEL_PC = "Counter PC";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

export function printCapabilities(): PrintCapabilities {
  return { serial: serialApi() !== null, bluetooth: bluetoothApi() !== null, native: nativeBridge() !== null };
}

export function currentLane(): PrintLane {
  if (desktopShell() !== null) return "desktop";
  if (devicePrinter().getSnapshot().printer !== null) return "raster";
  // Inside the app's WebView the print window is a no-op even before its bridge arrives.
  return nativeBridge() !== null || inAppWebView() ? "none" : "system";
}

// Can a slip be printed on this device right now? A raster printer must be
// connected here — in a tab that does not own the printer it never is. The
// desktop shell prints unless it says no printer is chosen (an older shell that
// cannot say stays printable, as before).
export function canPrintNow(): boolean {
  const lane = currentLane();
  if (lane === "desktop") return desktopChosen() !== "none";
  if (lane === "system") return true;
  return lane === "raster" && devicePrinter().getSnapshot().status === "connected";
}

/** Phase 2 Session 2F1 (spec §9.2): a printer here can print right now, this device's own or (bridge v2) another of
 *  the POS app's printers. The drain asks for its lock by it, so one printer of the app that is off never stops the
 *  others; a slip with no printer of its own still needs canPrintNow(). */
export function canPrintOnAny(): boolean {
  if (canPrintNow()) return true;
  // Not by the lane (the 2E gate's review, I-2): a tablet whose only printers came through the app's list has no device
  // printer record yet, and still drains.
  return nativeBridge() !== null && nativePool().getSnapshot().printers.some((printer) => printer.status === "connected");
}

// The sentence for a print this device cannot run right now (the band's manual
// print of a waiting slip): no printer chosen in the app, the printer owned by
// another tab of this browser, or a printer that is not answering.
export function printBlockedMessage(): string {
  const lane = currentLane();
  if (lane === "none") return NO_PRINTER_MESSAGE;
  if (lane === "desktop" && desktopChosen() === "none") return DESKTOP_NO_PRINTER_MESSAGE;
  if (devicePrinter().getSnapshot().status === "elsewhere") return PRINTER_ELSEWHERE_MESSAGE;
  return PRINTER_NOT_CONNECTED_MESSAGE;
}

/** A host whose slips can never open a print window (the Windows app, or a printer on this device: the
 *  Android app's Bluetooth / USB / LAN, web serial or Bluetooth) is silent by construction, so its beat says
 *  so and the dashboard never claims "a dialog for every slip". A browser's print window may or may not be
 *  silent (kiosk printing): undefined leaves the setup card's yes/no answer in force. */
export function beatSilentMode(): true | undefined {
  const lane = currentLane();
  return lane === "desktop" || lane === "raster" ? true : undefined;
}

export function beatPrinterReport(): BeatPrinterReport | undefined {
  const lane = currentLane();
  if (lane === "desktop") return desktopChosen() === "none" ? "disconnected" : "connected";
  if (lane === "none") return "disconnected";
  if (lane !== "raster") return "unknown";
  const status = devicePrinter().getSnapshot().status;
  if (status === "elsewhere") return undefined;
  return status === "connected" ? "connected" : "disconnected";
}

export function defaultDeviceLabel(lane: PrintLane): string {
  if (lane === "desktop") return DEVICE_LABEL_PC;
  const coarse = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COARSE_POINTER_QUERY).matches;
  return lane === "none" || nativeBridge() !== null || coarse ? DEVICE_LABEL_TABLET : DEVICE_LABEL_PC;
}
