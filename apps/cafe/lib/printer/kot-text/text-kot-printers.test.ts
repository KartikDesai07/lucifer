import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterConfig, PrinterSlips } from "@pos/shared/print-printers";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { Settings } from "@/types";
import type { TextKotEnv } from "./text-kot-print";
import { printerTakesKots, textKotPrintersOf } from "./text-kot-printers";
import { textKotKeyForDevice, textKotKeyForPrinter } from "./text-kot-store";

// Printing Phase 4 (spec 2026-10-15 §5.1): the printers the "Fast text KOTs" section lists on this device: in simple mode
// this device's own printer; in printers mode each printer of the setup it writes that takes kitchen slips. Only one that
// can take raw bytes here is listed, with the same key, paper and writer its slips use (text-kot-print.ts).

const APP: DevicePrinter = { kind: "native", name: "Counter BT", paper: "58mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" };
const SETTINGS = { kotPaperWidth: "80mm" } as unknown as Settings;
const NONE: PrinterSlips = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

function env(over: Partial<TextKotEnv> = {}): TextKotEnv {
  return {
    devicePrinter: () => ({ status: "connected", printer: APP, message: null }),
    desktop: () => null,
    desktopPrintsRaw: () => false,
    rasterCapable: () => true,
    readTextKot: () => null,
    slipCodeStatus: () => "idle",
    writeDevice: async () => undefined,
    writeNative: async () => undefined,
    writeLan: async () => undefined,
    writeRawOn: async () => undefined,
    ...over,
  };
}

const printer = (id: string, name: string, slips: Partial<PrinterSlips>, connection: PrinterConfig["connection"] = { kind: "lan", host: "192.168.1.50", port: 9100 }): PrinterConfig =>
  ({ id, name, connection, order: 0, paper: 80, slips: { ...NONE, ...slips }, copies: { kot: 1, bill: 1 }, enabled: true, primaryDeviceId: "dev-a" }) as PrinterConfig;

const shown = (list: ReturnType<typeof textKotPrintersOf>) => list.map((p) => `${p.name} ${p.paper} ${p.key}`);
const SIMPLE = { printersMode: false, localIds: [], takeoverIds: [], targets: {} };

test("a printer takes kitchen slips through its stations, a full copy or the notices", () => {
  assert.equal(printerTakesKots(printer("a", "A", { kotStations: ["s1"] })), true, "its stations' KOTs");
  assert.equal(printerTakesKots(printer("a", "A", { kotAll: true })), true, "a full copy");
  assert.equal(printerTakesKots(printer("a", "A", { notices: true })), true, "the notices (void, moved, cancel)");
  assert.equal(printerTakesKots(printer("a", "A", { bill: true, eod: true })), false, "bills and End of day only");
});

test("simple mode: this device's own printer, as its slips print", () => {
  assert.deepEqual(shown(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: env() })), [`Counter BT 58mm ${textKotKeyForDevice(APP)}`], "the POS app's printer, at its paper");
  assert.deepEqual(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: env({ devicePrinter: () => ({ status: "none", printer: null, message: null }) }) }), [], "no printer: no section");
  assert.deepEqual(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: env({ rasterCapable: () => false }) }), [], "a plain browser (the print window): no section");
  const windows = env({ desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true });
  assert.deepEqual(shown(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: windows })), [`POS-80 80mm ${textKotKeyForDevice({ kind: "windows", name: "POS-80" })}`], "the Windows app's chosen printer, at the kitchen ticket's paper");
  assert.deepEqual(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: { ...windows, desktop: () => ({ chosen: "POS-80", printMode: "driver" }) } }), [], "Through the Windows driver: not offered");
  assert.deepEqual(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: { ...windows, desktopPrintsRaw: () => false } }), [], "an app before 2.0.2: not offered");
});

test("printers mode: each printer of the setup this device writes that takes kitchen slips, by its route here", () => {
  const kitchen = printer("p-kitchen", "Kitchen", { kotStations: ["s1"] });
  const bar = printer("p-bar", "Bar", { kotAll: true }, { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB:CC:DD:EE:01" });
  const notices = printer("p-notices", "Pass", { notices: true });
  const counter = printer("p-counter", "Counter", { bill: true, eod: true });
  const taken = printer("p-taken", "Upstairs", { kotStations: ["s2"] });
  const agent = {
    printersMode: true,
    localIds: ["p-kitchen", "p-bar", "p-notices", "p-counter", "p-taken"],
    takeoverIds: ["p-taken"],
    targets: {
      "p-kitchen": { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" as const },
      "p-bar": { nativeId: "bt-classic:AA:BB:CC:DD:EE:01", paper: "58mm" as const },
      "p-notices": { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" as const },
      "p-counter": { nativeId: "tcp:192.168.1.60:9100", paper: "80mm" as const },
      "p-taken": { nativeId: "tcp:192.168.1.70:9100", paper: "80mm" as const },
    },
  };
  assert.deepEqual(shown(textKotPrintersOf({ printers: [kitchen, bar, notices, counter, taken], agent, settings: SETTINGS, env: env() })), [
    `Kitchen 80mm ${textKotKeyForPrinter("p-kitchen", { kind: "app", nativeId: "tcp:192.168.1.50:9100" })}`,
    `Bar 58mm ${textKotKeyForPrinter("p-bar", { kind: "app", nativeId: "bt-classic:AA:BB:CC:DD:EE:01" })}`,
    `Pass 80mm ${textKotKeyForPrinter("p-notices", { kind: "app", nativeId: "tcp:192.168.1.50:9100" })}`,
  ], "the KOT printers, not the bill-only one, not one it only takes over for another device (spec §5.3)");
  const none = { printersMode: true, localIds: [], takeoverIds: [], targets: {} };
  assert.deepEqual(textKotPrintersOf({ printers: [kitchen], agent: none, settings: SETTINGS, env: env() }), [], "printers mode with no printer of its own here: none, never this device's own printer (the review's m-1)");
});

test("printers mode: a printer whose slips print as pictures here is not offered", () => {
  const win = printer("p-win", "Kitchen TVS", { kotAll: true }, { kind: "device", deviceId: "dev-a", transport: "windows", address: "Kitchen TVS" });
  const agent = { printersMode: true, localIds: ["p-win"], takeoverIds: [], targets: { "p-win": { printerName: "Kitchen TVS", paper: "80mm" as const } } };
  const windows = (printMode: "direct" | "driver", raw: boolean) => env({ desktop: () => ({ chosen: "POS-80", printMode }), desktopPrintsRaw: () => raw });
  assert.equal(textKotPrintersOf({ printers: [win], agent, settings: SETTINGS, env: windows("direct", true) }).length, 1, "landmark: 2.0.2 and Direct");
  assert.deepEqual(textKotPrintersOf({ printers: [win], agent, settings: SETTINGS, env: windows("driver", true) }), [], "the Windows driver");
  assert.deepEqual(textKotPrintersOf({ printers: [win], agent, settings: SETTINGS, env: windows("direct", false) }), [], "an app before 2.0.2");
  assert.deepEqual(textKotPrintersOf({ printers: [], agent, settings: SETTINGS, env: windows("direct", true) }), [], "a printer the read does not have (yet)");
});

test("printers mode on an app on bridge v1 or a browser: the job prints on the device's one printer, so its route does", () => {
  const kitchen = printer("p-kitchen", "Kitchen", { kotStations: ["s1"] }, { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB:CC:DD:EE:FF" });
  const agent = { printersMode: true, localIds: ["p-kitchen"], takeoverIds: [], targets: {} };
  assert.deepEqual(shown(textKotPrintersOf({ printers: [kitchen], agent, settings: SETTINGS, env: env() })), [`Kitchen 58mm ${textKotKeyForPrinter("p-kitchen", APP)}`], "its key and paper are the device printer's");
});
