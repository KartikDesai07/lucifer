// Phase 3 Session 3E (spec §9.6): the IPC side of a network printer. The page sends the slip's ESC/POS bytes (the same
// bytes the POS app sends) and the printer's address; this checks the caller like every print channel here (only the
// main window, only a frame on the saved origin, a sane address and size), then writes them over raw TCP (raw-tcp.ts).
// It answers with a plain result, never a thrown error, so the page reads "no" (nothing sent) and "maybe" exactly: a
// thrown IPC error reaches the page wrapped in Electron's own words. The idle check (lanStatus) asks each network
// printer the page prints whether it answers, and what it says of its paper, cover and errors: a local check, no request.
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { Logger } from "./log";
import { PRINT_REJECTED_MESSAGE } from "./print-messages";
import { RAW_TCP_DATA_MAX_BYTES, RawTcpError, keyOf, printRawTcp, probeRawTcp, validTarget, type RawTcpFailure, type RawTcpHealth, type RawTcpTarget } from "./raw-tcp";
import { isSameOrigin } from "./server-url";
import { LAN_STATUS_CHANNEL, LAN_STATUS_MAX_PRINTERS, PRINT_RAW_CHANNEL } from "./shared";

/** What one raw print answers: printed (with what the printer said of itself), or not, and whether any byte went out. */
export type RawPrintResult =
  | { ok: true; health: RawTcpHealth | null }
  | { ok: false; sent: "no" | "maybe"; failure: RawTcpFailure; message: string; health: RawTcpHealth | null };

/** One network printer's idle check; `link` null: a job holds it now (its own answer says it). */
export interface LanStatus {
  host: string;
  port: number;
  link: "connected" | "disconnected" | null;
  health: RawTcpHealth | null;
}

interface RawPrintDeps {
  getMainWebContentsId(): number | null;
  getOrigin(): string | null;
  log: Logger;
  // A failed slip in a tray-hidden window has no visible surface (its toast is inside the hidden window).
  onJobFailed(message: string): void;
}

export function registerRawPrintHandler(deps: RawPrintDeps): void {
  // The same gate every print channel uses: only the main window, only a frame actually on the saved origin.
  const rejectForeignCaller = (event: IpcMainInvokeEvent): void => {
    if (event.sender.id !== deps.getMainWebContentsId()) throw new Error(PRINT_REJECTED_MESSAGE);
    const origin = deps.getOrigin();
    if (origin === null || !isSameOrigin(event.senderFrame?.url ?? "", origin)) throw new Error(PRINT_REJECTED_MESSAGE);
  };

  ipcMain.handle(PRINT_RAW_CHANNEL, async (event: IpcMainInvokeEvent, printer: unknown, data: unknown): Promise<RawPrintResult> => {
    rejectForeignCaller(event);
    if (!validTarget(printer)) throw new Error(PRINT_REJECTED_MESSAGE);
    if (!(data instanceof Uint8Array) || data.length === 0 || data.length > RAW_TCP_DATA_MAX_BYTES) throw new Error(PRINT_REJECTED_MESSAGE);
    const target: RawTcpTarget = { host: printer.host, port: printer.port };
    try {
      const { health } = await printRawTcp(target, data);
      // What went to paper, for the field log: never the bytes themselves.
      deps.log.info(`raw print sent (${data.length} bytes, printer=${keyOf(target)})`);
      return { ok: true, health };
    } catch (error) {
      const failed = error instanceof RawTcpError ? error : new RawTcpError(PRINT_REJECTED_MESSAGE, "write-failed");
      deps.log.error(`raw print failed (${data.length} bytes, printer=${keyOf(target)}, sent=${failed.sent}): ${failed.message}`);
      deps.onJobFailed(`Network printer ${target.host}: ${failed.message}`);
      return { ok: false, sent: failed.sent, failure: failed.failure, message: failed.message, health: failed.health };
    }
  });

  ipcMain.handle(LAN_STATUS_CHANNEL, async (event: IpcMainInvokeEvent, printers: unknown): Promise<LanStatus[]> => {
    rejectForeignCaller(event);
    if (!Array.isArray(printers) || printers.length > LAN_STATUS_MAX_PRINTERS || !printers.every(validTarget)) throw new Error(PRINT_REJECTED_MESSAGE);
    return Promise.all(
      printers.map(async (printer: RawTcpTarget): Promise<LanStatus> => {
        const status = await probeRawTcp({ host: printer.host, port: printer.port });
        return { host: printer.host, port: printer.port, link: status?.link ?? null, health: status?.health ?? null };
      }),
    );
  });
}
