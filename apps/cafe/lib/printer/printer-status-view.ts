import { PRINTER_PROBLEMS, printerProblemText, type PrinterProblem } from "@pos/shared/print-failover";
import { DOT_PROBLEMS, type PrinterHere, type TransportWord, type WaitingPrinter } from "@/lib/print-agent-here";
import type { DotLane, PrinterDot } from "@/lib/printer/printer-dot";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// Printer UX PX-2 (spec §6.4): every word of the panel's status card, per dot state: the headline, the detail, at most
// three steps, one button when a tap fixes it, one quiet link for the next step, or a note when nothing can be tapped.
// The words are the spec's, verbatim. A step marks its bold word as **word**; the card draws the marks. Pure and
// DOM-free: the panel hands in what it reads (Task 6 draws it). Replaces printerHeadlineOf's copy for the panel (R11).

export type DeviceNoun = "this phone" | "this tablet" | "this PC" | "this device";
export type StatusActionKind = "reconnect" | "connect" | "choose" | "print-here" | "set-up-host";
export type StatusLinkKind = "connect-again" | "one-device" | "printer-setup";

export interface PrinterStatusView {
  tone: "ok" | "bad" | "checking";
  headline: string;
  /** "" when the state has no second line. */
  detail: string;
  steps: string[];
  action: { kind: StatusActionKind; label: string } | null;
  link: { kind: StatusLinkKind; label: string } | null;
  note: string | null;
  /** Exactly what Reconnect reconnects (the Task 5 review, M-3): every printer of `here` that is down, in display order,
   *  on printers mode's "not connected" rows (an entry with a native id through the app, one without it is this device's
   *  own printer). Empty on every other row, so nothing is ever reconnected from it alone; a Reconnect with an empty
   *  subject is this device's own printer (simple mode, a browser's printer that needs a tap, a host that is offline).
   *  The Windows app's printers are never in it (F-I3). */
  subject: PrinterHere[];
}

export interface PrinterStatusViewInput {
  dot: PrinterDot;
  /** The printing device's name from the pulse; null when none is set. */
  hostLabel: string | null;
  /** Simple mode: the saved printer (its name and transport); on the Windows app, the chosen printer. */
  printer: { name: string; transport: TransportWord } | null;
  noun: DeviceNoun;
  isHostDevice: boolean;
  /** This device can print a slip right now (offers "Print on this device" only then). */
  canPrintHere: boolean;
  /** The Windows app has no printer chosen. */
  desktopNoPrinter: boolean;
  localStatus: PrinterStatus;
  /** Printers mode: every printer this device prints now (dotPrintersOf's `here`, held, display order). */
  here: readonly PrinterHere[];
  waiting: WaitingPrinter | null;
  /** Printers mode: the setup's names of the printers it writes that are not its own. */
  notHere: readonly string[];
  isAdmin: boolean;
}

const HOST_FALLBACK = "The printing device";
const PRINTER_FALLBACK = "The printer";
const RECONNECT_STEP = "Tap **Reconnect**.";
const BACK = "Slips wait and print when it is back.";
const PRINTS_AFTER = "Waiting slips print by themselves after that.";
const RECONNECT = { kind: "reconnect", label: "Reconnect" } as const;
const CONNECT = { kind: "connect", label: "Connect a printer" } as const;
const TRANSPORT_WORDS: Record<TransportWord, string> = { bluetooth: "Bluetooth", usb: "USB", network: "Wi-Fi or network", windows: "Windows printer", browser: "" };
const STOP_STEPS: Partial<Record<PrinterProblem, string[]>> = {
  "paper-out": ["Put in a new paper roll.", "Close the cover."],
  "cover-open": ["Close the printer's cover."],
  error: ["Switch the printer off and on.", "Check the paper is not stuck."],
};
const STOP_HEADLINES: Partial<Record<PrinterProblem, (printer: string) => string>> = {
  "paper-out": (printer) => `${printer} is out of paper`,
  "cover-open": (printer) => `${printer} has its cover open`,
  error: (printer) => `${printer} reports an error`,
};

/** The device noun (R13): the Windows app is "this PC"; inside the Android app (bridge present or its WebView) the
 *  screen's shorter side decides, under 600 px "this phone", else "this tablet" ("this device" before it is known). */
export function deviceNounOf(lane: DotLane, inApp: boolean, shortSidePx: number | null): DeviceNoun {
  if (lane === "desktop") return "this PC";
  if (!inApp || shortSidePx === null) return "this device";
  return shortSidePx < 600 ? "this phone" : "this tablet";
}

const slips = (n: number): string => `${n} slip${n === 1 ? "" : "s"}`;

// "RPP02N · Bluetooth"; the Windows app's network printer is "{name} · network"; without a name, the word alone.
function connOf(name: string, transport: TransportWord, windowsApp: boolean): string {
  const word = windowsApp && transport === "network" ? "network" : TRANSPORT_WORDS[transport];
  return [name, word].filter((part) => part !== "").join(" · ");
}

function offSteps(transport: TransportWord | null, noun: DeviceNoun): string[] {
  if (transport === "bluetooth") return ["Turn the printer on.", `Keep it close to ${noun}.`, RECONNECT_STEP];
  if (transport === "usb") return ["Turn the printer on.", "Check the USB cable.", RECONNECT_STEP];
  if (transport === "network") return ["Turn the printer on.", "Check it is on the cafe's network.", RECONNECT_STEP];
  return ["Turn the printer on.", RECONNECT_STEP];
}

type Words = Pick<PrinterStatusView, "tone" | "headline" | "detail"> & Partial<PrinterStatusView>;
const viewOf = (words: Words): PrinterStatusView => ({ steps: [], action: null, link: null, note: null, subject: [], ...words });
const bad = (headline: string, detail: string, more: Partial<PrinterStatusView> = {}): PrinterStatusView => viewOf({ tone: "bad", headline, detail, ...more });

function okView(i: PrinterStatusViewInput, host: string | null, windowsApp: boolean): PrinterStatusView {
  const ready = (detail: string) => viewOf({ tone: "ok", headline: "Printer ready", detail });
  const [only] = i.here;
  if (only !== undefined) return ready(i.here.length === 1 ? connOf(only.appName, only.transport, windowsApp) : i.here.map((p) => p.name).join(", "));
  if (!i.isHostDevice && host !== null) return viewOf({ tone: "ok", headline: "Printing is on", detail: `Slips print at **${host}**.` });
  if (windowsApp) return ready(i.printer?.name ?? "");
  return ready(i.printer === null ? "" : connOf(i.printer.name, i.printer.transport, false));
}

function waitingView(waiting: WaitingPrinter | null): PrinterStatusView {
  const note = "If they do not print soon, check it is on and has paper.";
  if (waiting === null) return bad("Slips are waiting for a printer", "", { note });
  if (!waiting.stuck) return bad(`Slips are waiting for ${waiting.name}`, `${slips(waiting.count)} waiting.`, { note });
  const detail = waiting.problem !== undefined ? printerProblemText(waiting.name, waiting.problem) : `${slips(waiting.count)} waiting for it.`;
  return bad(`${waiting.name} is not printing`, detail, { steps: ["Check it is on and has paper.", "On the device it is connected to, open Printer and tap **Reconnect**."] });
}

// Printers mode: every printer of `here` that is down, in display order; one names it, two or more count them.
function offView(i: PrinterStatusViewInput, windowsApp: boolean): PrinterStatusView {
  const down = i.here.filter((p) => p.status === "disconnected" || p.status === "needs-tap");
  const first = down[0];
  if (first === undefined) {
    const detail = i.printer === null ? "" : connOf(i.printer.name, i.printer.transport, false);
    return bad("Printer not connected", detail, { steps: offSteps(i.printer?.transport ?? null, i.noun), action: RECONNECT, link: { kind: "connect-again", label: "Still not working? Connect it again" } });
  }
  const headline = down.length === 1 ? `${first.name} is not connected` : `${down.length} printers are not connected`;
  const detail = down.length === 1 ? connOf(first.appName, first.transport, windowsApp) : down.map((p) => p.name).join(", ");
  // F-I3: the Windows app checks its printers itself every minute; no Reconnect could work there.
  if (windowsApp) return bad(headline, detail, { steps: offSteps(first.transport, i.noun).filter((step) => step !== RECONNECT_STEP), note: "This PC checks it again every minute." });
  return bad(headline, detail, { steps: offSteps(first.transport, i.noun), action: RECONNECT, subject: down });
}

// The printer that is out of paper, has its cover open or reports an error: the worst of `here` (printers mode), else the
// app's own printer in simple mode, read from the dot's words (printerProblemText: "{name}" + the problem's own ending).
function problemView(i: PrinterStatusViewInput, windowsApp: boolean): PrinterStatusView {
  const rank = (p: PrinterHere) => (p.problem === undefined ? PRINTER_PROBLEMS.length : PRINTER_PROBLEMS.indexOf(p.problem));
  const entry = i.here.filter((p) => p.problem !== undefined && DOT_PROBLEMS.includes(p.problem)).sort((a, b) => rank(a) - rank(b))[0];
  const said = i.dot.show ? (i.dot.problem ?? "") : "";
  const kind = entry?.problem ?? DOT_PROBLEMS.find((stop) => said.endsWith(printerProblemText("", stop))) ?? "error";
  const ending = printerProblemText("", kind);
  const named = said.endsWith(ending) ? said.slice(0, said.length - ending.length) : "";
  const name = entry?.name ?? i.printer?.name ?? (named !== "" ? named : PRINTER_FALLBACK);
  const detail = entry !== undefined ? connOf(entry.appName, entry.transport, windowsApp) : i.printer === null ? "" : connOf(i.printer.name, i.printer.transport, windowsApp);
  return bad(STOP_HEADLINES[kind]?.(name) ?? `${name} reports an error`, detail, { steps: STOP_STEPS[kind] ?? [], note: PRINTS_AFTER });
}

// Today's three fixes for a device that cannot print while the printing device is offline.
function hostOfflineAction(i: PrinterStatusViewInput): PrinterStatusView["action"] {
  if (i.canPrintHere) return { kind: "print-here", label: "Print on this device" };
  if (i.localStatus === "elsewhere") return null;
  return i.printer !== null ? RECONNECT : CONNECT;
}

export function printerStatusViewOf(i: PrinterStatusViewInput): PrinterStatusView {
  const { dot } = i;
  if (!dot.show || dot.reason === "checking") return viewOf({ tone: "checking", headline: "Checking the printer…", detail: "" });
  const trimmed = i.hostLabel?.trim() ?? "";
  const label = trimmed !== "" ? trimmed : null;
  const host = label ?? HOST_FALLBACK;
  // The Windows app is inferred from the noun: the caller must build `noun` with deviceNounOf (desktop lane → "this PC").
  const windowsApp = i.noun === "this PC";
  switch (dot.reason) {
    case "ok":
      return okView(i, label, windowsApp);
    case "printers-elsewhere":
      return viewOf({ tone: "ok", headline: "Printing is on", detail: "Slips print at the cafe's printers." });
    case "printer-waiting":
      return waitingView(i.waiting);
    case "device-offline":
      return bad("This device is offline", "Printer status updates when the internet is back.");
    case "no-printer":
      if (i.desktopNoPrinter) return bad("No printer chosen on this PC", "Choose this PC's printer so slips can print.", { action: { kind: "choose", label: "Choose a printer" } });
      return bad(`No printer on ${i.noun}`, "Connect one to print slips here.", { action: CONNECT, link: { kind: "one-device", label: "Or print everything on one device" } });
    case "printer-off":
      return offView(i, windowsApp);
    case "printer-needs-tap": {
      // Only a browser's own printer needs a tap (the app's printers never do): Reconnect is this device's own printer.
      const tap = i.here.find((p) => p.status === "needs-tap");
      const detail = tap !== undefined ? connOf(tap.appName, tap.transport, false) : i.printer === null ? "" : connOf(i.printer.name, i.printer.transport, false);
      return bad("Printer needs a tap", detail, { action: RECONNECT });
    }
    case "printer-elsewhere":
      return bad("Printer in another tab", "Print from that tab, or close it.");
    case "printer-problem":
      return problemView(i, windowsApp);
    case "host-offline":
      if (i.isHostDevice) return bad(`${host} is offline`, "Slips wait and print when this device is back online.");
      return bad(`${host} is offline`, BACK, { action: hostOfflineAction(i) });
    case "host-printer-off":
      return bad(`${host}'s printer is not connected`, BACK, { steps: [`On ${host}, open Printer and tap **Reconnect**.`] });
    case "host-print-window":
      return bad("Slips need a tap to print", `${host} opens a print window for every slip.`, { action: i.isHostDevice ? { kind: "set-up-host", label: "Set up the printer" } : null });
    case "printer-not-here":
      return bad(`${i.notHere[0] ?? "A printer"} is not on ${i.noun}`, "Connect it here, or ask your manager to change Printer setup.", {
        action: CONNECT,
        link: i.isAdmin ? { kind: "printer-setup", label: "Open Printer setup" } : null,
      });
  }
}
