// The PRINTER-PICKER half of the desktop-shell seam (split out of
// lib/desktop-shell.ts for its 150-line budget, 2026-09-17 — the same idiom
// as lib/desktop-shell-document.ts).
//
// Why this exists: the shell printed silently to whatever Windows called the
// DEFAULT printer, because its `deviceName` was null and v1 shipped no picker.
// On a counter PC whose default is a virtual device (Microsoft Print to PDF,
// OneNote, XPS, Fax) every slip vanished into it — no error, no paper — while
// the browser print dialog kept working, because the operator picks the
// printer there. This is that choice, made once and stored by the shell.
import { desktopShell } from "@/lib/desktop-shell";
import type { PaperWidth } from "@/lib/constants";

export interface DesktopPrinter {
  /** What Chromium's deviceName matches on — the OS name, not the label. */
  name: string;
  displayName: string;
}

// Lives here rather than desktop-shell.ts (2026-09-19): that file's 150-line
// budget has no room left, and this seam already owns every other
// printer-picker type.
export type DesktopPrintMode = "direct" | "driver";

export const DESKTOP_PRINT_MODES: readonly DesktopPrintMode[] = ["direct", "driver"];
export const DEFAULT_DESKTOP_PRINT_MODE: DesktopPrintMode = "direct";

export interface DesktopPrinterList {
  /** null = no explicit choice; the shell falls back to the Windows default. */
  selected: string | null;
  printers: DesktopPrinter[];
  /** The shell's EFFECTIVE mode; undefined only on a shell that predates it. */
  printMode?: DesktopPrintMode;
}

export interface DesktopPrinterApi {
  listPrinters(): Promise<DesktopPrinterList>;
  savePrinter(name: string | null): Promise<{ selected: string | null }>;
  // Optional on purpose (same rationale as savePrinter): an older shell
  // exposes a bridge WITHOUT it. Callers must feature-detect.
  savePrintMode?: (mode: DesktopPrintMode) => Promise<{ printMode: DesktopPrintMode }>;
}

// Mirrors NON_PAPER_PRINTER_PATTERNS in apps/desktop/src/shared.ts, which is the ENFORCING copy: the shell refuses
// these whatever this list says. Here they are only greyed out with a reason, so the operator understands why.
const NON_PAPER_PATTERNS = ["print to pdf", "xps document writer", "onenote", "fax", "adobe pdf", "pdfcreator"];

/** A Windows device that saves a file instead of printing (the picker and, since Session 2E, the printer form). */
export function desktopPrinterSavesToFile(name: string): boolean {
  const lower = name.toLowerCase();
  return NON_PAPER_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** Phase 2 Session 2E (spec §9.2): the shell prints a slip on a printer the page names (printHtmlOn, desktop 1.11.0).
 *  Feature-detected like the picker: an older shell prints only on its chosen printer, so the page names none there. */
export function desktopPrintsOnNamed(): boolean {
  return typeof desktopShell()?.printHtmlOn === "function";
}

/** Phase 3 Session 3E (spec §9.6): the Windows app 1.12.0 writes a network printer itself, over raw TCP from its main
 *  process: the slip's ESC/POS bytes to the printer's address (`printRaw`, the same bytes as the POS app's), and the idle
 *  check of the network printers this PC prints (`lanStatus`). Optional and feature-detected like the picker: an older
 *  app has neither, and prints no network printer. Both answer plain results the page checks (lib/printer/desktop-lan.ts). */
export interface DesktopLanBridge {
  printRaw?(printer: { host: string; port: number }, data: Uint8Array): Promise<unknown>;
  lanStatus?(printers: { host: string; port: number }[]): Promise<unknown>;
}

/** Phase 2 Session 2E: where a printer job prints on the Windows app: its Windows printer, drawn for its paper. */
export interface DesktopPrintTarget {
  printerName: string;
  paper: PaperWidth;
}

/**
 * The picker half of the bridge, or null when there is no shell at all or the
 * installed one predates the picker.
 *
 * Feature-detected, never assumed: the counter PC's installer is hand-copied
 * and never auto-updates, so an older shell exposes a bridge WITHOUT these
 * methods. Calling them unconditionally would throw on every un-upgraded PC —
 * capability-keyed exactly like desktopShell() itself (never a UA sniff, never
 * a version comparison).
 */
export function desktopPrinterApi(): DesktopPrinterApi | null {
  const bridge = desktopShell();
  if (!bridge) return null;
  const { listPrinters, savePrinter } = bridge;
  if (typeof listPrinters !== "function" || typeof savePrinter !== "function") return null;
  const api: DesktopPrinterApi = { listPrinters: listPrinters.bind(bridge), savePrinter: savePrinter.bind(bridge) };
  if (typeof bridge.savePrintMode === "function") api.savePrintMode = bridge.savePrintMode.bind(bridge);
  return api;
}
