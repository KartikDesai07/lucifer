// The DIRECT print lane (2026-09-19, the default): the drawn slip is
// rasterized inside the shell's own Chromium and sent to the Windows print
// queue as RAW ESC/POS bytes. The printer then advances exactly as far as the
// ink goes and cuts — the driver, its paper form and its margins are out of
// the loop entirely, so the paper length follows the content on ANY PC with
// no per-client driver setup (owner requirement: "jitna content utni size",
// dynamic, no scripts, no fixed height).
//
// Why a whole second lane exists. MEASURED on the counter PC's POS80: the
// driver lane (print-driver.ts) hands Chromium's requested page size to the
// driver and the driver prefers its own configured form. A 4cm test slip came
// out on a 297mm page; earlier a 32-item bill was cut short on a Letter form
// and the rest was lost. No value the app can pass changes that. A thermal
// receipt printer is, underneath every driver, an ESC/POS device that prints
// a bitmap exactly as tall as the bitmap — so the shell draws the bitmap.
//
// How the pixels are made — every step below was probed in Electron 44.2.0 on
// Windows before it was written down here:
//   · The slip is drawn in an OFFSCREEN window. A hidden on-screen window
//     never produces the frame a screenshot needs (the screenshot call hung);
//     an offscreen one paints on its own and reports devicePixelRatio 1.
//   · Print media is emulated over the DevTools protocol so `@media print`
//     rules apply exactly as they do in a browser print.
//   · The device scale factor is set to (printer dots ÷ slip CSS width): a
//     300px slip on a 576-dot head renders at 1.92 device px per CSS px, so
//     the screenshot is exactly 576 px wide WHATEVER the PC's display scaling
//     is. (`capturePage` returns DIP × OS scale instead — 720 px on a 125%
//     display — which is why the protocol screenshot is used.)
//   · `captureBeyondViewport` returns the whole slip in one image: a 400-item
//     bill produced 576 × 14243 px in under a second.
// The bitmap then becomes 1-bit rows (escpos.ts) and goes to the queue with
// datatype RAW (raw-spool.ts) — bytes the spooler passes straight to the port.
import { nativeImage, type BrowserWindow } from "electron";
import { DOTS_58MM, RASTER_MAX_ROWS, dotsForPaperWidth, escposJob, rasterLabel, rasterizeBgra } from "./escpos";
import type { Logger } from "./log";
import { pageWidthMicronsOf } from "./print-driver";
import {
  PRINT_EMPTY_MESSAGE,
  PRINT_NOT_READY_MESSAGE,
  PRINT_TOO_LARGE_MESSAGE,
  sanitizeFailureReason,
} from "./print-messages";
import { SPOOL_UNAVAILABLE_MESSAGE, loadSpooler, writeRawJob } from "./raw-spool";

// The document name Windows shows in the queue for every slip.
export const PRINT_DOC_NAME = "POS slip";
const CDP_PROTOCOL_VERSION = "1.3";
const CDP_MEDIA_PRINT = "print";
const CDP_SCREENSHOT_FORMAT = "png";
// The slip's own CSS width is MEASURED from the drawn document (the cafe's
// receipt root is a fixed-width block: 300px for 80mm paper, 210px for 58mm —
// apps/cafe/lib/print.ts PAPER_WIDTH_CLASS, parity-pinned). These bounds catch
// a document with no fixed-width root; the fallback then assumes the cafe's
// own widths so the text still lands at the size the browser lane printed.
const SLIP_CSS_PX_MIN = 120;
const SLIP_CSS_PX_MAX = 800;
export const SLIP_CSS_PX_DEFAULT_80MM = 300;
export const SLIP_CSS_PX_DEFAULT_58MM = 210;

// Two animation frames after the emulation changes: proof that layout re-ran
// at the new scale before the screenshot is taken (same idiom as the paint
// probe in print-job.ts).
const FRAMES_SCRIPT = "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))";
// The slip's box in CSS px: the body's first element is the receipt root
// (react-to-print clones exactly that node into the print document's body).
// Height takes the larger of the body's scroll height and the root's bottom,
// so nothing below the root is ever cut off.
const SLIP_RECT_SCRIPT =
  "(() => { const el = document.body ? document.body.firstElementChild : null; const r = el ? el.getBoundingClientRect() : null; return { width: r ? r.width : 0, height: Math.max(document.body ? document.body.scrollHeight : 0, r ? Math.ceil(r.bottom) : 0) }; })()";

interface SlipRect {
  width: number;
  height: number;
}

function isSlipRect(value: unknown): value is SlipRect {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return typeof o.width === "number" && typeof o.height === "number";
}

/** The measured slip width when it is plausible, else the cafe's own default for this paper. */
export function usableSlipCssWidth(measured: number, dots: number): number {
  if (Number.isFinite(measured) && measured >= SLIP_CSS_PX_MIN && measured <= SLIP_CSS_PX_MAX) return measured;
  return dots === DOTS_58MM ? SLIP_CSS_PX_DEFAULT_58MM : SLIP_CSS_PX_DEFAULT_80MM;
}

/**
 * Loads the Windows print-queue access once at startup so a broken install
 * is logged when the app starts, not discovered at the first slip. Never
 * throws: the per-job path reports its own failure to the operator.
 */
export function warmDirectPrint(log: Logger): void {
  try {
    loadSpooler();
    log.info("direct print: Windows print queue access ready");
  } catch (error) {
    log.error(`direct print unavailable: ${error instanceof Error ? error.message : SPOOL_UNAVAILABLE_MESSAGE}`);
  }
}

async function measureSlip(win: BrowserWindow): Promise<SlipRect> {
  const rect: unknown = await win.webContents.executeJavaScript(SLIP_RECT_SCRIPT);
  if (!isSlipRect(rect)) throw new Error(PRINT_NOT_READY_MESSAGE);
  return rect;
}

async function screenshotSlip(win: BrowserWindow, dots: number): Promise<Buffer> {
  const dbg = win.webContents.debugger;
  dbg.attach(CDP_PROTOCOL_VERSION);
  try {
    await dbg.sendCommand("Emulation.setEmulatedMedia", { media: CDP_MEDIA_PRINT });
    const first = await measureSlip(win);
    const cssWidth = usableSlipCssWidth(first.width, dots);
    // dots per CSS px — the whole point: the bitmap comes out `dots` wide.
    const deviceScaleFactor = dots / cssWidth;
    // Refuse a slip that would outgrow one screenshot BEFORE asking for it:
    // the compositor rejects captures past ~16k device px (measured), and a
    // slip that long is not a bill anyone printed on purpose.
    if (Math.ceil(first.height * deviceScaleFactor) > RASTER_MAX_ROWS) throw new Error(PRINT_TOO_LARGE_MESSAGE);
    await dbg.sendCommand("Emulation.setDeviceMetricsOverride", {
      width: Math.ceil(cssWidth),
      height: Math.ceil(first.height),
      deviceScaleFactor,
      mobile: false,
    });
    await win.webContents.executeJavaScript(FRAMES_SCRIPT);
    const rect = await measureSlip(win);
    const shot: unknown = await dbg.sendCommand("Page.captureScreenshot", {
      format: CDP_SCREENSHOT_FORMAT,
      captureBeyondViewport: true,
      fromSurface: true,
      clip: { x: 0, y: 0, width: cssWidth, height: rect.height, scale: 1 },
    });
    const data = typeof shot === "object" && shot !== null ? (shot as Record<string, unknown>).data : undefined;
    if (typeof data !== "string" || data.length === 0) throw new Error(PRINT_NOT_READY_MESSAGE);
    return Buffer.from(data, "base64");
  } finally {
    if (dbg.isAttached()) dbg.detach();
  }
}

// The messages this lane may surface itself; anything else that escapes the
// screenshot step is Chromium's own wording and is NOT forwarded — it is
// logged (bounded, printable) and the operator sees the not-ready sentence.
const OWN_MESSAGES: ReadonlySet<string> = new Set([PRINT_EMPTY_MESSAGE, PRINT_NOT_READY_MESSAGE, PRINT_TOO_LARGE_MESSAGE]);

/**
 * Rasterizes the already-drawn slip and sends it RAW to `deviceName`.
 * Resolves with the raster label for the field log ("576x1321 dots (~165mm)").
 */
export async function printDirect(win: BrowserWindow, html: string, deviceName: string, log: Logger): Promise<string> {
  const dots = dotsForPaperWidth(pageWidthMicronsOf(html));
  let png: Buffer;
  try {
    png = await screenshotSlip(win, dots);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (OWN_MESSAGES.has(reason)) throw error;
    log.error(`print job (${html.length} chars): the slip screenshot failed — ${sanitizeFailureReason(reason)}`);
    throw new Error(PRINT_NOT_READY_MESSAGE);
  }
  const image = nativeImage.createFromBuffer(png);
  const { width, height } = image.getSize();
  // NativeImage.toBitmap() is BGRA, 4 bytes per pixel, row-major.
  const raster = rasterizeBgra(new Uint8Array(image.toBitmap()), width, height, dots);
  // The ink fence, again, on the pixels themselves: a document with text but
  // no visible ink (white-on-white) must not feed blank paper.
  if (raster.rows === 0) throw new Error(PRINT_EMPTY_MESSAGE);
  // Never feed blind: a slip past this length is refused, not sent.
  if (raster.rows > RASTER_MAX_ROWS) throw new Error(PRINT_TOO_LARGE_MESSAGE);
  writeRawJob(deviceName, PRINT_DOC_NAME, escposJob(raster));
  return rasterLabel(raster);
}
