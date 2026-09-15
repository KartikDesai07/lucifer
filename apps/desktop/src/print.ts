// The silent-print IPC handler: renders one slip's HTML in an offscreen,
// locked-down window and sends it straight to the Windows default printer
// (or a chosen device name) with no dialog. One job runs at a time.
import { BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import {
  DATA_URL_MAX_CHARS,
  FONTS_READY_MAX_MS,
  PAINT_READY_MAX_MS,
  PRINT_CHANNEL,
  PRINT_FAILED_PREFIX,
  PRINT_FAILURE_REASON_MAX_CHARS,
  PRINT_HTML_MAX_CHARS,
  PRINT_JOB_TIMEOUT_MS,
  PRINT_PARTITION,
} from "./shared";
import { isSameOrigin } from "./server-url";
import type { Logger } from "./log";

export const PRINT_TIMEOUT_MESSAGE =
  "The printer did not answer. Check the printer and print again.";
export const PRINT_REJECTED_MESSAGE = "This print request was refused.";
export const PRINT_NO_ORIGIN_MESSAGE = "No server address is set.";
// A blank slip is never sent to the printer (owner rule 2026-09-11): a
// document with no body text, or one whose paint never arrived, is refused
// with one of these — the Windows notification and the log both carry it.
export const PRINT_EMPTY_MESSAGE = "That slip had nothing to print.";
export const PRINT_NOT_READY_MESSAGE = "The slip did not finish drawing. Print it again.";
export const PRINT_TOO_LARGE_MESSAGE = "This slip is too large to print.";
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

interface PrintHandlerDeps {
  getMainWebContentsId(): number | null;
  getOrigin(): string | null;
  getDeviceName(): string | null;
  log: Logger;
  // A rejected job in a tray-hidden window has no visible surface in the
  // renderer (its toast is inside the hidden window) — main.ts announces it.
  onJobFailed(message: string): void;
}

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// Chromium's failure reasons are short English strings ("Invalid deviceName
// provided", "Print job canceled"). Anything else is not forwarded verbatim —
// it is bounded, printable ASCII, or replaced by the generic message.
export function sanitizeFailureReason(reason: unknown): string {
  if (typeof reason !== "string") return PRINT_REJECTED_MESSAGE;
  const clean = reason.replace(/[^\x20-\x7e]/g, "").trim();
  if (clean.length === 0 || clean.length > PRINT_FAILURE_REASON_MAX_CHARS) return PRINT_REJECTED_MESSAGE;
  return PRINT_FAILED_PREFIX + clean;
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
  deviceName: string | null,
  log: Logger,
): Promise<PaintProbe> {
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

  await new Promise<void>((resolve, reject) => {
    win.webContents.print(
      {
        silent: true,
        printBackground: true,
        ...(deviceName ? { deviceName } : {}),
      },
      (ok, reason) => (ok ? resolve() : reject(new Error(sanitizeFailureReason(reason)))),
    );
  });
  return probe;
}

async function runJob(html: string, origin: string, deviceName: string | null, log: Logger): Promise<PaintProbe> {
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
      session: session.fromPartition(PRINT_PARTITION),
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  denyAllPermissions(win.webContents.session);

  // ONE deadline for the WHOLE job — load (a hanging logo or stylesheet keeps
  // the load event from ever firing), fonts, paint, and the print callback (a
  // driver that opens its own dialog never calls back). Whatever loses the
  // race, the window is destroyed and the serializer queue advances (review C1).
  let deadline: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      loadAndPrint(win, html, origin, deviceName, log),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error(PRINT_TIMEOUT_MESSAGE)), PRINT_JOB_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (deadline !== null) clearTimeout(deadline);
    if (!win.isDestroyed()) win.destroy();
  }
}

export function registerPrintHandler(deps: PrintHandlerDeps): void {
  // One print job at a time: each call chains onto this promise so a second
  // slip never opens a second offscreen window while the first is printing.
  let queue: Promise<unknown> = Promise.resolve();

  ipcMain.handle(PRINT_CHANNEL, async (event: IpcMainInvokeEvent, html: unknown) => {
    if (event.sender.id !== deps.getMainWebContentsId()) {
      throw new Error(PRINT_REJECTED_MESSAGE);
    }

    const origin = deps.getOrigin();
    if (origin === null) {
      throw new Error(PRINT_NO_ORIGIN_MESSAGE);
    }

    if (!isSameOrigin(event.senderFrame?.url ?? "", origin)) {
      throw new Error(PRINT_REJECTED_MESSAGE);
    }

    if (typeof html !== "string" || html.length === 0 || html.length > PRINT_HTML_MAX_CHARS) {
      throw new Error(PRINT_REJECTED_MESSAGE);
    }

    const deviceName = deps.getDeviceName();
    const job = queue.then(() => runJob(html, origin, deviceName, deps.log));
    // Keep the chain alive even if this job rejects, so the next print can
    // still run; the caller of ipcMain.handle still sees this job's own
    // rejection via `job` itself.
    queue = job.catch(() => undefined);

    try {
      const probe = await job;
      // What went to paper, for the field log: never the HTML itself.
      deps.log.info(
        `print job sent (${html.length} chars, ${probe.text} text chars, ${probe.sheets} stylesheets, ${probe.height}px tall, printer=${deviceName ?? "system default"})`,
      );
    } catch (error) {
      // Only curated messages leave this module: the constants above or a
      // sanitized driver reason — never a foreign string, never the HTML.
      const message = error instanceof Error ? error.message : PRINT_REJECTED_MESSAGE;
      deps.log.error(`print job failed (${html.length} chars): ${message}`);
      deps.onJobFailed(message);
      throw new Error(message);
    }
  });
}
