import type { PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import { printerActiveWriter, printerProblemOf, printerProblemText, type PrinterFailover } from "@pos/shared/print-failover";
import {
  defaultBillPrinterOf,
  printerTakesSlips,
  printerWriterDeviceId,
  routablePrinterOf,
  routablePrinters,
  type PrinterConfig,
  type PrinterConnection,
  type PrinterDeviceTransport,
  type StationConfig,
} from "@pos/shared/print-printers";

// Printing redesign, Phase 2 Session 2D (spec §10, §11): the words the Printer setup page shows for each printer and
// device: its connection and slips, its state (its printing device's heartbeat, or this device's own printer), what
// the setup leaves without a printer, and which printers a station's delete leaves with nothing (the 2A gate's M5).
// Pure; the screens in components/print/setup/.

const TRANSPORT_WORDS: Record<PrinterDeviceTransport, string> = {
  "bt-classic": "Bluetooth",
  ble: "Bluetooth LE",
  usb: "USB",
  windows: "Windows printer",
  "web-serial": "USB (browser)",
  "web-bluetooth": "Bluetooth (browser)",
};

const DEVICE_ID_TAIL = 4;

/** A device in words: its label, its id's tail (several "POS app" devices look alike), and "this device". */
export function deviceName(deviceId: string, devices: readonly PrintDeviceSummary[], thisDeviceId: string): string {
  if (deviceId === thisDeviceId) return "This device";
  const row = devices.find((device) => device.deviceId === deviceId);
  const tail = deviceId.slice(-DEVICE_ID_TAIL);
  return row === undefined ? `Device …${tail}` : `${row.label} …${tail}`;
}

/** A device printer's connection in words: how its device reaches it, and which device. */
export function deviceConnectionText(c: Extract<PrinterConnection, { kind: "device" }>, devices: readonly PrintDeviceSummary[], thisDeviceId: string): string {
  return `${TRANSPORT_WORDS[c.transport]} · ${deviceName(c.deviceId, devices, thisDeviceId)}`;
}

export function connectionText(printer: PrinterConfig, devices: readonly PrintDeviceSummary[], thisDeviceId: string): string {
  const c = printer.connection;
  if (c.kind === "lan") {
    const by = printer.primaryDeviceId === undefined ? "no printing device" : `printed by ${deviceName(printer.primaryDeviceId, devices, thisDeviceId)}`;
    return `Network ${c.host}:${c.port} · ${by}`;
  }
  // Session 2E (spec §9.2): one PC prints several Windows printers, so a row says which one (its Windows name).
  if (c.transport === "windows") return `Windows printer ${c.address} · ${deviceName(c.deviceId, devices, thisDeviceId)}`;
  return deviceConnectionText(c, devices, thisDeviceId);
}

export function slipsText(printer: PrinterConfig, stations: readonly StationConfig[]): string {
  const names = printer.slips.kotStations.flatMap((id) => stations.filter((station) => station.id === id).map((station) => station.name));
  const parts = [
    ...(printer.slips.bill ? ["Bill"] : []),
    ...(printer.slips.kotAll ? ["Full KOT copy"] : names.map((name) => `${name} KOTs`)),
    ...(printer.slips.notices ? ["Notices"] : []),
    ...(printer.slips.eod ? ["End of day"] : []),
  ];
  return parts.length > 0 ? parts.join(", ") : "No slips";
}

export type PrinterRowTone = "ok" | "bad" | "off";

/** One printer's dot in words (spec §10, Phase 2): its writer's heartbeat, or, when this device is its writer, this
 *  device's own printer. */
export function printerRowState(
  printer: PrinterConfig,
  devices: readonly PrintDeviceSummary[],
  here: { deviceId: string; localIds: readonly string[]; canPrint: boolean; devicesFailed?: boolean; ownState?: boolean },
): { tone: PrinterRowTone; text: string } {
  if (!printer.enabled) return { tone: "off", text: "Switched off" };
  if (!printerTakesSlips(printer.slips)) return { tone: "off", text: "Takes no slips" };
  const writer = printerWriterDeviceId(printer);
  if (writer === null) return { tone: "bad", text: "No printing device" };
  if (writer === here.deviceId) {
    if (!here.localIds.includes(printer.id)) return { tone: "bad", text: "Not this device's printer" };
    if (here.canPrint) return { tone: "ok", text: "Prints on this device" };
    // The 2F1 review gate (M-2): a printer with a state of its own (one of the POS app's, bridge v2) is named.
    return { tone: "bad", text: here.ownState === true ? `${printer.name} is not ready on this device` : "This device's printer is not ready" };
  }
  const row = devices.find((device) => device.deviceId === writer);
  // The 2E review gate (M-3): with the devices read failed, nothing is known of it (not "has not checked in").
  if (row === undefined) return here.devicesFailed === true ? { tone: "off", text: "Its printing device is unknown (the devices did not load)" } : { tone: "bad", text: "Its printing device has not checked in" };
  return row.online ? { tone: "ok", text: `${row.label} is online` } : { tone: "bad", text: `${row.label} is offline` };
}

export const TEST_UNAVAILABLE = "Switch it on, choose its slips and its printing device to test it.";

/** Why a printer's Test print is not offered, or null (the 2D review gate, M-4): one its writer's lease would never
 *  take, or one this device writes but cannot print right now, whose slip would only wait in the panel. A printer
 *  another device prints is tested even while that device is away: its slip prints when it is back. */
export function testPrintBlock(
  printer: PrinterConfig,
  printers: readonly PrinterConfig[],
  here: { deviceId: string; localIds: readonly string[]; canPrint: boolean; ownState?: boolean },
): string | null {
  if (routablePrinterOf(printers, printer.id) === null) return TEST_UNAVAILABLE;
  if (printerWriterDeviceId(printer) !== here.deviceId) return null;
  if (!here.localIds.includes(printer.id)) return "This device prints it, but it is not this device's printer. Edit it first.";
  if (here.canPrint) return null;
  return here.ownState === true ? `Connect ${printer.name} on this device to test it.` : "Connect this device's printer to test it.";
}

/** Session 3B (spec §9.3, §11): what the Devices section says of a device that can take a network printer over. */
export const DEVICE_TAKES_OVER_TEXT = "Can take over network printers";
/** Session 3B: a network printer row with no other device online that could take it over. */
export const PRINTER_NO_TAKEOVER_TEXT = "No other device online can take it over while its printing device is offline.";

/** Session 3B: who is online, from the devices read the page already made (no request of its own). */
function setupFailoverOf(devices: readonly PrintDeviceSummary[], nowMs: number): PrinterFailover {
  return { online: devices.filter((device) => device.online).map((device) => ({ deviceId: device.deviceId, lanFailover: device.lanFailover === true })), nowMs };
}

/** Session 3B (spec §9.3, §9.4, §10): a printer row's failover lines: its backup ("(not in use)" once it stops taking
 *  slips), and for a printer routing sends slips to, who prints it now when another device took it over, the problem
 *  its writer reported (its device offline is the row's own state), and a network printer no other device online could
 *  take over. */
export function printerFailoverLines(printer: PrinterConfig, printers: readonly PrinterConfig[], devices: readonly PrintDeviceSummary[], thisDeviceId: string, nowMs: number): string[] {
  const lines: string[] = [];
  const backup = printer.backupPrinterId === undefined ? undefined : printers.find((row) => row.id === printer.backupPrinterId);
  if (backup !== undefined) lines.push(`Backup: ${backup.name}${routablePrinterOf(printers, backup.id) === null ? " (not in use)" : ""}`);
  if (routablePrinterOf(printers, printer.id) === null) return lines;
  const failover = setupFailoverOf(devices, nowMs);
  const writer = printerActiveWriter(printer, failover);
  if (writer !== null && writer !== printerWriterDeviceId(printer)) lines.push(`Printed now by ${deviceName(writer, devices, thisDeviceId)}`);
  const problem = printerProblemOf(printer, failover);
  if (problem !== null && problem !== "device-offline") lines.push(printerProblemText(printer.name, problem));
  const others = failover.online.some((device) => device.lanFailover && device.deviceId !== printer.primaryDeviceId);
  if (printer.connection.kind === "lan" && !others) lines.push(PRINTER_NO_TAKEOVER_TEXT);
  return lines;
}

/** The toast after a Test print: said plainly when its printing device is away (its slip waits for it). */
export function testPrintSentText(printer: PrinterConfig, state: { tone: PrinterRowTone; text: string }): string {
  const sent = `Test slip sent to ${printer.name}.`;
  return state.tone === "bad" ? `${sent} It prints when its printing device is back online.` : sent;
}

/** What the setup leaves without a printer, in words (printers mode only): bills, a station's KOTs (which then print
 *  at the default bill printer marked NO PRINTER SET, spec §8), and notices. */
export function setupGaps(printers: readonly PrinterConfig[], stations: readonly StationConfig[]): string[] {
  const live = routablePrinters(printers);
  if (live.length === 0) return [];
  const gaps: string[] = [];
  const billPrinter = defaultBillPrinterOf(printers);
  if (billPrinter === null) gaps.push("No printer takes bills: bills will not print.");
  if (!live.some((printer) => printer.slips.kotAll)) {
    for (const station of stations) {
      if (live.some((printer) => printer.slips.kotStations.includes(station.id))) continue;
      gaps.push(
        billPrinter === null
          ? `No printer takes ${station.name} KOTs: they will not print.`
          : `No printer takes ${station.name} KOTs: they print at ${billPrinter.name}, marked NO PRINTER SET.`,
      );
    }
  }
  if (!live.some((printer) => printer.slips.notices)) gaps.push("No printer takes notices: void, moved and cancel slips will not print.");
  return gaps;
}

/** The 2A gate's M5: a station's delete says what changes, and names any printer it leaves with no slip at all. */
export function stationDeleteQuestion(station: StationConfig, printers: readonly PrinterConfig[]): string {
  const empty = printersLeftEmptyBy(printers, station.id).map((printer) => printer.name);
  const base = `Delete ${station.name}? Its categories, items and printers go back to the default station.`;
  return empty.length === 0 ? base : `${base} ${empty.join(", ")} will then take no slips and stop printing.`;
}

/** The 2A gate's M5: the printers a station's delete leaves with no slip at all (they stop printing). Only printers
 *  switched on (the 2D review gate, M-8): one already off does not stop because of the delete. */
export function printersLeftEmptyBy(printers: readonly PrinterConfig[], stationId: string): PrinterConfig[] {
  return printers.filter(
    (printer) =>
      printer.enabled &&
      printer.slips.kotStations.includes(stationId) &&
      !printerTakesSlips({ ...printer.slips, kotStations: printer.slips.kotStations.filter((id) => id !== stationId) }),
  );
}
