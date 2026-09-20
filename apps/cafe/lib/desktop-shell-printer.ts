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
