import type { UseReactToPrintOptions } from "react-to-print";
import { toast } from "sonner";

import { DESKTOP_PRINT_EMPTY_MESSAGE, printDocumentHasText, serializePrintDocument } from "@/lib/desktop-shell-document";
import type { DesktopPrintMode } from "@/lib/desktop-shell-printer";

// The document half (serialization, stylesheet inlining, the blank-slip fence)
// lives in lib/desktop-shell-document.ts; re-exported so every existing import
// site and pin keeps reading it from here.
export { serializePrintDocument, DESKTOP_PRINT_EMPTY_MESSAGE };

// CB-D1 Slice B (plan §2, B.1 + amendment M10) — the seam between the cafe web
// app and the optional Windows desktop shell (apps/desktop). The shell exposes
// exactly one bridge on `window.posDesktop`; every one of the nine
// useReactToPrint call sites wraps its options through `slipPrintOptions` so a
// desktop-hosted counter PC prints silently through the shell's own print
// pipeline instead of opening a browser print dialog. Capability-keyed ONLY —
// this file never reads the browser's user-agent string and never names the
// shell's runtime: the bridge's mere presence on `window` is the only signal
// it trusts (device-agnostic-is-the-product-bar).

export interface PosDesktopBridge {
  readonly version: string;
  printHtml(html: string): Promise<void>;
  // The printer picker (2026-09-17) — types and the feature-detecting accessor
  // live in lib/desktop-shell-printer.ts. OPTIONAL on purpose: the counter
  // PC's installer is hand-copied and never auto-updates, so an older shell
  // exposes a bridge WITHOUT these (or without printMode/savePrintMode, added
  // later). Callers must feature-detect.
  listPrinters?(): Promise<{ selected: string | null; printers: { name: string; displayName: string }[]; printMode?: DesktopPrintMode }>;
  savePrinter?(name: string | null): Promise<{ selected: string | null }>;
  savePrintMode?(mode: DesktopPrintMode): Promise<{ printMode: DesktopPrintMode }>;
}

declare global {
  interface Window {
    posDesktop?: PosDesktopBridge;
  }
}

export const DESKTOP_PRINT_FAILED_MESSAGE =
  "Could not print on this PC. Check the printer, then print the slip again.";
export const DESKTOP_PRINT_TOO_LARGE_MESSAGE = "This slip is too large to print through the desktop app.";
export const DESKTOP_PRINT_NO_REPLY_MESSAGE = "The desktop app did not answer. Print the slip again.";
// Mirrors apps/desktop/src/shared.ts PRINT_HTML_MAX_CHARS (parity-pinned): the
// shell refuses anything larger, so refuse here with a message that says why.
export const DESKTOP_PRINT_HTML_MAX_CHARS = 1_500_000;
// Longer than the shell's own PRINT_JOB_TIMEOUT_MS (30 s): if the main process
// never answers at all, the caller's bookkeeping still settles (review C1).
export const DESKTOP_PRINT_TIMEOUT_MS = 35_000;
// A shell message is a short curated sentence; anything else falls back.
const SHELL_MESSAGE_MAX_CHARS = 160;
const IPC_ERROR_PREFIX = "Error: ";

// Returns the bridge only when it is actually usable — a stale/partial global
// (a preload that ran before the bridge finished wiring itself) must fall back
// to the browser print path exactly like no shell being present at all.
export function desktopShell(): PosDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.posDesktop;
  if (!bridge || typeof bridge.printHtml !== "function") return null;
  return bridge;
}

export function isDesktopShell(): boolean {
  return desktopShell() !== null;
}

function resolveTitle(documentTitle: UseReactToPrintOptions["documentTitle"]): string | undefined {
  if (documentTitle === undefined) return undefined;
  return typeof documentTitle === "function" ? documentTitle() : documentTitle;
}

// What the operator reads on a failure: the shell's own curated sentence
// (the IPC layer wraps it as "Error invoking remote method '…': Error: <sentence>"),
// or one of this seam's own messages — never an internal/library error text.
const SEAM_MESSAGES: ReadonlySet<string> = new Set([
  DESKTOP_PRINT_TOO_LARGE_MESSAGE,
  DESKTOP_PRINT_NO_REPLY_MESSAGE,
  DESKTOP_PRINT_EMPTY_MESSAGE,
]);
export function shellErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (SEAM_MESSAGES.has(raw)) return raw;
  const idx = raw.lastIndexOf(IPC_ERROR_PREFIX);
  if (idx < 0) return DESKTOP_PRINT_FAILED_MESSAGE;
  const message = raw.slice(idx + IPC_ERROR_PREFIX.length).trim();
  return message.length > 0 && message.length <= SHELL_MESSAGE_MAX_CHARS ? message : DESKTOP_PRINT_FAILED_MESSAGE;
}

// Test seams (plan §B1): default to the real toast / real timeout so production
// call sites need not know these exist.
let desktopToast: (message: string) => void = (message) => toast.error(message);
let desktopPrintTimeoutMs = DESKTOP_PRINT_TIMEOUT_MS;

export function setDesktopToast(fn: (message: string) => void): void {
  desktopToast = fn;
}

export function setDesktopPrintTimeoutMs(ms: number): void {
  desktopPrintTimeoutMs = ms;
}

// A failed silent print must behave like a cancelled browser print dialog —
// react-to-print never calls onAfterPrint on its own error path, so every
// caller's onAfterPrint bookkeeping (kotPrinting flags, the print-host bridge's
// busy window, EOD's disabled state) would wedge forever without this calling
// it explicitly. The toast carries the shell's own diagnosis when it has one.
function defaultOnPrintError(
  options: UseReactToPrintOptions,
): (errorLocation: "onBeforePrint" | "print", error: Error) => void {
  return (_errorLocation, error) => {
    desktopToast(shellErrorMessage(error));
    options.onAfterPrint?.();
  };
}

async function printThroughShell(shell: PosDesktopBridge, html: string): Promise<void> {
  // A document with no body text is a blank slip — refused here, out loud,
  // never handed to a printer (owner rule 2026-09-11).
  if (!printDocumentHasText(html)) throw new Error(DESKTOP_PRINT_EMPTY_MESSAGE);
  if (html.length > DESKTOP_PRINT_HTML_MAX_CHARS) throw new Error(DESKTOP_PRINT_TOO_LARGE_MESSAGE);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const noReply = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(DESKTOP_PRINT_NO_REPLY_MESSAGE)), desktopPrintTimeoutMs);
  });
  try {
    await Promise.race([shell.printHtml(html), noReply]);
  } finally {
    clearTimeout(timer);
  }
}

// Wraps a useReactToPrint options object so it prints through the desktop
// shell when one is present, and returns the SAME object reference otherwise
// — every call site's options literal stays untouched in the no-shell case.
export function slipPrintOptions<T extends UseReactToPrintOptions>(options: T): T {
  const shell = desktopShell();
  if (!shell) return options;
  return {
    ...options,
    print: async (iframe: HTMLIFrameElement) => {
      await printThroughShell(shell, serializePrintDocument(iframe, resolveTitle(options.documentTitle)));
    },
    onPrintError: options.onPrintError ?? defaultOnPrintError(options),
  };
}
