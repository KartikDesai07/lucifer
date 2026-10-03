import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATION_NAME,
  PRINTER_COPIES_MAX,
  PRINTER_COPIES_MIN,
  PRINTER_DEVICE_TRANSPORTS,
  PRINTER_PAPER_WIDTHS,
  defaultBillPrinterOf,
  defaultStationOf,
  printKotStationHeader,
  printNoPrinterMessage,
  printerTakesSlips,
  printerWriterDeviceId,
  printerWriterDevices,
  printersModeOn,
  resolveStationId,
  routablePrinters,
  type PrinterConfig,
  type StationConfig,
} from "./print-printers";
import { printJobPayloadSchema } from "./schemas/print-job.schema";

// Printing redesign, Phase 2 (spec §6.1–6.3, §8, §9.3): the pure rules every side reads.

const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

function printer(id: string, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id,
    name: `Printer ${id}`,
    connection: { kind: "device", deviceId: `dev-${id}`, transport: "bt-classic", address: "00:11:22:33:44:55" },
    order: 0,
    paper: 80,
    slips: { ...NO_SLIPS, bill: true },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

function station(id: string, order: number, isDefault = false): StationConfig {
  return { id, name: `Station ${id}`, order, isDefault };
}

test("the spec's constants: the seeded station, the paper widths, 1–3 copies, every device transport", () => {
  assert.equal(DEFAULT_STATION_NAME, "Kitchen", "spec §6.1");
  assert.deepEqual([...PRINTER_PAPER_WIDTHS], [58, 80]);
  assert.equal(PRINTER_COPIES_MIN, 1);
  assert.equal(PRINTER_COPIES_MAX, 3);
  assert.deepEqual([...PRINTER_DEVICE_TRANSPORTS], ["bt-classic", "ble", "usb", "windows", "web-serial", "web-bluetooth"]);
});

test("a device printer's writer is its own device; a LAN printer's is its primary, or nobody yet", () => {
  assert.equal(printerWriterDeviceId(printer("a")), "dev-a");
  const lan = printer("b", { connection: { kind: "lan", host: "192.168.1.50", port: 9100 } });
  assert.equal(printerWriterDeviceId(lan), null, "a LAN printer with no primary has no writer in Phase 2");
  assert.equal(printerWriterDeviceId({ ...lan, primaryDeviceId: "tablet-1" }), "tablet-1");
});

test("a printer takes slips when any slip type is on", () => {
  assert.equal(printerTakesSlips(NO_SLIPS), false);
  for (const on of [{ bill: true }, { kotAll: true }, { kotStations: ["s1"] }, { notices: true }, { eod: true }]) {
    assert.equal(printerTakesSlips({ ...NO_SLIPS, ...on }), true, JSON.stringify(on));
  }
});

test("spec §6.6: simple mode until an enabled printer with a writer takes a slip", () => {
  assert.equal(printersModeOn([]), false, "no printers: simple mode");
  assert.equal(printersModeOn([printer("a", { enabled: false })]), false, "a disabled printer never switches the mode");
  assert.equal(printersModeOn([printer("a", { slips: NO_SLIPS })]), false, "a printer that takes nothing never switches the mode");
  assert.equal(
    printersModeOn([printer("a", { connection: { kind: "lan", host: "10.0.0.9", port: 9100 } })]),
    false,
    "a LAN printer nobody writes to yet never switches the mode",
  );
  assert.equal(printersModeOn([printer("a", { enabled: false }), printer("b")]), true);
});

test("routable printers come in display order, ties by id, whatever order the read returned", () => {
  const list = [printer("c", { order: 2 }), printer("b", { order: 1 }), printer("a", { order: 1 }), printer("d", { order: 0, enabled: false })];
  assert.deepEqual(routablePrinters(list).map((p) => p.id), ["a", "b", "c"]);
});

test("the default bill printer is the first routable printer that takes bills (spec §8)", () => {
  const counter = printer("counter", { order: 2 });
  const kitchen = printer("kitchen", { order: 1, slips: { ...NO_SLIPS, kotStations: ["s1"] } });
  const bar = printer("bar", { order: 3 });
  assert.equal(defaultBillPrinterOf([bar, kitchen, counter])?.id, "counter");
  assert.equal(defaultBillPrinterOf([kitchen]), null, "no printer takes bills");
  assert.equal(defaultBillPrinterOf([printer("x", { enabled: false })]), null, "a disabled printer is never the default");
});

test("the writer devices share the cafe's wake allowance: each once, only for routable printers", () => {
  const list = [
    printer("a", { connection: { kind: "device", deviceId: "counter", transport: "usb", address: "usb:0483:5743" } }),
    printer("b", { connection: { kind: "device", deviceId: "counter", transport: "bt-classic", address: "AA:BB" } }),
    printer("c", { connection: { kind: "lan", host: "192.168.1.60", port: 9100 }, primaryDeviceId: "kitchen-tab" }),
    printer("d", { connection: { kind: "lan", host: "192.168.1.61", port: 9100 } }),
    printer("e", { enabled: false, connection: { kind: "device", deviceId: "old-phone", transport: "ble", address: "CC" } }),
  ];
  assert.deepEqual(printerWriterDevices(list), ["counter", "kitchen-tab"]);
});

test("the default station: the one marked default, else the first in order, else none (spec §6.1)", () => {
  assert.equal(defaultStationOf([station("bar", 1), station("kitchen", 0, true)])?.id, "kitchen");
  assert.equal(defaultStationOf([station("bar", 2), station("tandoor", 1)])?.id, "tandoor", "no default flag: the first in order");
  assert.equal(defaultStationOf([station("b", 0, true), station("a", 0, true)])?.id, "a", "two flagged: order, then id");
  assert.equal(defaultStationOf([]), null);
});

test("spec §6.2: product station ?? category station ?? the default; a deleted station falls back", () => {
  const stations = [station("kitchen", 0, true), station("bar", 1), station("tandoor", 2)];
  assert.equal(resolveStationId({ productStationId: "bar", categoryStationId: "tandoor" }, stations), "bar", "the item override wins");
  assert.equal(resolveStationId({ categoryStationId: "tandoor" }, stations), "tandoor", "else the category's");
  assert.equal(resolveStationId({}, stations), "kitchen", "else the default");
  assert.equal(resolveStationId({ productStationId: "gone", categoryStationId: "tandoor" }, stations), "tandoor", "a deleted item station falls back to the category's");
  assert.equal(resolveStationId({ productStationId: "gone", categoryStationId: "gone-too" }, stations), "kitchen", "and then to the default");
  assert.equal(resolveStationId({ productStationId: "bar" }, []), null, "no stations at all: none");
});

test("a station KOT's header line (spec §8): the name, the full copy, the station with no printer", () => {
  assert.equal(printKotStationHeader({ name: "Bar", mode: "station" }), "BAR");
  assert.equal(printKotStationHeader({ name: "All stations", mode: "all" }), "ALL STATIONS");
  assert.equal(printKotStationHeader({ name: "Tandoor", mode: "no-printer" }), "TANDOOR (NO PRINTER SET)");
  assert.equal(printNoPrinterMessage("Bar"), "No printer is set up for Bar.");
});

const SNAPSHOT = {
  _id: "665f0a0000000000000000a1",
  orderId: "ORD-0001",
  customerName: "Walk-in",
  items: [{ productId: "p1", name: "Tea", price: 20, qty: 1, modifiers: [], instructions: "", kotRound: 1 }],
  subtotal: 20,
  discount: 0,
  total: 20,
  paidAmount: 0,
  payment: "Cash",
  status: "Pending",
  receiver: "Staff",
  kotRounds: 1,
  createdAt: "2026-10-03T10:00:00.000Z",
};

test("a KOT payload may name its station; today's KOT (no station) still parses; the station is checked", () => {
  const kot = { kind: "kot", snapshot: SNAPSHOT, round: 1 };
  assert.equal(printJobPayloadSchema.safeParse(kot).success, true, "a simple-mode KOT is unchanged");
  for (const mode of ["station", "all", "no-printer"]) {
    assert.equal(printJobPayloadSchema.safeParse({ ...kot, station: { name: "Bar", mode } }).success, true, mode);
  }
  assert.equal(printJobPayloadSchema.safeParse({ ...kot, station: { name: "Bar", mode: "kitchen" } }).success, false, "an unknown mode");
  assert.equal(printJobPayloadSchema.safeParse({ ...kot, station: { name: "", mode: "station" } }).success, false, "a blank name");
  assert.equal(printJobPayloadSchema.safeParse({ ...kot, station: { name: "x".repeat(33), mode: "station" } }).success, false, "a name longer than a station's");
  assert.equal(printJobPayloadSchema.safeParse({ ...kot, station: { name: "Bar", mode: "station", id: "x" } }).success, false, "strict");
  const bill = { kind: "bill", snapshot: SNAPSHOT, station: { name: "Bar", mode: "station" } };
  assert.equal(printJobPayloadSchema.safeParse(bill).success, false, "only a KOT names a station");
});
