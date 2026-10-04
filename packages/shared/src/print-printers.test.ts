import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATION_NAME,
  PRINTERS_MAX,
  PRINTER_COPIES_MAX,
  PRINTER_COPIES_MIN,
  PRINTER_DEVICE_TRANSPORTS,
  PRINTER_PAPER_WIDTHS,
  PRINT_JOB_NO_PRINTER,
  PRINT_TEST_LINES_MAX,
  PRINT_TEST_LINE_MAX_CHARS,
  defaultBillPrinterOf,
  defaultStationOf,
  printKotStationHeader,
  printerWriterClash,
  printerWriterTakenMessage,
  printNoPrinterMessage,
  printerIdsOf,
  printerTakesSlips,
  printerWriterDeviceId,
  printerWriterDevices,
  printersModeOn,
  resolveStationId,
  routablePrinterOf,
  routablePrinters,
  type PrinterConfig,
  type StationConfig,
} from "./print-printers";
import { printJobPayloadSchema } from "./schemas/print-job.schema";
import { PRINT_WAKE_PRINTERS_DAILY_CAP, printAgentDailyCap, printWakeAgentCap } from "./print-agent-wire";

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

// Phase 2 Session 2C: the printers a device names in a request (the ready header, the lease body, the pulse),
// and the printer a waiting job still has.
test("2C: the printers a device names are printer ids only, each once, at most twelve; a gone printer is not routable", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  assert.deepEqual(printerIdsOf(`${a}, ${b},${a}`), [a, b], "a header: trimmed, each once, in order");
  assert.deepEqual(printerIdsOf([a, "nope", "", b]), [a, b], "a body: anything that is not a printer id is dropped");
  assert.deepEqual([printerIdsOf(null), printerIdsOf(undefined), printerIdsOf("")], [[], [], []], "none named");
  const many = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(24, "0"));
  assert.equal(printerIdsOf(many).length, PRINTERS_MAX, "never more than a cafe can have");
  const printers = [printer("p1"), printer("p2", { enabled: false }), printer("p3", { slips: NO_SLIPS })];
  assert.equal(routablePrinterOf(printers, "p1")?.id, "p1", "enabled, with a writer, taking a slip");
  assert.equal(routablePrinterOf(printers, "p2"), null, "switched off");
  assert.equal(routablePrinterOf(printers, "p3"), null, "takes no slip");
  assert.equal(routablePrinterOf(printers, "p9"), null, "removed");
  assert.equal(routablePrinterOf(printers, PRINT_JOB_NO_PRINTER), null, "the no-printer mark is never a printer");
});

// Session 2C (the 2A gate's Important 1, the server half): each agent's share of the wake. Printers mode splits
// the cafe's 14,000 by the writers the setup names, never by who is online; simple mode keeps 14,400 by agents.
test("2C: the wake allowance per agent: printers mode by the setup's writers, simple mode by the agents online", () => {
  const two = [printer("p1"), printer("p2"), printer("p3", { connection: { kind: "device", deviceId: "dev-p1", transport: "usb", address: "x" } })];
  assert.equal(printAgentDailyCap(two, 5), Math.floor(PRINT_WAKE_PRINTERS_DAILY_CAP / 2), "two writers (dev-p1 writes two printers), however many are online");
  assert.equal(printAgentDailyCap([], 3), printWakeAgentCap(3), "simple mode: today's split");
  assert.equal(printAgentDailyCap([printer("off", { enabled: false })], 1), printWakeAgentCap(1), "a disabled printer keeps simple mode");
});

// Phase 2 Session 2D (until Session 2E's several printers per device, spec §9.2): a device prints one printer, so
// at most one enabled printer names it as its writer. A second would never print (or, for a Windows or browser
// serial printer, print on the first one's paper: the 2C review gate, F-3).
test("2D: one routable printer per printing device; one switched off or taking no slip, the printer itself or another device never clash", () => {
  const kitchen = printer("kitchen");
  const slips = { ...NO_SLIPS, notices: true };
  const lanSame = { connection: { kind: "lan" as const, host: "10.0.0.9", port: 9100 }, primaryDeviceId: "dev-kitchen", enabled: true, slips };
  assert.equal(printerWriterClash([kitchen], lanSame)?.id, "kitchen", "a LAN printer whose printing device already prints the kitchen's");
  const deviceSame = { connection: { kind: "device" as const, deviceId: "dev-kitchen", transport: "usb" as const, address: "04b8:0e15" }, enabled: true, slips };
  assert.equal(printerWriterClash([kitchen], deviceSame)?.id, "kitchen", "a device printer on that same device");
  assert.equal(printerWriterClash([kitchen], { ...lanSame, enabled: false }), null, "saved switched off: never leased, so never a clash");
  assert.equal(printerWriterClash([kitchen], { ...lanSame, slips: NO_SLIPS }), null, "saved taking no slip: never leased either (the 2D gate's review, M-4)");
  assert.equal(printerWriterClash([printer("kitchen", { enabled: false })], lanSame), null, "the other one is switched off");
  assert.equal(printerWriterClash([printer("kitchen", { slips: NO_SLIPS })], lanSame), null, "the other one takes no slip");
  assert.equal(printerWriterClash([kitchen], lanSame, "kitchen"), null, "the printer being saved is not its own clash");
  assert.equal(printerWriterClash([kitchen], { ...lanSame, primaryDeviceId: "dev-x" }), null, "another device");
  assert.equal(printerWriterClash([kitchen], { connection: lanSame.connection, enabled: true, slips }), null, "a LAN printer with no printing device has no writer");
  assert.equal(printerWriterTakenMessage("Kitchen"), "That device already prints Kitchen. For now one device prints one printer: switch Kitchen off, or choose another device.");
});

// Phase 2 Session 2D (spec §11): a printer's test slip. The server writes its lines from the stored printer, so
// it carries no order, no station and no key.
test("2D: a test slip names its printer, at most ten short lines, who asked and when; nothing else", () => {
  const ok = { kind: "test", printerName: "Kitchen printer", lines: ["Network printer 192.168.1.60:9100"], requestedBy: "Asha", requestedAt: "2026-10-04T10:00:00.000Z" };
  assert.equal(printJobPayloadSchema.safeParse(ok).success, true, "a test slip parses");
  assert.equal(printJobPayloadSchema.safeParse({ ...ok, lines: [] }).success, true, "no lines: the name and the time still print");
  assert.equal(printJobPayloadSchema.safeParse({ ...ok, printerName: "" }).success, false, "a blank name");
  assert.equal(printJobPayloadSchema.safeParse({ ...ok, printerName: "x".repeat(41) }).success, false, "a name longer than a printer's");
  assert.equal(printJobPayloadSchema.safeParse({ ...ok, lines: Array.from({ length: PRINT_TEST_LINES_MAX + 1 }, () => "x") }).success, false, "too many lines");
  assert.equal(printJobPayloadSchema.safeParse({ ...ok, lines: ["x".repeat(PRINT_TEST_LINE_MAX_CHARS + 1)] }).success, false, "a line too long");
  assert.equal(printJobPayloadSchema.safeParse({ ...ok, snapshot: SNAPSHOT }).success, false, "strict: no order rides along");
});
