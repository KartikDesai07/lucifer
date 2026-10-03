// ─────────────────────────────────────────────────────────────────────────────
// Printing redesign, Phase 2 (docs/superpowers/specs/2026-10-02-printing-
// reliability-design.md §6.1–6.3, §8, §9.3): kitchen stations and printers, the
// shared contract. A cafe stays in simple mode (§6.6: today's one print host, or
// each device printing its own slips) until an enabled printer takes a slip;
// from then on every slip is routed to printers (§8). The server's routing, the
// setup screens and the agent read these same shapes and rules. Pure and
// client-safe: no Node, DB or zod imports.
// ─────────────────────────────────────────────────────────────────────────────

/** A station's name prints on every KOT it gets (§8, D7), so it stays short. */
export const STATION_NAME_MAX_CHARS = 32;
export const STATIONS_MAX = 20;
/** The station the first read seeds (§6.1); every category without a station uses the default one. */
export const DEFAULT_STATION_NAME = "Kitchen";

export const PRINTER_NAME_MAX_CHARS = 40;
export const PRINTERS_MAX = 12;
export const PRINTER_PAPER_WIDTHS = [58, 80] as const;
export type PrinterPaperWidth = (typeof PRINTER_PAPER_WIDTHS)[number];
export const PRINTER_COPIES_MIN = 1;
export const PRINTER_COPIES_MAX = 3;
export const PRINTER_LAN_DEFAULT_PORT = 9100;
/** A device printer's transport-specific id (a Bluetooth address, a USB id, a Windows printer name). */
export const PRINTER_ADDRESS_MAX_CHARS = 256;
/** Equal to the cafe's PRINT_HOST_DEVICE_ID_MAX_CHARS (pinned there): a device id is the same value everywhere. */
export const PRINTER_DEVICE_ID_MAX_CHARS = 64;

/** How the owning device reaches a device printer (§6.3). A Chrome tab drives at most one Web Serial or
 *  Web Bluetooth printer (§9.7). */
export const PRINTER_DEVICE_TRANSPORTS = ["bt-classic", "ble", "usb", "windows", "web-serial", "web-bluetooth"] as const;
export type PrinterDeviceTransport = (typeof PRINTER_DEVICE_TRANSPORTS)[number];

export interface StationConfig {
  id: string;
  name: string;
  order: number;
  isDefault: boolean;
}

export type PrinterConnection =
  | { kind: "lan"; host: string; port: number }
  | { kind: "device"; deviceId: string; transport: PrinterDeviceTransport; address: string };

/** Which slips a printer takes (§6.3). kotStations: the stations whose KOTs it prints; kotAll: a full copy
 *  of every KOT (a counter or expo printer); notices: void, moved and cancel notices for the stations it
 *  serves; eod: End of day. */
export interface PrinterSlips {
  bill: boolean;
  kotStations: string[];
  kotAll: boolean;
  notices: boolean;
  eod: boolean;
}

/** Copies of each KOT and each bill. All copies of one slip are ONE job (Phase 2 decision: a copy never
 *  costs another lease and ack, spec §17). */
export interface PrinterCopies {
  kot: number;
  bill: number;
}

/** A printer as the API sends it and the routing reads it. */
export interface PrinterConfig {
  id: string;
  name: string;
  connection: PrinterConnection;
  /** LAN only: the device that writes to it (Phase 2 requires one; failover to other devices is Phase 3, §9.4). */
  primaryDeviceId?: string;
  /** Display order on Settings → Printers; the first bill printer in this order is the default one. */
  order: number;
  paper: PrinterPaperWidth;
  slips: PrinterSlips;
  copies: PrinterCopies;
  enabled: boolean;
}

/** The one device that writes to this printer (§9.3): a device printer's own device, or a LAN printer's
 *  primary. null: a LAN printer nobody writes to yet, so nothing is routed to it. */
export function printerWriterDeviceId(printer: Pick<PrinterConfig, "connection" | "primaryDeviceId">): string | null {
  if (printer.connection.kind === "device") return printer.connection.deviceId;
  return printer.primaryDeviceId ?? null;
}

/** True when the printer takes at least one kind of slip. */
export function printerTakesSlips(slips: PrinterSlips): boolean {
  return slips.bill || slips.kotAll || slips.kotStations.length > 0 || slips.notices || slips.eod;
}

/** The printers routing may send slips to: enabled, with a writer, taking some slip, in display order
 *  (ties broken by id, so the default bill printer never depends on a read's order). */
export function routablePrinters(printers: readonly PrinterConfig[]): PrinterConfig[] {
  return printers
    .filter((printer) => printer.enabled && printerWriterDeviceId(printer) !== null && printerTakesSlips(printer.slips))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Spec §6.6: simple mode applies while no enabled printer takes a slip. One routable printer switches the
 *  whole cafe to printers mode. */
export function printersModeOn(printers: readonly PrinterConfig[]): boolean {
  return routablePrinters(printers).length > 0;
}

/** The default bill printer (§8): the first routable printer that takes bills. */
export function defaultBillPrinterOf(printers: readonly PrinterConfig[]): PrinterConfig | null {
  return routablePrinters(printers).find((printer) => printer.slips.bill) ?? null;
}

/** The devices that write to a routable printer, each once. In printers mode these are the agents that
 *  share the cafe's one daily wake allowance (§9.1): a fixed set from the setup, so a device that joins
 *  late never raises the total. */
export function printerWriterDevices(printers: readonly PrinterConfig[]): string[] {
  const out: string[] = [];
  for (const printer of routablePrinters(printers)) {
    const writer = printerWriterDeviceId(printer);
    if (writer !== null && !out.includes(writer)) out.push(writer);
  }
  return out;
}

function byOrder(a: StationConfig, b: StationConfig): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The default station (§6.1): the one marked default, else the first in display order (a moment between
 *  "make default" writes, or a database edited by hand, never leaves routing without one). null only when
 *  there are no stations at all. */
export function defaultStationOf(stations: readonly StationConfig[]): StationConfig | null {
  const sorted = [...stations].sort(byOrder);
  return sorted.find((station) => station.isDefault) ?? sorted[0] ?? null;
}

/** Spec §6.2: product.stationId ?? category.stationId ?? the default station. A station that no longer
 *  exists is skipped, so a deleted station falls back the same way. null only when there are no stations. */
export function resolveStationId(
  ids: { productStationId?: string; categoryStationId?: string },
  stations: readonly StationConfig[],
): string | null {
  const known = new Set(stations.map((station) => station.id));
  if (ids.productStationId !== undefined && known.has(ids.productStationId)) return ids.productStationId;
  if (ids.categoryStationId !== undefined && known.has(ids.categoryStationId)) return ids.categoryStationId;
  return defaultStationOf(stations)?.id ?? null;
}
