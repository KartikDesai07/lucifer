import { printerProblemText, type PrinterProblem } from "@pos/shared/print-failover";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import type { DesktopChosen } from "@/lib/printer/desktop-printer-state";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// The printer dot in the top bar (green = slips will print, red = they will
// not, none = not known yet), derived in two steps:
//   1. printHostDotOf(pulse)  - what the SERVER says about the printing device
//   2. printerDotOf(...)      - that, combined with what THIS device can do
// Pure and DOM-free. It deliberately imports neither the desktop-shell seam
// nor print-lane (the lib/printer import scan): the lane arrives as a
// parameter. Written as a first-match-wins rule list; the order is the
// contract (04-web-plan.md, WAVE-2 CONTRACT).

/** The remote view of the printing device, read off the pulse ALONE.
 *  loading = no pulse yet; unknown = a degraded tick (printHost null);
 *  none = no printing device chosen; print-window = a host whose slips open
 *  the browser's print window (not attested as silent). */
export type PrintHostDot = "loading" | "unknown" | "none" | "offline" | "printer-off" | "print-window" | "ok";

/** The lane values this module reads (print-lane.ts's PrintLane, restated so
 *  this file never imports it). */
export type DotLane = "pending" | "desktop" | "raster" | "system" | "none";

export function printHostDotOf(pulse: PosPulseData | undefined): PrintHostDot {
  if (pulse === undefined) return "loading";
  const host = pulse.printHost;
  if (host === null) return "unknown";
  if (!host.configured) return "none";
  if (host.offline) return "offline";
  if (host.printer === "disconnected") return "printer-off";
  if (host.printer === "connected") return "ok";
  return host.silentMode ? "ok" : "print-window";
}

export type PrinterDotReason =
  | "ok"
  | "device-offline"
  | "checking"
  | "no-printer"
  | "printer-off"
  | "printer-needs-tap"
  | "printer-elsewhere"
  | "host-offline"
  | "host-printer-off"
  | "host-print-window"
  // Phase 2 Session 2D (spec §10), printers mode: this device writes a printer that is not its own printer; or it
  // writes none, and its slips print at the cafe's printers.
  | "printer-not-here"
  | "printers-elsewhere"
  // Phase 3 Session 3B (spec §10): a printer of this device out of paper, with its cover open or in error.
  | "printer-problem";

/** Session 3B: `problem`, a printer-problem dot's words (printerProblemText). */
export type PrinterDot = { show: false } | { show: true; ok: boolean; reason: PrinterDotReason; problem?: string };

export interface PrinterDotInput {
  remote: PrintHostDot;
  /** This device is the printing device the pulse names. */
  isHostDevice: boolean;
  lane: DotLane;
  /** The device printer's own status in THIS tab (snapshot.status). */
  local: PrinterStatus;
  /** The browser reports no network (online manager). */
  deviceOffline: boolean;
  /** Whether the desktop shell has a printer chosen; only read on the desktop lane. */
  desktopChosen: DesktopChosen;
  /** Session 2D: printers mode as this device sees it; absent or off, today's rules. */
  printers?: PrinterDotPrinters;
}

/** Session 2D (spec §10): an enabled printer takes a slip (no host plays a part), whether this device writes a
 *  printer, and whether every printer it writes is its own printer. */
export interface PrinterDotPrinters {
  printersMode: boolean;
  isWriter: boolean;
  allLocal: boolean;
  /** Session 2F1 (spec §9.2): on the POS app with bridge v2, the worst state among its printers this device prints. */
  worst?: PrinterStatus;
  /** Session 3B (spec §10): the worst problem the app says of one of them (out of paper, cover open, an error), by name. */
  problem?: { name: string; problem: PrinterProblem };
}

const NO_DOT: PrinterDot = { show: false };

function dot(reason: PrinterDotReason): PrinterDot {
  return { show: true, ok: reason === "ok" || reason === "printers-elsewhere", reason };
}

// How a printing device that is not this tab reads: its own report, verbatim.
function remoteRow(remote: PrintHostDot): PrinterDot {
  if (remote === "ok") return dot("ok");
  if (remote === "offline") return dot("host-offline");
  if (remote === "printer-off") return dot("host-printer-off");
  return dot("host-print-window");
}

// A saved printer in THIS tab; null when another tab owns it and the caller
// must fall back to the remote row. A printer still connecting is not "not
// answering": it reads as checking until it settles.
function localRaster(local: PrinterStatus): PrinterDot | null {
  if (local === "connected") return dot("ok");
  if (local === "connecting") return dot("checking");
  if (local === "needs-tap") return dot("printer-needs-tap");
  if (local === "elsewhere") return null;
  return dot("printer-off");
}

// The shell refuses every job while no printer is chosen on this PC.
function noHostRow(lane: DotLane, local: PrinterStatus, desktopChosen: DesktopChosen): PrinterDot {
  if (lane === "desktop") return desktopChosen === "none" ? dot("no-printer") : dot("ok");
  if (lane === "raster") return localRaster(local) ?? dot("printer-elsewhere");
  return dot("no-printer");
}

function thisDeviceHostRow(remote: PrintHostDot, lane: DotLane, local: PrinterStatus, desktopChosen: DesktopChosen): PrinterDot {
  if (lane === "raster") return localRaster(local) ?? remoteRow(remote);
  if (lane === "desktop") {
    if (desktopChosen === "none") return dot("no-printer");
    return remote === "offline" ? dot("host-offline") : dot("ok");
  }
  if (lane === "system") return remoteRow(remote);
  return dot("no-printer");
}

// Session 3B (spec §10): it answers but is out of paper, cover open or in error; 3C (m-7): in simple mode too.
function withProblem(row: PrinterDot, printers?: PrinterDotPrinters): PrinterDot {
  return printers?.problem === undefined || !row.show || !row.ok ? row : { show: true, ok: false, reason: "printer-problem", problem: printerProblemText(printers.problem.name, printers.problem.problem) };
}

// Session 2D (spec §10): the worst state among the printers this device writes (Session 3E: on the Windows app too); with
// none, its slips print at the cafe's printers (the waiting count and the alarm speak for those). A former host plays no part.
function printersRow(printers: PrinterDotPrinters, lane: DotLane, local: PrinterStatus, desktopChosen: DesktopChosen): PrinterDot {
  if (!printers.isWriter) return dot("printers-elsewhere");
  if (!printers.allLocal) return dot("printer-not-here");
  const row = lane === "desktop" && printers.worst !== undefined ? (localRaster(printers.worst) ?? dot("ok")) : noHostRow(lane, printers.worst ?? local, desktopChosen);
  return withProblem(row, printers);
}

export function printerDotOf(input: PrinterDotInput): PrinterDot {
  const { remote, isHostDevice, lane, local, deviceOffline, desktopChosen } = input;
  if (deviceOffline) return dot("device-offline");
  if (lane === "pending" || remote === "loading") return NO_DOT;
  if (input.printers?.printersMode === true) return printersRow(input.printers, lane, local, desktopChosen);
  if (remote === "unknown") return dot("checking");
  const own = remote === "none" ? noHostRow(lane, local, desktopChosen) : isHostDevice ? thisDeviceHostRow(remote, lane, local, desktopChosen) : null;
  return own === null ? remoteRow(remote) : withProblem(own, input.printers);
}

// ── Copy ─────────────────────────────────────────────────────────────────────
// Plain English for the person at the counter: no jargon, never the colour
// alone. The banner and the button name read from here only.
export const PRINTER_BUTTON_NAME_OK = "Printer connected — open printer setup";
export const PRINTER_BUTTON_NAME_BAD = "Printer not connected — open printer setup";
export const PRINTER_BUTTON_NAME_NONE = "Open printer setup";
export const PRINTER_BUTTON_NAME_CHECKING = "Checking the printer — open printer setup";
export const PRINTER_BUTTON_NAME_PROBLEM = "Printer needs attention — open printer setup";
const PROBLEM_HEADLINE = "Printer needs attention";

// "Checking" is neither good nor bad yet (a printer that is only connecting): the
// header button gets its own name and no dot, so it never reads red or "not connected".
export function printerButtonName(dotState: PrinterDot): string {
  if (!dotState.show) return PRINTER_BUTTON_NAME_NONE;
  if (dotState.reason === "checking") return PRINTER_BUTTON_NAME_CHECKING;
  if (dotState.reason === "printer-problem") return PRINTER_BUTTON_NAME_PROBLEM;
  return dotState.ok ? PRINTER_BUTTON_NAME_OK : PRINTER_BUTTON_NAME_BAD;
}

export type PrinterDotTone = "none" | "green" | "red";

/** The header button's dot colour: none (nothing drawn) while unknown or checking. */
export function printerDotTone(dotState: PrinterDot): PrinterDotTone {
  if (!dotState.show || dotState.reason === "checking") return "none";
  return dotState.ok ? "green" : "red";
}

export type PrinterFix = "reconnect" | "setup" | "print-here";

export interface PrinterHeadline {
  headline: string;
  /** May be empty (the "checking" line has no second sentence). */
  detail: string;
  fix: PrinterFix | null;
}

export interface PrinterHeadlineInput {
  /** The printing device's name from the pulse; null when none is set. */
  hostLabel: string | null;
  /** The saved printer's name on THIS device; null when none. */
  printerName: string | null;
  /** The device printer's own status in THIS tab (tells a saved-but-off printer from another tab's). */
  localStatus: PrinterStatus;
  isHostDevice: boolean;
  /** This device can print a slip right now (offers "Print on this device" only then). */
  canPrintHere: boolean;
  /** The desktop shell has no printer chosen (the no-printer line says so). */
  desktopNoPrinter: boolean;
}

export const HOST_LABEL_FALLBACK = "The printing device";
const THIS_PC_PRINTER_DETAIL = "Slips print on this PC's printer.";
const PRINTER_FALLBACK_NAME = "The printer";

const CHECKING_COPY: PrinterHeadline = { headline: "Checking the printer…", detail: "", fix: null };

function okDetail(i: PrinterHeadlineInput, label: string | null): string {
  if (!i.isHostDevice && label !== null) return `All slips print at ${label}.`;
  if (i.printerName !== null) return `${i.printerName} is connected.`;
  return THIS_PC_PRINTER_DETAIL;
}

const HOST_OFFLINE_WAIT = "Slips wait and print when it is back.";

// A host that is offline, seen from a device that cannot print right now: how to print here instead.
function hostOfflineElsewhere(i: PrinterHeadlineInput, host: string): PrinterHeadline {
  const headline = `${host} is offline`;
  if (i.localStatus === "elsewhere") {
    const detail = `${HOST_OFFLINE_WAIT} To print here instead, use the printer from another tab of this browser.`;
    return { headline, detail, fix: null };
  }
  if (i.printerName !== null) {
    return { headline, detail: `${HOST_OFFLINE_WAIT} To print here instead, reconnect ${i.printerName}.`, fix: "reconnect" };
  }
  return { headline, detail: `${HOST_OFFLINE_WAIT} To print here instead, set up a printer on this device.`, fix: "setup" };
}

function copyFor(reason: PrinterDotReason, i: PrinterHeadlineInput, label: string | null): PrinterHeadline {
  const host = label ?? HOST_LABEL_FALLBACK;
  const printer = i.printerName ?? PRINTER_FALLBACK_NAME;
  switch (reason) {
    case "ok":
      return { headline: "Printing is on", detail: okDetail(i, label), fix: null };
    case "device-offline":
      return {
        headline: "This device is offline",
        detail: "Check the internet connection. Printer status will update when it is back.",
        fix: null,
      };
    case "checking":
      return CHECKING_COPY;
    case "no-printer":
      if (i.desktopNoPrinter) {
        return { headline: "No printer chosen", detail: "Choose this PC's printer below so slips can print.", fix: "setup" };
      }
      return {
        headline: "No printer set up",
        detail: "Connect a printer to this device, or choose one device that prints all slips.",
        fix: "setup",
      };
    case "printer-off":
      return {
        headline: "Printer not connected",
        detail: `${printer} is not answering. Check it is on and nearby, then reconnect.`,
        fix: "reconnect",
      };
    case "printer-needs-tap":
      return { headline: "Printer needs a tap", detail: `Tap Reconnect to connect ${printer} again.`, fix: "reconnect" };
    case "printer-elsewhere":
      return {
        headline: "Printer in another tab",
        detail: "This printer is connected in another tab of this browser. Print from that tab, or close it.",
        fix: null,
      };
    case "host-offline":
      if (i.isHostDevice) {
        return { headline: `${host} is offline`, detail: "Slips wait and print when this device is back online.", fix: null };
      }
      if (!i.canPrintHere) return hostOfflineElsewhere(i, host);
      return {
        headline: `${host} is offline`,
        detail: `${HOST_OFFLINE_WAIT} You can print on this device instead.`,
        fix: "print-here",
      };
    case "host-printer-off":
      return { headline: "Printer not connected", detail: `${host} is on, but its printer is not connected.`, fix: null };
    case "host-print-window":
      return {
        headline: "Slips need a tap to print",
        detail: `${host} opens a print window for every slip. Set up a printer there so slips print by themselves.`,
        fix: i.isHostDevice ? "setup" : null,
      };
    case "printer-not-here":
      return {
        headline: "A printer is not on this device",
        detail: "This device is set to print a printer that is not its own printer. Check it in Printer setup.",
        fix: "setup",
      };
    case "printers-elsewhere":
      return { headline: "Printing is on", detail: "Each slip prints at its printer (Printer setup).", fix: null };
    case "printer-problem":
      return { headline: PROBLEM_HEADLINE, detail: "", fix: null };
  }
}

export function printerHeadlineOf(dotState: PrinterDot, input: PrinterHeadlineInput): PrinterHeadline {
  if (!dotState.show) return CHECKING_COPY;
  if (dotState.reason === "printer-problem") return { headline: PROBLEM_HEADLINE, detail: dotState.problem ?? "", fix: null };
  const label = input.hostLabel !== null && input.hostLabel.trim() !== "" ? input.hostLabel.trim() : null;
  return copyFor(dotState.reason, input, label);
}
