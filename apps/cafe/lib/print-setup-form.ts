import {
  PRINTER_COPIES_MAX,
  PRINTER_COPIES_MIN,
  PRINTER_LAN_DEFAULT_PORT,
  printerClashMessage,
  printerWriterClash,
  type PrinterConfig,
  type PrinterConnection,
  type PrinterDeviceTransport,
  type PrinterPaperWidth,
  type StationConfig,
} from "@pos/shared/print-printers";
import type { PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import { printerTakesSlips, printerWriterDeviceId, routablePrinters } from "@pos/shared/print-printers";
import type { PaperWidth } from "@/lib/constants";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import type { DevicePrinter, NativeDevicePrinter } from "@/lib/printer/device-printer-store";

// Printing redesign, Phase 2 Session 2D (spec §11): the printer form's pure half. Its draft and the body it saves,
// the connection this device's own printer gives (so the agent's printerIsLocal matches it: the address is copied
// from the printer the app or the browser saved, never typed), and "Set up printers". Zero React; the screens are in
// components/print/setup/, the words each printer is shown with in lib/print-setup-text.ts.

type DeviceConnection = Extract<PrinterConnection, { kind: "device" }>;

/** What a printer's connection form holds. "lan": a network printer and the Android app device that prints it;
 *  "device": a printer that only its own device reaches (kept as saved, or this device's own printer). */
export interface PrinterDraft {
  name: string;
  kind: "lan" | "device";
  host: string;
  port: string;
  primaryDeviceId: string;
  device: DeviceConnection | null;
  paper: PrinterPaperWidth;
  bill: boolean;
  kotAll: boolean;
  kotStations: string[];
  notices: boolean;
  eod: boolean;
  copiesKot: number;
  copiesBill: number;
  enabled: boolean;
  /** Session 3B (spec §9.4): the backup printer's id, "" for none. */
  backupPrinterId: string;
}

/** This device's own printer as a printer's connection (spec §11 "This device"), or null when it has none the agent
 *  can print to (no printer, or only the system print window). The Android app's network printer is a LAN printer
 *  this device prints; Bluetooth, BLE and USB keep the app's spelling of the address (printerIsLocal). */
export interface LocalPrinterConnection {
  connection: PrinterConnection;
  primaryDeviceId?: string;
  paper: PrinterPaperWidth;
}

const NATIVE_DEVICE_TRANSPORTS: readonly PrinterDeviceTransport[] = ["bt-classic", "ble", "usb"];
const SERIAL_ADDRESS_FALLBACK = "serial";

function paperOf(paper: string): PrinterPaperWidth {
  return paper === "58mm" ? 58 : 80;
}

/** Session 2E: a printer's paper from the cafe's paper setting (a Windows printer has no saved paper of its own). */
export function printerPaperOf(width: PaperWidth): PrinterPaperWidth {
  return paperOf(width);
}

/** Session 2E (spec §9.2, §11): one of this PC's Windows printers, by the name Windows reports (never typed). */
export function windowsPrinterConnectionOf(deviceId: string, name: string, paper: PrinterPaperWidth): LocalPrinterConnection {
  return { connection: { kind: "device", deviceId, transport: "windows", address: name }, paper };
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, "0");
}

export function localPrinterConnectionOf(input: {
  local: DevicePrinter | null;
  deviceId: string;
  /** The Windows app: the printer chosen there (null: none chosen, or not read yet). */
  desktop: { printerName: string | null } | null;
  defaultPaper: PrinterPaperWidth;
}): LocalPrinterConnection | null {
  const { local, deviceId } = input;
  if (deviceId === "") return null;
  if (input.desktop !== null) {
    // No printer chosen in the Windows app: nothing to save (its slips could never print; the 2D gate's review, M-2).
    const address = input.desktop.printerName?.trim() ?? "";
    return address === "" ? null : { connection: { kind: "device", deviceId, transport: "windows", address }, paper: input.defaultPaper };
  }
  if (local === null) return null;
  const paper = paperOf(local.paper);
  if (local.kind === "ble") return { connection: { kind: "device", deviceId, transport: "web-bluetooth", address: local.deviceId }, paper };
  if (local.kind === "serial") {
    const usb = local.usbVendorId !== undefined && local.usbProductId !== undefined ? `${hex4(local.usbVendorId)}:${hex4(local.usbProductId)}` : SERIAL_ADDRESS_FALLBACK;
    return { connection: { kind: "device", deviceId, transport: "web-serial", address: usb }, paper };
  }
  if (local.transport === "tcp") {
    const rest = local.printerId.startsWith("tcp:") ? local.printerId.slice(4) : local.printerId;
    const cut = rest.lastIndexOf(":");
    const port = Number(rest.slice(cut + 1));
    if (cut <= 0 || !Number.isInteger(port)) return null;
    return { connection: { kind: "lan", host: rest.slice(0, cut), port }, primaryDeviceId: deviceId, paper };
  }
  const transport = NATIVE_DEVICE_TRANSPORTS.find((t) => t === local.transport);
  if (transport === undefined) return null;
  const prefix = `${transport}:`;
  const address = local.printerId.startsWith(prefix) ? local.printerId.slice(prefix.length) : local.printerId;
  return { connection: { kind: "device", deviceId, transport, address }, paper };
}

/** Phase 2 Session 2F1 (spec §9.2, §11): one of the POS app's printers on bridge v2 as a printer's connection, at the
 *  paper the form holds: a network printer this device prints, or a Bluetooth, BLE or USB printer of this device. */
export function appPrinterConnectionOf(printer: NativeDevicePrinter, deviceId: string, paper: PrinterPaperWidth): LocalPrinterConnection | null {
  return localPrinterConnectionOf({ local: { ...printer, paper: paper === 58 ? "58mm" : "80mm" }, deviceId, desktop: null, defaultPaper: paper });
}

/** Session 2F1: a POS app that speaks only bridge v1 (the release APK) prints one printer. */
export function onePrinterAppMessage(name: string): string {
  // "or …": a tablet's version is known from its wake, which it sends only once it prints a printer (the 2E gate's review, M-7).
  return `That device's POS app prints one printer (or has not checked in since it was updated), and it already prints ${name}. Update the POS app on it to print several printers there.`;
}

/** Session 2F1: the devices whose POS app prints one printer: this device when its app speaks only v1, and every other
 *  Android app device whose wake has not said v2 (the go-live run reloads every page, so each says at its next wake). */
export function onePrinterDevicesOf(devices: readonly PrintDeviceSummary[], here: { deviceId: string; native: boolean; v2: boolean }): string[] {
  const others = devices.filter((device) => device.shell === "android" && device.deviceId !== here.deviceId && device.nativeProtocol !== 2).map((device) => device.deviceId);
  return here.native && !here.v2 && here.deviceId !== "" ? [here.deviceId, ...others] : others;
}

/** A new printer: nothing chosen but Notices, on for any printer that ends up taking KOTs (the 2B gate's M-7: a
 *  void, moved or cancel notice reaches a printer only where Notices is on). A saved one: as saved, less any
 *  station that no longer exists (the 2A gate's M4: such an id could never be saved again). An empty list is a list
 *  not read yet (a cafe always has its default station), so it drops nothing (the 2D gate's review, I-1). */
export function printerDraftOf(printer: PrinterConfig | null, stations: readonly StationConfig[]): PrinterDraft {
  if (printer === null) {
    return {
      name: "",
      kind: "lan",
      host: "",
      port: String(PRINTER_LAN_DEFAULT_PORT),
      primaryDeviceId: "",
      device: null,
      paper: 80,
      bill: false,
      kotAll: false,
      kotStations: [],
      notices: true,
      eod: false,
      copiesKot: 1,
      copiesBill: 1,
      enabled: true,
      backupPrinterId: "",
    };
  }
  const known = new Set(stations.map((station) => station.id));
  const c = printer.connection;
  return {
    name: printer.name,
    kind: c.kind,
    host: c.kind === "lan" ? c.host : "",
    port: String(c.kind === "lan" ? c.port : PRINTER_LAN_DEFAULT_PORT),
    primaryDeviceId: printer.primaryDeviceId ?? "",
    device: c.kind === "device" ? c : null,
    paper: printer.paper,
    bill: printer.slips.bill,
    kotAll: printer.slips.kotAll,
    kotStations: stations.length === 0 ? [...printer.slips.kotStations] : printer.slips.kotStations.filter((id) => known.has(id)),
    notices: printer.slips.notices,
    eod: printer.slips.eod,
    copiesKot: printer.copies.kot,
    copiesBill: printer.copies.bill,
    enabled: printer.enabled,
    backupPrinterId: printer.backupPrinterId ?? "",
  };
}

/** The draft with this device's own printer as its connection (a LAN printer this device prints, or a device one). */
export function draftWithLocal(draft: PrinterDraft, local: LocalPrinterConnection): PrinterDraft {
  if (local.connection.kind === "lan") {
    return { ...draft, kind: "lan", host: local.connection.host, port: String(local.connection.port), primaryDeviceId: local.primaryDeviceId ?? "", paper: local.paper };
  }
  return { ...draft, kind: "device", device: local.connection, paper: local.paper };
}

export const PRINTER_NAME_REQUIRED = "Name the printer.";
export const PRINTER_HOST_REQUIRED = "Type the printer's network address.";
export const PRINTER_PORT_INVALID = "The port is a number from 1 to 65535 (usually 9100).";
export const PRINTER_DEVICE_REQUIRED = "Choose the device that prints to this network printer.";
export const PRINTER_LOCAL_REQUIRED = "Connect this device's printer first, then use it here.";
/** The 2E review gate (M-4): on a Windows app that prints on a named printer, the printer is chosen in the form. */
export const PRINTER_WINDOWS_REQUIRED = "Choose the Windows printer.";

function copiesOf(n: number): number {
  return Math.min(PRINTER_COPIES_MAX, Math.max(PRINTER_COPIES_MIN, Math.round(n)));
}

/** The body the save sends, or what is missing in words. Full KOT copy clears the station boxes (a station on a
 *  full-copy printer adds nothing to its paper). One routable printer per printing device, except a Windows PC's
 *  Windows printers, each a different one (Session 2E), and the POS app's printers on bridge v2 (Session 2F1; an app on
 *  v1, `onePrinter`, still one). `localRequired`: the words for a device printer not chosen yet, when the form chooses
 *  it itself (the 2E review gate, M-4: "Choose the Windows printer."). */
export function printerBodyOf(
  draft: PrinterDraft,
  printers: readonly PrinterConfig[],
  editingId?: string,
  localRequired: string = PRINTER_LOCAL_REQUIRED,
  onePrinter: readonly string[] = [],
): { ok: true; body: PrinterBody } | { ok: false; error: string } {
  const name = draft.name.trim();
  if (name === "") return { ok: false, error: PRINTER_NAME_REQUIRED };
  let connection: PrinterConnection;
  let primaryDeviceId: string | undefined;
  if (draft.kind === "lan") {
    const host = draft.host.trim().toLowerCase();
    const port = Number(draft.port.trim());
    if (host === "") return { ok: false, error: PRINTER_HOST_REQUIRED };
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: PRINTER_PORT_INVALID };
    if (draft.primaryDeviceId === "") return { ok: false, error: PRINTER_DEVICE_REQUIRED };
    connection = { kind: "lan", host, port };
    primaryDeviceId = draft.primaryDeviceId;
  } else {
    if (draft.device === null) return { ok: false, error: localRequired };
    connection = draft.device;
  }
  const body: PrinterBody = {
    name,
    connection,
    ...(primaryDeviceId !== undefined ? { primaryDeviceId } : {}),
    paper: draft.paper,
    slips: { bill: draft.bill, kotStations: draft.kotAll ? [] : [...draft.kotStations], kotAll: draft.kotAll, notices: draft.notices, eod: draft.eod },
    copies: { kot: copiesOf(draft.copiesKot), bill: copiesOf(draft.copiesBill) },
    enabled: draft.enabled,
    // Session 3B (spec §9.4): null for none (an absent field keeps a saved backup, A3), and for one the form cannot find
    // among the printers (deleted in the instant before this save): never an error.
    backupPrinterId: draft.backupPrinterId !== "" && draft.backupPrinterId !== editingId && printers.some((printer) => printer.id === draft.backupPrinterId) ? draft.backupPrinterId : null,
  };
  const clash = printerWriterClash(printers, { connection, primaryDeviceId, enabled: draft.enabled, slips: body.slips }, editingId);
  if (clash !== null) return { ok: false, error: printerClashMessage(clash, { connection }) };
  const writer = printerWriterDeviceId({ connection, primaryDeviceId });
  if (writer !== null && onePrinter.includes(writer) && draft.enabled && printerTakesSlips(body.slips)) {
    const other = routablePrinters(printers).find((printer) => printer.id !== editingId && printerWriterDeviceId(printer) === writer);
    if (other !== undefined) return { ok: false, error: onePrinterAppMessage(other.name) };
  }
  return { ok: true, body };
}

/** Session 3B (spec §9.4, §11): the form's words under the backup printer. */
export const BACKUP_PRINTER_NOTE = "Its waiting slips print there, marked BACKUP PRINTER, while its own device is offline or no device can reach it.";

/** Session 3B (spec §9.4): the backup printers the form offers: every other printer routing sends slips to, and the one
 *  already saved (`saved`) when it has stopped taking slips since, marked "(not in use)", so a save keeps it. */
export function backupChoicesOf(printers: readonly PrinterConfig[], printerId: string | null, saved: string): Array<{ id: string; label: string }> {
  const choices = routablePrinters(printers)
    .filter((printer) => printer.id !== printerId)
    .map((printer) => ({ id: printer.id, label: printer.name }));
  const kept = saved === "" || choices.some((choice) => choice.id === saved) ? undefined : printers.find((printer) => printer.id === saved && printer.id !== printerId);
  return kept === undefined ? choices : [...choices, { id: kept.id, label: `${kept.name} (not in use)` }];
}

/** Spec §6.6 "Set up printers": this device's printer becomes Printer 1 with Bill, Full KOT copy, Notices and End
 *  of day, so nothing changes on paper (plan decision 5: a full copy that is its round's only slip is today's KOT). */
export const SETUP_PRINTER_NAME = "Printer 1";

export function setUpPrintersBody(local: LocalPrinterConnection): PrinterBody {
  return {
    name: SETUP_PRINTER_NAME,
    connection: local.connection,
    ...(local.primaryDeviceId !== undefined ? { primaryDeviceId: local.primaryDeviceId } : {}),
    paper: local.paper,
    slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true },
    copies: { kot: 1, bill: 1 },
    enabled: true,
  };
}
