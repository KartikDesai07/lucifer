import type { PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import {
  defaultBillPrinterOf,
  printerTakesSlips,
  printerWriterDeviceId,
  routablePrinters,
  type PrinterConfig,
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

export function connectionText(printer: PrinterConfig, devices: readonly PrintDeviceSummary[], thisDeviceId: string): string {
  const c = printer.connection;
  if (c.kind === "lan") {
    const by = printer.primaryDeviceId === undefined ? "no printing device" : `printed by ${deviceName(printer.primaryDeviceId, devices, thisDeviceId)}`;
    return `Network ${c.host}:${c.port} · ${by}`;
  }
  return `${TRANSPORT_WORDS[c.transport]} · ${deviceName(c.deviceId, devices, thisDeviceId)}`;
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
  here: { deviceId: string; localIds: readonly string[]; canPrint: boolean },
): { tone: PrinterRowTone; text: string } {
  if (!printer.enabled) return { tone: "off", text: "Switched off" };
  if (!printerTakesSlips(printer.slips)) return { tone: "off", text: "Takes no slips" };
  const writer = printerWriterDeviceId(printer);
  if (writer === null) return { tone: "bad", text: "No printing device" };
  if (writer === here.deviceId) {
    if (!here.localIds.includes(printer.id)) return { tone: "bad", text: "Not this device's printer" };
    return here.canPrint ? { tone: "ok", text: "Prints on this device" } : { tone: "bad", text: "This device's printer is not ready" };
  }
  const row = devices.find((device) => device.deviceId === writer);
  if (row === undefined) return { tone: "bad", text: "Its printing device has not checked in" };
  return row.online ? { tone: "ok", text: `${row.label} is online` } : { tone: "bad", text: `${row.label} is offline` };
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

/** The 2A gate's M5: the printers a station's delete leaves with no slip at all (they stop printing). */
export function printersLeftEmptyBy(printers: readonly PrinterConfig[], stationId: string): PrinterConfig[] {
  return printers.filter(
    (printer) => printer.slips.kotStations.includes(stationId) && !printerTakesSlips({ ...printer.slips, kotStations: printer.slips.kotStations.filter((id) => id !== stationId) }),
  );
}
