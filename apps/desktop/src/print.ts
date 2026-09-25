// The silent-print IPC handlers: validate the caller, decide the printer and
// the lane, run one job at a time (print-job.ts), and report the outcome to
// the log and the tray. There is no implicit "system default" printer
// (2026-09-17): printing to whatever Windows called the default sent every
// slip to a virtual device — one that swallowed it, or one that opened a
// save-file dialog on an unattended counter PC. A printer must be picked.
//
// Two lanes since 2026-09-19 (shared.ts PRINT_MODES). "direct" — the default —
// rasterizes the slip and sends RAW ESC/POS, so the paper is exactly as long
// as the slip on any PC with no driver setup. "driver" is the old
// webContents.print lane, kept as a fallback for a printer that does not
// understand ESC/POS; on it the driver's own paper form decides the length.
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { Logger } from "./log";
import { warmDirectPrint } from "./print-direct";
import { runJob, type JobResult } from "./print-job";
import {
  PRINT_NO_ORIGIN_MESSAGE,
  PRINT_NO_PRINTER_MESSAGE,
  PRINT_NOT_A_PRINTER_MESSAGE,
  PRINT_REJECTED_MESSAGE,
} from "./print-messages";
import { isSameOrigin } from "./server-url";
import {
  DEFAULT_PRINT_MODE,
  PRINT_CHANNEL,
  PRINT_HTML_MAX_CHARS,
  PRINT_MODE_SAVE_CHANNEL,
  PRINTER_NAME_MAX_CHARS,
  PRINTER_SAVE_CHANNEL,
  PRINTERS_CHANNEL,
  isNonPaperPrinter,
  isPrintMode,
  type PrintMode,
} from "./shared";

interface PrintHandlerDeps {
  getMainWebContentsId(): number | null;
  getOrigin(): string | null;
  getDeviceName(): string | null;
  // Persists the operator's printer choice; null clears it (nothing prints).
  setDeviceName(name: string | null): void;
  // null = never chosen; the handler then applies DEFAULT_PRINT_MODE.
  getPrintMode(): PrintMode | null;
  setPrintMode(mode: PrintMode): void;
  log: Logger;
  // A rejected job in a tray-hidden window has no visible surface in the
  // renderer (its toast is inside the hidden window) — main.ts announces it.
  onJobFailed(message: string): void;
}

export function registerPrintHandler(deps: PrintHandlerDeps): void {
  // One print job at a time: each call chains onto this promise so a second
  // slip never opens a second offscreen window while the first is printing.
  let queue: Promise<unknown> = Promise.resolve();

  const effectiveMode = (): PrintMode => deps.getPrintMode() ?? DEFAULT_PRINT_MODE;

  // Load the direct lane's Windows queue access now, so a broken install is
  // in the log at startup rather than at the first bill of the day.
  warmDirectPrint(deps.log);

  // Same sender + frame-origin gate every handler here uses: only the main
  // window, only a frame actually on the saved origin.
  const rejectForeignCaller = (event: IpcMainInvokeEvent): void => {
    if (event.sender.id !== deps.getMainWebContentsId()) throw new Error(PRINT_REJECTED_MESSAGE);
    const origin = deps.getOrigin();
    if (origin === null) throw new Error(PRINT_NO_ORIGIN_MESSAGE);
    if (!isSameOrigin(event.senderFrame?.url ?? "", origin)) throw new Error(PRINT_REJECTED_MESSAGE);
  };

  // The printer picker (2026-09-17). Silent printing used to go wherever
  // Windows pointed, and a counter PC whose default is "Microsoft Print to
  // PDF"/OneNote/XPS/Fax swallowed every slip with no error and no paper —
  // while the browser dialog still worked, because the operator picks the
  // printer there. Names only: never a handle, never a driver object.
  ipcMain.handle(PRINTERS_CHANNEL, async (event: IpcMainInvokeEvent) => {
    rejectForeignCaller(event);
    const printers = await event.sender.getPrintersAsync();
    // Electron's PrinterInfo carries no default flag on Windows (and `options`
    // comes back empty), so none is reported. That is no loss: the whole point
    // of the picker is to stop depending on whichever device Windows calls the
    // default. `name` is what Chromium's deviceName matches on; `displayName`
    // is only what the operator reads. `printMode` is the EFFECTIVE lane.
    return {
      selected: deps.getDeviceName(),
      printers: printers.map((p) => ({ name: p.name, displayName: p.displayName })),
      printMode: effectiveMode(),
    };
  });

  ipcMain.handle(PRINTER_SAVE_CHANNEL, async (event: IpcMainInvokeEvent, name: unknown) => {
    rejectForeignCaller(event);
    // null clears the choice; nothing prints until a printer is picked again.
    if (name === null) {
      deps.setDeviceName(null);
      deps.log.info("printer choice cleared — nothing prints until a printer is picked");
      return { selected: null };
    }
    if (typeof name !== "string" || name.length === 0 || name.length > PRINTER_NAME_MAX_CHARS) {
      throw new Error(PRINT_REJECTED_MESSAGE);
    }
    // Only a device Windows actually reports may be stored: a stored name that
    // matches no printer makes Chromium fail every job with "Invalid deviceName
    // provided", which is a worse failure than the default it replaced.
    const printers = await event.sender.getPrintersAsync();
    if (!printers.some((p) => p.name === name)) throw new Error(PRINT_REJECTED_MESSAGE);
    deps.setDeviceName(name);
    deps.log.info(`printer choice saved (${printers.length} devices available)`);
    return { selected: name };
  });

  // The print method (2026-09-19). Only the two known modes are accepted; the
  // saved value is echoed back so the picker shows what actually stuck.
  ipcMain.handle(PRINT_MODE_SAVE_CHANNEL, async (event: IpcMainInvokeEvent, mode: unknown) => {
    rejectForeignCaller(event);
    if (!isPrintMode(mode)) throw new Error(PRINT_REJECTED_MESSAGE);
    deps.setPrintMode(mode);
    deps.log.info(`print method saved: ${mode}`);
    return { printMode: mode };
  });

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

    // The printer is decided BEFORE any window opens: an unchosen or
    // file-writing device must fail loudly, not silently eat the slip. No
    // implicit "system default" any more — that default WAS the bug. These
    // two refusals go through the SAME job promise as every other failure, so
    // they reach the tray notification and the log; thrown straight from here
    // they would bypass the catch below and the operator would see nothing —
    // which is the exact silence this whole fix exists to remove.
    const chosen = deps.getDeviceName();
    const refusal =
      chosen === null || chosen.length === 0
        ? PRINT_NO_PRINTER_MESSAGE
        : isNonPaperPrinter(chosen)
          ? PRINT_NOT_A_PRINTER_MESSAGE
          : null;
    // `chosen` is a real, printable device on this branch — the refusal above
    // is the only way past the two null/virtual cases.
    const deviceName = chosen ?? "";
    // Read once per job, so a mode saved mid-queue applies from the next slip.
    const mode = effectiveMode();

    const job =
      refusal !== null
        ? queue.then((): JobResult => {
            throw new Error(refusal);
          })
        : queue.then(() => runJob(html, origin, deviceName, mode, deps.log));
    // Keep the chain alive even if this job rejects, so the next print can
    // still run; the caller of ipcMain.handle still sees this job's own
    // rejection via `job` itself.
    queue = job.catch(() => undefined);

    try {
      const { probe, page } = await job;
      // What went to paper, for the field log: never the HTML itself. The
      // PAGE GEOMETRY is recorded too, not just the content height — when a
      // slip comes out too long that is the only number that settles it, and
      // inferring it from px is how two rounds of this were lost (2026-09-19).
      deps.log.info(
        `print job sent (${html.length} chars, ${probe.text} text chars, ${probe.sheets} stylesheets, ${probe.height}px tall, mode=${mode}, page=${page}, printer=${deviceName})`,
      );
    } catch (error) {
      // Only curated messages leave this module: the constants in
      // print-messages.ts, a sanitized driver reason, or the spooler's own
      // curated sentence — never a foreign string, never the HTML.
      const message = error instanceof Error ? error.message : PRINT_REJECTED_MESSAGE;
      deps.log.error(`print job failed (${html.length} chars, mode=${mode}): ${message}`);
      deps.onJobFailed(message);
      throw new Error(message);
    }
  });
}
