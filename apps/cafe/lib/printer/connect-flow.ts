import type { TransportWord } from "@/lib/print-agent-here";
import { nativeErrorCode } from "@/lib/printer/native-bridge";
import type { NativePrinter, NativeTransport } from "@/lib/printer/native-bridge-protocol";
import type { DeviceNoun } from "@/lib/printer/printer-status-view";
import { nativeErrorMessage } from "@/lib/printer/transport-native";
import type { ConnectOutcome } from "@/lib/printer/web-printer-types";

// Printer UX PX-3 Task 11 (spec §6.7; mockups g1–g6): the guided connect of the Android app, as a pure reducer. Steps: what
// kind of printer → the found list → connecting → connected → the test slip's question → the tips. Modes: replace (Connect a
// printer / Change: this device's own printer) and add (Connect another printer: joins the app's printers, X4: no test slip).
// Back, Cancel and Done are not events: they leave the view (X3). Every word of the steps lives here; the steps draw them.

export type ConnectTransport = "bluetooth" | "usb" | "network";
export type ConnectStep = "type" | "list" | "connecting" | "connected" | "question" | "tips";
export interface ConnectEntry {
  mode: "replace" | "add";
  /** null: ask what kind of printer first; a transport: straight to its list ("Connect it again"). */
  transport: ConnectTransport | null;
}
export interface ConnectTarget {
  id: string;
  name: string;
}
export interface ConnectState {
  step: ConnectStep;
  mode: "replace" | "add";
  transport: ConnectTransport | null;
  /** The printer being connected (or connected), for its name. */
  target: ConnectTarget | null;
  /** The list's inline line after a failed connect. */
  error: string | null;
}
export type ConnectEvent =
  | { type: "choose"; transport: ConnectTransport }
  | { type: "pick"; target: ConnectTarget }
  | { type: "connected" }
  /** message: why the app refused (a thrown attempt, Ruling T11-B); none: it ran and did not connect (the step's words). */
  | { type: "failed"; message?: string }
  | { type: "tested" }
  | { type: "not-printed" }
  | { type: "other" };

export const CONNECT_TITLE = "Connect a printer";
export const CONNECT_BACK_LABEL = "Back to printer settings";
/** Settings' Connect a printer / Change and the status card's Connect a printer; Connect another printer. */
export const CONNECT_REPLACE: ConnectEntry = { mode: "replace", transport: null };
export const CONNECT_ADD: ConnectEntry = { mode: "add", transport: null };
export const CONNECT_TRANSPORT_WORDS: Record<ConnectTransport, string> = { bluetooth: "Bluetooth", usb: "USB", network: "Wi-Fi or network" };
/** A printer added that did not connect: today's words (OtherDevicePrinters' add, X4). */
export const CONNECT_ADD_FAILED = "The printer is added, but not connected yet. Check it is on, then tap Reconnect.";
/** A printer added that connected: today's words (OtherDevicePrinters' add before PX-3), for an add that ends after staff
 *  left the guided connect (the final review's m1: today's flow toasted it). */
export const CONNECT_ADDED = "Printer added to this device.";

export const CONNECT_WORDS = {
  question: "What kind of printer?",
  reading: "Reading the printer list…",
  searching: "Looking for more printers…",
  notListed: "Not in the list?",
  notListedSteps: ["Turn the printer on.", "Pair it in Android's Bluetooth settings (PIN is often 0000 or 1234).", "Then tap **Search again**."],
  searchAgain: "Search again",
  usbNone: "No USB printer found. Connect a powered printer with a USB OTG adapter, then tap Refresh.",
  refresh: "Refresh",
  refreshing: "Refreshing printers…",
  connect: "Connect",
  wait: "This can take up to 30 seconds. If Android asks to pair, tap **Pair**.",
  printTest: "Print a test slip",
  printing: "Printing…",
  skip: "Skip",
  addedNote: "Your manager chooses which slips it prints, in Printer setup.",
  came: "Did the test slip come out?",
  yes: "Yes",
  no: "No",
  fix: "Let's fix it",
  tips: ["Paper roll: the shiny side faces the print head.", "Switch the printer off and on.", "Try the other paper width."],
  again: "Print the test slip again",
  other: "Choose another printer",
} as const;

export const connectingWordsOf = (name: string): string => `Connecting to ${name}…`;
export const connectedWordsOf = (name: string): string => `${name} is connected`;
/** The question's Yes: the guided connect's words for the test's success toast. */
export const printingWorksWordsOf = (noun: DeviceNoun): string => `Printing works on ${noun}.`;

export function connectStartOf(entry: ConnectEntry): ConnectState {
  return { step: entry.transport === null ? "type" : "list", mode: entry.mode, transport: entry.transport, target: null, error: null };
}

function failedWordsOf(state: ConnectState): string {
  if (state.mode === "add") return CONNECT_ADD_FAILED;
  return `Could not connect to ${state.target?.name ?? "the printer"}. Check it is on, then try again.`;
}

/** The review's Ruling T11-B: a thrown attempt's own words. A refusal with the app's code reads as the app's sentence
 *  (nativeErrorMessage); an Error already worded keeps its words (nativePool().add throws its refusal worded, with no code,
 *  and nativeErrorMessage would turn it into the write-failed sentence); nothing to say: undefined, the step's words. */
export function attemptErrorWordsOf(error: unknown): string | undefined {
  if (nativeErrorCode(error) !== null) return nativeErrorMessage(error);
  return error instanceof Error && error.message !== "" ? error.message : undefined;
}

/** How a connect that ran ends, as the flow's event (the final review's I1). The app's link never throws a connect: it
 *  publishes why one did not connect in the snapshot's message (Bluetooth off, Location off, busy, the app's own status
 *  sentence) and answers "failed", so a replace says that reason (today's toast read it there); none, the step's words.
 *  An add keeps the step's words (the pool's add publishes nothing there). */
export function connectEndOf(mode: ConnectState["mode"], outcome: ConnectOutcome, reason: string | null): ConnectEvent {
  if (outcome === "connected") return { type: "connected" };
  return mode === "replace" && reason !== null && reason !== "" ? { type: "failed", message: reason } : { type: "failed" };
}

/** Each step and its next; every other pair returns the same state (===), so a late or doubled event changes nothing. */
export function connectFlowReducer(state: ConnectState, event: ConnectEvent): ConnectState {
  switch (`${state.step}+${event.type}`) {
    case "type+choose":
      return event.type === "choose" ? { ...state, step: "list", transport: event.transport, error: null } : state;
    case "list+pick":
      // A fresh try: the last failure's line goes with it.
      return event.type === "pick" ? { ...state, step: "connecting", target: event.target, error: null } : state;
    case "connecting+connected":
      return { ...state, step: "connected" };
    case "connecting+failed":
      return { ...state, step: "list", error: (event.type === "failed" ? event.message : undefined) ?? failedWordsOf(state) };
    case "connected+tested":
      // X4: a printer the setup does not name yet prints nothing, so add mode ends at connected.
      return state.mode === "replace" ? { ...state, step: "question" } : state;
    case "tips+tested":
      return { ...state, step: "question" };
    case "question+not-printed":
      return { ...state, step: "tips" };
    case "tips+other":
      return { ...state, step: "type", target: null, error: null };
    default:
      return state;
  }
}

/** The head's sub ("Step n of 3", the list's transport) and the foot: Cancel until a printer is connected, Done after (X3). */
export function connectHeadOf(state: ConnectState): { sub: string; foot: "cancel" | "done" } {
  switch (state.step) {
    case "type":
      return { sub: "Step 1 of 3", foot: "cancel" };
    case "list":
      return { sub: state.transport === null ? "Step 2 of 3" : `Step 2 of 3 · ${CONNECT_TRANSPORT_WORDS[state.transport]}`, foot: "cancel" };
    case "connecting":
      return { sub: "Step 3 of 3", foot: "cancel" };
    default:
      return { sub: "Step 3 of 3", foot: "done" };
  }
}

/** "Connect it again": the saved printer's way in, when the guided connect has a list for it. */
export function connectTransportOf(word: TransportWord | null): ConnectTransport | null {
  return word === "bluetooth" || word === "usb" || word === "network" ? word : null;
}

export interface ConnectChoice {
  transport: ConnectTransport;
  title: string;
  sub: string;
}

/** Step 1's three rows; USB says where it plugs in (X10). */
export function connectChoicesOf(noun: DeviceNoun): ConnectChoice[] {
  return [
    { transport: "bluetooth", title: "Bluetooth", sub: "Most receipt printers" },
    { transport: "usb", title: "USB cable", sub: `Plugged into ${noun}` },
    { transport: "network", title: "Wi-Fi or network", sub: "On the cafe's network" },
  ];
}

export interface ConnectRow {
  id: string;
  name: string;
  sub: string;
  /** The first paired Bluetooth printer: its Connect is the primary. */
  primary: boolean;
  /** How the app reaches it: a BLE row waits while the app scans (Ruling T11-A). */
  transport: NativeTransport;
}

const bluetoothKeyOf = (printer: NativePrinter): string => (printer.address ?? printer.id.slice(printer.id.indexOf(":") + 1)).toUpperCase();
const bluetoothRank = (printer: NativePrinter): number => (printer.paired === true ? 0 : 2) + (printer.transport === "bt-classic" ? 0 : 1);

/** Bluetooth's rows, ONE per physical printer: a dual-mode printer is listed twice by the app (paired "bt-classic:MAC" and
 *  nearby "ble:MAC"), and two rows for one printer read as two printers. Per MAC the paired entry wins, then the classic
 *  one (it connects while the scan runs; a BLE row waits, T11-A); the row keeps the winner's id, name and kind. Paired
 *  rows first, then nearby, each in the app's order; the first paired row is the primary. */
export function bluetoothRowsOf(entries: readonly NativePrinter[]): ConnectRow[] {
  const winners = new Map<string, NativePrinter>();
  for (const entry of entries) {
    if (entry.transport !== "bt-classic" && entry.transport !== "ble") continue;
    const key = bluetoothKeyOf(entry);
    const held = winners.get(key);
    if (held === undefined || bluetoothRank(entry) < bluetoothRank(held)) winners.set(key, entry);
  }
  const all = [...winners.values()];
  const shown = [...all.filter((printer) => printer.paired === true), ...all.filter((printer) => printer.paired !== true)];
  return shown.map((printer, i) => ({ id: printer.id, name: printer.name, sub: printer.paired === true ? "Paired" : "Nearby", primary: i === 0 && printer.paired === true, transport: printer.transport }));
}

/** The found list's rows: Bluetooth's (one per printer, bluetoothRowsOf) or the USB ones, in the app's order. */
export function connectRowsOf(printers: readonly NativePrinter[], transport: "bluetooth" | "usb"): ConnectRow[] {
  if (transport === "bluetooth") return bluetoothRowsOf(printers);
  return printers.filter((printer) => printer.transport === "usb").map((printer) => ({ id: printer.id, name: printer.name, sub: "USB", primary: false, transport: printer.transport }));
}
