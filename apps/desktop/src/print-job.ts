// One print job: draws the slip's HTML in a locked-down offscreen window,
// proves it painted (never print blank — owner rule 2026-09-11), then hands
// it to the chosen lane: direct ESC/POS (print-direct.ts, the default) or the
// Windows driver (print-driver.ts, the fallback). The IPC handler in print.ts
// decides the printer and the mode BEFORE this runs; this file never reads
// the store and never logs the HTML.
import { BrowserWindow, session } from "electron";
import type { Logger } from "./log";
import { printDirect } from "./print-direct";
import { pageLabelOf, printThroughDriver } from "./print-driver";
import { PRINT_EMPTY_MESSAGE, PRINT_NOT_READY_MESSAGE, PRINT_TIMEOUT_MESSAGE, PRINT_TOO_LARGE_MESSAGE } from "./print-messages";
import {
  DATA_URL_MAX_CHARS,
  FONTS_READY_MAX_MS,
  PAINT_READY_MAX_MS,
  PRINT_JOB_TIMEOUT_MS,
  PRINT_PARTITION,
  type PrintMode,
} from "./shared";

export const FONTS_READY_SCRIPT = "document.fonts.ready.then(() => true)";
// What the drawn document looks like: body text length, body height and the
// number of stylesheets that applied. The paint variant waits two animation
// frames first (a frame having been produced is the proof that layout ran —
// electron/electron#22379 and #43235: printing straight after a load races the
// renderer and prints blank); the direct variant is the fallback probe.
const PROBE_EXPRESSION =
  '({ text: (document.body ? document.body.innerText : "").trim().length, height: document.body ? document.body.scrollHeight : 0, sheets: document.styleSheets.length })';
export const PAINT_READY_SCRIPT =
  `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() => ${PROBE_EXPRESSION})`;
export const PAINT_PROBE_SCRIPT = PROBE_EXPRESSION;

export interface PaintProbe {
  text: number;
  height: number;
  sheets: number;
}

export function isPaintProbe(value: unknown): value is PaintProbe {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return typeof o.text === "number" && typeof o.height === "number" && typeof o.sheets === "number";
}

/** What the handler logs about a sent job: the probe, and the page the printer was given. */
export interface JobResult {
  probe: PaintProbe;
  // "576x1321 dots (~165mm)" on the direct lane, "80x36mm" on the driver lane.
  page: string;
}

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function denyAllPermissions(ses: Electron.Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);
}

async function loadAndPrint(
  win: BrowserWindow,
  html: string,
  origin: string,
  deviceName: string,
  mode: PrintMode,
  log: Logger,
): Promise<JobResult> {
  const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  if (dataUrl.length > DATA_URL_MAX_CHARS) throw new Error(PRINT_TOO_LARGE_MESSAGE);
  await win.loadURL(dataUrl, { baseURLForDataURL: origin + "/" });

  const fontsReady: unknown = await Promise.race([
    win.webContents.executeJavaScript(FONTS_READY_SCRIPT),
    delay(FONTS_READY_MAX_MS, false),
  ]);
  if (fontsReady !== true) log.info(`print job (${html.length} chars): fonts did not settle in time, printing with fallback fonts`);

  // Proof of a drawn slip, then the blank fence — never print an empty body.
  let probe: unknown = await Promise.race([
    win.webContents.executeJavaScript(PAINT_READY_SCRIPT),
    delay(PAINT_READY_MAX_MS, null),
  ]);
  if (probe === null) {
    log.info(`print job (${html.length} chars): paint frames did not arrive in time, probing the document directly`);
    probe = await win.webContents.executeJavaScript(PAINT_PROBE_SCRIPT);
  }
  if (!isPaintProbe(probe)) throw new Error(PRINT_NOT_READY_MESSAGE);
  if (probe.text === 0) throw new Error(PRINT_EMPTY_MESSAGE);

  // The lane. Exactly one of the two runs; both receive the SAME drawn
  // document, so a slip that prints right through one prints right through
  // the other except for the paper length the driver imposes.
  if (mode === "driver") {
    await printThroughDriver(win, html, probe, deviceName, log);
    return { probe, page: pageLabelOf(html, probe.height) };
  }
  const page = await printDirect(win, html, deviceName, log);
  return { probe, page };
}

export async function runJob(
  html: string,
  origin: string,
  deviceName: string,
  mode: PrintMode,
  log: Logger,
): Promise<JobResult> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      javascript: true,
      // A hidden window is a "background" page to Chromium: its timers and
      // animation frames are throttled unless this is off (the main window
      // sets it too). The paint probe above depends on frames arriving.
      backgroundThrottling: false,
      // The direct lane screenshots the page over the DevTools protocol, and
      // only an OFFSCREEN window paints frames while hidden (measured: the
      // same call on a hidden on-screen window never returned). The driver
      // lane prints through Chromium's own print path and needs no frames.
      offscreen: mode === "direct",
      session: session.fromPartition(PRINT_PARTITION),
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  denyAllPermissions(win.webContents.session);

  // ONE deadline for the WHOLE job — load (a hanging logo or stylesheet keeps
  // the load event from ever firing), fonts, paint, and the print itself (a
  // driver that opens its own dialog never calls back; a screenshot that
  // never arrives). Whatever loses the race, the window is destroyed and the
  // serializer queue advances (review C1).
  let deadline: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      loadAndPrint(win, html, origin, deviceName, mode, log),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error(PRINT_TIMEOUT_MESSAGE)), PRINT_JOB_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (deadline !== null) clearTimeout(deadline);
    if (!win.isDestroyed()) win.destroy();
  }
}
