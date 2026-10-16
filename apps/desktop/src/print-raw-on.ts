// Printing Phase 4 (spec 2026-10-15 §6): printRawOn, a text slip's ESC/POS bytes to a Windows printer the page names. The
// IPC handler (print.ts) writes them through the raw spool the Direct method already uses (raw-spool.ts writeRawJob), on
// the one print queue. This module holds what is decided before a byte: the request's shape and the refusals, each one of
// the shell's own sentences (the page already reads them). Pure of electron, so node:test runs it.
import { PRINT_NOT_A_PRINTER_MESSAGE, PRINT_PRINTER_NOT_HERE_MESSAGE, PRINT_REJECTED_MESSAGE } from "./print-messages";
import { RAW_TCP_DATA_MAX_BYTES } from "./raw-tcp";
import { PRINTER_NAME_MAX_CHARS, isNonPaperPrinter, type PrintMode } from "./shared";

/** The page's request: a printer name of 1 to PRINTER_NAME_MAX_CHARS characters and 1 byte up to the raw limit, or null. */
export function rawOnRequest(name: unknown, data: unknown): { name: string; data: Uint8Array } | null {
  if (typeof name !== "string" || name.length === 0 || name.length > PRINTER_NAME_MAX_CHARS) return null;
  if (!(data instanceof Uint8Array) || data.length === 0 || data.length > RAW_TCP_DATA_MAX_BYTES) return null;
  return { name, data };
}

/** Why the slip is not written, or null: a device that writes a file, a printer Windows does not report right now (the
 *  shell's "That printer is not on this PC…", as printHtmlOn), or the Windows driver method (raw bytes go only with
 *  Direct to printer; the page offers text only then). */
export function rawOnRefusal(name: string, onThisPc: boolean, mode: PrintMode): string | null {
  if (isNonPaperPrinter(name)) return PRINT_NOT_A_PRINTER_MESSAGE;
  if (!onThisPc) return PRINT_PRINTER_NOT_HERE_MESSAGE;
  if (mode !== "direct") return PRINT_REJECTED_MESSAGE;
  return null;
}
