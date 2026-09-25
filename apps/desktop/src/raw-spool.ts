// RAW Windows spooler access via koffi (prebuilt N-API FFI, no compile step).
//
// Why: a silent print went through Electron's normal print path, which hands
// the page to the GDI driver (e.g. POS80). That driver ignores the app's page
// size and prints on its OWN fixed form -- a 4cm slip came out on the
// driver's 297mm form. winspool.drv's RAW datatype bypasses the driver
// entirely: OpenPrinterW -> StartDocPrinterW(pDatatype: "RAW") ->
// StartPagePrinter -> WritePrinter (the caller's ESC/POS bytes, unchanged) ->
// EndPagePrinter -> EndDocPrinter -> ClosePrinter. RAW makes the print
// processor pass the bytes straight to the port monitor, so the paper fed is
// exactly as long as the ink on it.
//
// No electron import: this must stay loadable under plain `node` for
// standalone probes, and so the unit test can pin its source text without
// importing it (which would load the native module in the test process).
// koffi itself is required lazily inside loadSpooler() -- a top-level import
// would load the native .node module the instant print.ts (which imports
// this file) is loaded, including under node --import tsx --test.
import type Koffi from "koffi"; // type-only: erased at runtime, no native load

export const RAW_SPOOL_DATATYPE = "RAW";
export const RAW_SPOOL_CHUNK_BYTES = 64 * 1024;
export const WIN32_ERROR_ACCESS_DENIED = 5;
export const WIN32_ERROR_INVALID_PRINTER_NAME = 1801;

// Curated, plain-English, period-terminated messages -- these reach the tray
// notification and the log file, never a raw Win32 error string.
export const SPOOL_UNAVAILABLE_MESSAGE =
  "Direct printing is not available on this PC. Open Settings, then Printing, and choose the Windows driver method.";
export const SPOOL_PRINTER_NOT_FOUND_MESSAGE =
  "The chosen printer was not found on this PC. Open Settings, then Printing, and pick it again.";
export const SPOOL_ACCESS_DENIED_MESSAGE = "Windows did not allow printing to the chosen printer.";
export const SPOOL_FAILED_PREFIX = "Printing failed: Windows error ";
export const SPOOL_SHORT_WRITE_MESSAGE = "Printing failed: the printer queue did not accept the whole slip.";

const PRINTER_NAME_MAX_CHARS = 256;

// Narrow shapes for the koffi handles below -- koffi.func() returns a
// loosely-typed callable, so each handle is annotated with the exact
// signature it is called with instead of leaking that looseness.
type HandleFn = (hPrinter: unknown) => boolean;
type DocInfo1W = { pDocName: string; pOutputFile: null; pDatatype: string };

interface Spooler {
  OpenPrinterW: (name: string, phPrinter: [unknown], pDefault: null) => boolean;
  StartDocPrinterW: (hPrinter: unknown, level: number, docInfo: DocInfo1W) => number;
  StartPagePrinter: HandleFn;
  WritePrinter: (hPrinter: unknown, buf: Buffer, cbBuf: number, pcWritten: [number]) => boolean;
  EndPagePrinter: HandleFn;
  EndDocPrinter: HandleFn;
  AbortPrinter: HandleFn;
  ClosePrinter: HandleFn;
  GetLastError: () => number;
}

let spooler: Spooler | null = null;

/**
 * Loads koffi + winspool.drv/kernel32.dll ONCE (lazy, memoised). Callers use
 * this eagerly at startup so a broken install (missing native module, wrong
 * platform) is logged before the first slip is attempted, not at it.
 */
export function loadSpooler(): void {
  if (spooler !== null) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded on first use so node:test never loads the native module
    const koffi = require("koffi") as typeof Koffi;
    const winspool = koffi.load("winspool.drv");
    const kernel32 = koffi.load("kernel32.dll");
    // Registered by name -- referenced as "DOC_INFO_1W *pDocInfo" below.
    koffi.struct("DOC_INFO_1W", { pDocName: "str16", pOutputFile: "str16", pDatatype: "str16" });
    // koffi.func() returns a loosely-typed callable; cast once, here, to the
    // narrow Spooler shape instead of leaking that looseness through the file.
    spooler = {
      OpenPrinterW: winspool.func(
        "bool __stdcall OpenPrinterW(const char16_t *pPrinterName, _Out_ void **phPrinter, void *pDefault)",
      ),
      StartDocPrinterW: winspool.func(
        "uint32 __stdcall StartDocPrinterW(void *hPrinter, uint32 Level, DOC_INFO_1W *pDocInfo)",
      ),
      StartPagePrinter: winspool.func("bool __stdcall StartPagePrinter(void *hPrinter)"),
      WritePrinter: winspool.func(
        "bool __stdcall WritePrinter(void *hPrinter, const void *pBuf, uint32 cbBuf, _Out_ uint32 *pcWritten)",
      ),
      EndPagePrinter: winspool.func("bool __stdcall EndPagePrinter(void *hPrinter)"),
      EndDocPrinter: winspool.func("bool __stdcall EndDocPrinter(void *hPrinter)"),
      AbortPrinter: winspool.func("bool __stdcall AbortPrinter(void *hPrinter)"),
      ClosePrinter: winspool.func("bool __stdcall ClosePrinter(void *hPrinter)"),
      GetLastError: kernel32.func("uint32 __stdcall GetLastError()"),
    } as unknown as Spooler;
  } catch {
    spooler = null;
    throw new Error(SPOOL_UNAVAILABLE_MESSAGE);
  }
}

/** Maps a Win32 error code to a curated, plain-English message. */
function messageForWin32(code: number): string {
  if (code === WIN32_ERROR_INVALID_PRINTER_NAME) return SPOOL_PRINTER_NOT_FOUND_MESSAGE;
  if (code === WIN32_ERROR_ACCESS_DENIED) return SPOOL_ACCESS_DENIED_MESSAGE;
  return `${SPOOL_FAILED_PREFIX}${code}`;
}

/**
 * Synchronous. Sends `data` as ONE RAW job named `docName` to the Windows
 * queue `printerName`. Throws Error(<curated message>) on any failure; never
 * throws a foreign string.
 */
export function writeRawJob(printerName: string, docName: string, data: Uint8Array): void {
  if (printerName.length === 0 || printerName.length > PRINTER_NAME_MAX_CHARS) {
    throw new RangeError(`writeRawJob: printerName must be 1-${PRINTER_NAME_MAX_CHARS} chars`);
  }
  if (data.length === 0) {
    throw new RangeError("writeRawJob: data must not be empty");
  }

  loadSpooler();
  const spool = spooler;
  if (spool === null) throw new Error(SPOOL_UNAVAILABLE_MESSAGE);

  const handleOut: [unknown] = [null];
  if (!spool.OpenPrinterW(printerName, handleOut, null)) {
    const code = spool.GetLastError();
    throw new Error(messageForWin32(code));
  }
  const hPrinter = handleOut[0];

  try {
    const jobId = spool.StartDocPrinterW(hPrinter, 1, {
      pDocName: docName,
      pOutputFile: null,
      pDatatype: RAW_SPOOL_DATATYPE,
    });
    if (jobId === 0) {
      const code = spool.GetLastError();
      throw new Error(messageForWin32(code));
    }

    try {
      if (!spool.StartPagePrinter(hPrinter)) {
        const code = spool.GetLastError();
        throw new Error(messageForWin32(code));
      }

      const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      for (let offset = 0; offset < buffer.length; offset += RAW_SPOOL_CHUNK_BYTES) {
        const chunk = buffer.subarray(offset, offset + RAW_SPOOL_CHUNK_BYTES);
        const written: [number] = [0];
        if (!spool.WritePrinter(hPrinter, chunk, chunk.length, written)) {
          const code = spool.GetLastError();
          throw new Error(messageForWin32(code));
        }
        if (written[0] !== chunk.length) throw new Error(SPOOL_SHORT_WRITE_MESSAGE);
      }

      if (!spool.EndPagePrinter(hPrinter)) {
        const code = spool.GetLastError();
        throw new Error(messageForWin32(code));
      }
      if (!spool.EndDocPrinter(hPrinter)) {
        const code = spool.GetLastError();
        throw new Error(messageForWin32(code));
      }
    } catch (error) {
      // A half-written or unclosed job must be deleted, never printed as
      // garbage -- covers every failure once a job id exists.
      spool.AbortPrinter(hPrinter);
      throw error;
    }
  } finally {
    spool.ClosePrinter(hPrinter);
  }
}
