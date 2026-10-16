import { slipCodeStatus, templateNeedsSlipCode, type SlipCodeStatus } from "@/components/print/slip/slip-code";
import type { PaperWidth } from "@/lib/constants";
import { desktopShell } from "@/lib/desktop-shell";
import { desktopPrintRawOn, desktopPrintsRaw, type DesktopPrintMode } from "@/lib/desktop-shell-printer";
import { printConfigOf, settingsForPaper } from "@/lib/print";
import type { HostPrintSlip, SlipPrintTarget } from "@/lib/print-host-slips";
import { kotTemplateOf } from "@/lib/print-template-resolve";
import { rasterCapable } from "@/lib/printer/capabilities";
import { desktopLan, type DesktopLanTarget } from "@/lib/printer/desktop-lan";
import { desktopPrinterSnapshot } from "@/lib/printer/desktop-printer-state";
import { devicePrinter } from "@/lib/printer/device-printer";
import { RASTER_MAX_ROWS, dotsForPaper } from "@/lib/printer/escpos";
import { printerWriter } from "@/lib/printer/printer-registry";
import type { PrinterSnapshot } from "@/lib/printer/web-printer-types";
import type { Settings } from "@/types";
import { kotTextJob } from "./kot-text";
import { textColumnsOf } from "./text-layout";
import { readTextKot, textKotKeyForDevice, textKotKeyForPrinter, type TextKotChoice, type TextKotReach } from "./text-kot-store";

// Printing Phase 4 (spec 2026-10-15 §5.2, §5.4, S1, S3, S4): the print bridge's text step. Right before the bridge fires
// its kitchen surface it asks here; the answer is the slip's text bytes and the write that sends them through the very
// writer the picture would use, or null, and then the picture prints exactly as today. Null unless all of these hold: a
// job's slip on the kitchen surface; a printer this device reaches the way the picture would, which can take raw bytes;
// that printer's switch on in this device's storage; no lazy slip code missing (the picture would print the legacy ticket);
// and the text renderer answering at the printer's columns, within the picture's own size limit. Never throws: any error
// is a null, decided before a single byte is sent.

/** What the text step reads and writes through: the real device (textKotEnv) or a test's fakes. */
export interface TextKotEnv {
  /** This device's own printer (lib/printer/device-printer.ts). */
  devicePrinter(): PrinterSnapshot;
  /** The Windows app: null on any other runtime; else its chosen printer (null: none) and its print method (undefined: the
   *  app does not say). */
  desktop(): { chosen: string | null; printMode: DesktopPrintMode | undefined } | null;
  /** The Windows app writes raw bytes to a Windows printer (printRawOn, 2.0.2). */
  desktopPrintsRaw(): boolean;
  /** This runtime reaches a printer of its own (the POS app, Web Serial, Web Bluetooth); else the picture opens the
   *  browser's print window. */
  rasterCapable(): boolean;
  readTextKot(key: string): TextKotChoice | null;
  slipCodeStatus(): SlipCodeStatus;
  writeDevice(bytes: Uint8Array): Promise<void>;
  writeNative(nativeId: string, bytes: Uint8Array): Promise<void>;
  writeLan(target: DesktopLanTarget, bytes: Uint8Array): Promise<void>;
  writeRawOn(printerName: string, bytes: Uint8Array): Promise<void>;
}

/** The real device. */
export function textKotEnv(): TextKotEnv {
  return {
    devicePrinter: () => devicePrinter().getSnapshot(),
    desktop: () => {
      if (desktopShell() === null) return null;
      const snapshot = desktopPrinterSnapshot();
      return { chosen: snapshot.selected, printMode: snapshot.printMode };
    },
    desktopPrintsRaw,
    rasterCapable,
    readTextKot,
    slipCodeStatus,
    writeDevice: (bytes) => devicePrinter().write(bytes),
    writeNative: (nativeId, bytes) => printerWriter(nativeId)(bytes),
    writeLan: (target, bytes) => desktopLan().write(target, bytes),
    writeRawOn: desktopPrintRawOn,
  };
}

/** Where a printer's text goes on this device: its switch's key, the paper its columns come from, and its writer. */
export interface TextKotRoute {
  key: string;
  paper: PaperWidth;
  write(bytes: Uint8Array): Promise<void>;
}

interface RouteInput {
  /** The job's printer (printers mode); undefined for this device's own printer (simple mode). */
  printerId: string | undefined;
  target: SlipPrintTarget | undefined;
  settings: Settings | null | undefined;
  env: TextKotEnv;
}

/** The writer the picture would use for this printer here (lib/desktop-shell.ts slipPrintOptions, lib/printer/lane-print.ts),
 *  when it can take raw bytes; null where the picture prints another way (the browser's print window, the Windows driver,
 *  an app before 2.0.2's printRawOn) or would refuse (no printer, another tab owns it). */
export function textKotRouteOf({ printerId, target, settings, env }: RouteInput): TextKotRoute | null {
  const keyOf = (reach: TextKotReach): string => (printerId === undefined ? textKotKeyForDevice(reach) : textKotKeyForPrinter(printerId, reach));
  // A network printer of the Windows app 1.12.0: its raw TCP, whatever else this runtime has.
  if (target?.lan !== undefined) {
    const lan = target.lan;
    return { key: keyOf({ kind: "lan", host: lan.host, port: lan.port }), paper: target.paper, write: (bytes) => env.writeLan(lan, bytes) };
  }
  const desktop = env.desktop();
  if (desktop !== null) {
    // Every other slip of the Windows app goes to a Windows printer: the job's, or this PC's chosen one (simple mode, drawn
    // at the kitchen ticket's paper setting); as text only through printRawOn and the Direct method (spec §5.3).
    const name = target?.printerName ?? (printerId === undefined ? desktop.chosen : null);
    if (name === null || !env.desktopPrintsRaw() || desktop.printMode !== "direct") return null;
    return { key: keyOf({ kind: "windows", name }), paper: target?.paper ?? printConfigOf(settings).kot.paperWidth, write: (bytes) => env.writeRawOn(name, bytes) };
  }
  // One of the POS app's printers on bridge v2, by the app's id.
  if (target?.nativeId !== undefined) {
    const nativeId = target.nativeId;
    return { key: keyOf({ kind: "app", nativeId }), paper: target.paper, write: (bytes) => env.writeNative(nativeId, bytes) };
  }
  // This device's own printer, as the picture's lane: none on a plain browser (the print window), none while no printer is
  // saved or another tab of this browser owns it (the picture then refuses with its own sentence, as today).
  if (!env.rasterCapable()) return null;
  const snapshot = env.devicePrinter();
  if (snapshot.printer === null || snapshot.status === "elsewhere") return null;
  return { key: keyOf(snapshot.printer), paper: snapshot.printer.paper, write: (bytes) => env.writeDevice(bytes) };
}

/** Spec §4.1 rule 7: text is never larger than the largest picture the same paper may print (RASTER_MAX_ROWS rows of
 *  the paper's dots). A kitchen ticket's text is about 1 KB; this only bounds a pathological one. */
export function textKotFitsPicture(length: number, paper: PaperWidth): boolean {
  return length <= (dotsForPaper(paper) / 8) * RASTER_MAX_ROWS;
}

export interface TextKotWrite {
  bytes: Uint8Array;
  write(): Promise<void>;
}

export interface TextKotWriteInput {
  slip: HostPrintSlip;
  settings: Settings | null | undefined;
  target: SlipPrintTarget | undefined;
  env: TextKotEnv;
}

/** The slip's text bytes and their write, or null: the bridge then fires the picture exactly as before (S1, S3). */
export function textKotWriteFor({ slip, settings, target, env }: TextKotWriteInput): TextKotWrite | null {
  try {
    // Only a job's slip on the kitchen surface (spec P4-1): never a bill, a token, End of day or a printer's Test print.
    if (slip.surface !== "kot") return null;
    // Spec §5.3: a printer this device only takes over for another device has no switch here (the panel never lists it,
    // so staff could not turn it off from here): pictures, whatever this device's storage holds for it.
    if (slip.takeover === true) return null;
    const route = textKotRouteOf({ printerId: slip.printerId, target, settings, env });
    if (route === null) return null;
    const choice = env.readTextKot(route.key);
    if (choice === null) return null;
    // The slip as the picture draws it: for the printer's own paper when the job has a target (PrintHostPrintSources).
    const printSettings = target === undefined ? settings : settingsForPaper(settings, target.paper);
    // The planning review's I-4: while the design's lazy code is not loaded the picture prints the legacy ticket instead,
    // and text must not print something else.
    const template = kotTemplateOf(printSettings);
    if (template !== null && templateNeedsSlipCode(template) && env.slipCodeStatus() !== "ready") return null;
    const job = kotTextJob({ slip, settings: printSettings, columns: textColumnsOf(route.paper, choice.narrow80) });
    if (!job.ok || !textKotFitsPicture(job.bytes.length, route.paper)) return null;
    const bytes = job.bytes;
    return { bytes, write: () => route.write(bytes) };
  } catch {
    return null;
  }
}
