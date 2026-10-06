import type { UseReactToPrintOptions } from "react-to-print";
import { toast } from "sonner";

import { DESKTOP_PRINT_EMPTY_MESSAGE } from "@/lib/desktop-shell-document";
import type { PaperWidth } from "@/lib/constants";
import { inAppWebView, rasterCapable } from "@/lib/printer/capabilities";
import { devicePrinter } from "@/lib/printer/device-printer";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import { RASTER_MAX_ROWS, dotsForPaper, escposJob, rasterizeRgba } from "@/lib/printer/escpos";
import { nativeBridge, nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_ERROR_CODES } from "@/lib/printer/native-bridge-protocol";
import {
  RASTER_FAILED_MESSAGE,
  RASTER_TOO_LARGE_MESSAGE,
  rasterizePrintIframe,
  type RasterPixels,
} from "@/lib/printer/raster";
import { printerWriter } from "@/lib/printer/printer-registry";
import { nativeErrorMessage } from "@/lib/printer/transport-native";
import {
  PRINTER_ELSEWHERE_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_TOO_LARGE_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
} from "@/lib/printer/web-printer-types";

// The lane half of the print seam. lib/desktop-shell.ts hands every slip
// options object here when no desktop shell is present; this file decides, AT
// CALL TIME, how the slip leaves THIS device:
//   a saved device printer -> rasterize the drawn slip, encode ESC/POS, write it
//   the POS app with no printer -> fail loud (a print window would do nothing)
//   anything else -> the browser print window, exactly as react-to-print does
// A plain desktop browser (no printer API at all) gets the SAME options object
// back, untouched. This file must never import the desktop-shell seam (that
// import runs the other way) nor print-lane.ts (which imports the seam).

/** react-to-print's own default branch waits this long before it reports done. */
export const SYSTEM_PRINT_SETTLE_MS = 500;
/** ONE deadline over the slip drawing (asset fetch + decode can reach 18 s alone). */
export const LANE_RASTER_DEADLINE_MS = 12_000;

export const NO_PRINTER_MESSAGE = "No printer is set up on this device. Tap the printer icon to set one up.";

/** Phase 2 Session 2F1 (spec §9.2): a printer job for one of the POS app's printers, by the app's id: drawn at that
 *  printer's paper and written to it (the device's own printer, or another of the app's printers on bridge v2). */
export interface RasterPrintTarget {
  nativeId: string;
  paper: PaperWidth;
}
export const LANE_PRINT_FAILED_MESSAGE = "Could not print the slip. Check the printer, then print it again.";

// Every sentence this lane (or the device printer under it) may show an
// operator. Anything else is an internal error text and never reaches a toast.
const LANE_MESSAGES: ReadonlySet<string> = new Set([
  NO_PRINTER_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
  PRINTER_ELSEWHERE_MESSAGE,
  PRINTER_TOO_LARGE_MESSAGE,
  RASTER_FAILED_MESSAGE,
  RASTER_TOO_LARGE_MESSAGE,
  DESKTOP_PRINT_EMPTY_MESSAGE,
  // Every sentence the app-bridge error mapper can produce.
  ...NATIVE_ERROR_CODES.map((code) => nativeErrorMessage(nativeError(code, code))),
]);

/** The operator-safe sentence for a lane failure, or null for any other error. */
export function laneFailureMessage(error: unknown): string | null {
  return error instanceof Error && LANE_MESSAGES.has(error.message) ? error.message : null;
}

// Test seams: the real toast, the real timers, the real slip drawing.
export type LaneRasterizer = (iframe: HTMLIFrameElement, dots: number) => Promise<RasterPixels>;
const defaultRasterizer: LaneRasterizer = (iframe, dots) => rasterizePrintIframe(iframe, dots);
let laneToast: (message: string) => void = (message) => toast.error(message);
let laneSleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let laneRasterizer: LaneRasterizer = defaultRasterizer;

export function setLaneToast(fn: (message: string) => void): void {
  laneToast = fn;
}
export function setLaneSleep(fn: (ms: number) => Promise<void>): void {
  laneSleep = fn;
}
export function setLaneRasterizer(fn: LaneRasterizer | null): void {
  laneRasterizer = fn ?? defaultRasterizer;
}

function titleOf(documentTitle: UseReactToPrintOptions["documentTitle"]): string | undefined {
  return typeof documentTitle === "function" ? documentTitle() : documentTitle;
}

// The library's own default branch (react-to-print 3.3.0): swap the page and
// frame titles, open the print window, put the titles back, then wait. print()
// runs in THIS task (react-to-print dispatches from a timer): nothing may be
// awaited before it. It BLOCKS while the dialog is open on a desktop browser, and
// there it has already waited long enough; only a print() that came straight back
// (a phone's non-blocking sheet) is followed by the settle wait. Timed, never
// guessed from the browser's identity.
async function systemPrint(iframe: HTMLIFrameElement, title: string | undefined): Promise<void> {
  const frameDoc = iframe.contentDocument;
  const frameTitle = frameDoc?.title ?? "";
  const pageTitle = iframe.ownerDocument.title;
  if (title) {
    iframe.ownerDocument.title = title;
    if (frameDoc) frameDoc.title = title;
  }
  let blocked = false;
  try {
    const startedAt = performance.now();
    iframe.contentWindow?.print();
    blocked = performance.now() - startedAt >= SYSTEM_PRINT_SETTLE_MS;
  } finally {
    if (title) {
      iframe.ownerDocument.title = pageTitle;
      if (frameDoc) frameDoc.title = frameTitle;
    }
  }
  if (!blocked) await laneSleep(SYSTEM_PRINT_SETTLE_MS);
}

// The slip drawing under its one deadline; a late result is simply dropped.
async function drawSlip(iframe: HTMLIFrameElement, dots: number): Promise<RasterPixels> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(RASTER_FAILED_MESSAGE)), LANE_RASTER_DEADLINE_MS);
  });
  try {
    return await Promise.race([laneRasterizer(iframe, dots), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function rasterPrint(iframe: HTMLIFrameElement, printer: Pick<DevicePrinter, "paper">, nativeId?: string): Promise<void> {
  const dots = dotsForPaper(printer.paper);
  const drawn = await drawSlip(iframe, dots);
  const bitmap = rasterizeRgba(drawn.pixels, drawn.width, drawn.height, dots);
  // No ink at all is a blank slip; never feed blank paper (owner rule 2026-09-11).
  if (bitmap.rows === 0) throw new Error(DESKTOP_PRINT_EMPTY_MESSAGE);
  if (bitmap.rows > RASTER_MAX_ROWS) throw new Error(RASTER_TOO_LARGE_MESSAGE);
  // Phase 2 Session 2F1: a printer job names its printer (the app's id); every other slip goes to this device's own.
  if (nativeId !== undefined) return printerWriter(nativeId)(escposJob(bitmap));
  await devicePrinter().write(escposJob(bitmap));
}

// Decided when the slip prints, never when the options were built: a printer
// set up (or a bridge that arrives) after the render is picked up by the next job.
async function lanePrint(iframe: HTMLIFrameElement, documentTitle: UseReactToPrintOptions["documentTitle"]): Promise<void> {
  const snapshot = devicePrinter().getSnapshot();
  if (snapshot.printer !== null) {
    if (snapshot.status === "elsewhere") throw new Error(PRINTER_ELSEWHERE_MESSAGE);
    return rasterPrint(iframe, snapshot.printer);
  }
  if (nativeBridge() !== null || inAppWebView()) throw new Error(NO_PRINTER_MESSAGE);
  return systemPrint(iframe, titleOf(documentTitle));
}

// Same contract as the shell's default handler: react-to-print never calls
// onAfterPrint on its own error path, so every caller's bookkeeping (busy
// flags, the host bridge's window) would wedge without it.
function laneOnPrintError(
  options: UseReactToPrintOptions,
): (errorLocation: "onBeforePrint" | "print", error: Error) => void {
  return (_errorLocation, error) => {
    laneToast(laneFailureMessage(error) ?? LANE_PRINT_FAILED_MESSAGE);
    options.onAfterPrint?.();
  };
}

/**
 * Wraps a useReactToPrint options object for the no-shell case: the SAME
 * reference when this runtime has no way to reach a printer other than the
 * print window; otherwise a copy whose `print` picks the lane per job. Phase 2
 * Session 2F1: a printer job for one of the POS app's printers prints there.
 */
export function laneSlipPrintOptions<T extends UseReactToPrintOptions>(options: T, raster?: RasterPrintTarget): T {
  if (!rasterCapable()) return options;
  return {
    ...options,
    print: (iframe: HTMLIFrameElement) => (raster === undefined ? lanePrint(iframe, options.documentTitle) : rasterPrint(iframe, raster, raster.nativeId)),
    onPrintError: options.onPrintError ?? laneOnPrintError(options),
  };
}
