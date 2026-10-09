import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { PrinterConfig } from "@pos/shared/print-printers";
import { stripComments } from "@/lib/source-pin-utils";
import { PRINT_JOBS_FOR_ME_LIMIT } from "@pos/shared/print-agent-wire";
import {
  PRINTER_NOT_LOCAL_MESSAGE,
  agentPrintersOf,
  dotPrintersOf,
  jobsForMeLeasable,
  lanPrintersToAdd,
  lanPrintersToRemove,
  nativeIdOf,
  ownPrinterInSetup,
  PRINTER_TAKEOVER_MESSAGE,
  printJobCopies,
  printerIsLocal,
  printerListLooksStale,
  readyPrinterIdsOf,
  takeoverPrintersOf,
  type DesktopPrinters,
} from "@/lib/print-agent-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import { DESKTOP_LAN_CHECK_MS } from "@/lib/printer/desktop-lan";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Phase 2 Session 2C (spec §9.3, plan decision 1): the printers this device writes, and which of them it prints
// on its one local printer (until Session 2E). Pure; the agent hook reads it.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const SLIPS = { bill: true, kotStations: [], kotAll: false, notices: false, eod: false };

function printer(id: string, connection: PrinterConfig["connection"], over: Partial<PrinterConfig> = {}): PrinterConfig {
  return { id, name: id, connection, order: 0, paper: 80, slips: SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

const NATIVE_TCP: DevicePrinter = { kind: "native", name: "LAN", paper: "80mm", printerId: "tcp:192.168.1.60:9100", transport: "tcp" };
// The ids the Android app reports (Kotlin PrinterIds, stored verbatim by nativeRecordOf): "<transport>:<id>".
const NATIVE_BT: DevicePrinter = { kind: "native", name: "BT", paper: "58mm", printerId: "bt-classic:00:11:22:33:44:55", transport: "bt-classic" };
const NATIVE_BLE: DevicePrinter = { kind: "native", name: "BLE", paper: "58mm", printerId: "ble:00:11:22:33:44:55", transport: "ble" };
const NATIVE_USB: DevicePrinter = { kind: "native", name: "USB", paper: "80mm", printerId: "usb:0416:5011", transport: "usb" };
const WEB_BLE: DevicePrinter = { kind: "ble", name: "BLE", paper: "58mm", deviceId: "ble-1", serviceUuid: "s", characteristicUuid: "c" };
const WEB_SERIAL: DevicePrinter = { kind: "serial", name: "USB", paper: "80mm" };
// Phase 2 Session 2E (spec §9.2): the Windows app's printers, by name. NAMED: an app that prints on a named printer
// (printHtmlOn, desktop 1.11.0); OLD: one that prints only on its chosen printer.
const WIN_NAMED: DesktopPrinters = { selected: "EPSON TM-T82", names: ["EPSON TM-T82", "Kitchen TVS"], named: true };
const WIN_OLD: DesktopPrinters = { ...WIN_NAMED, named: false };
// Phase 3 Session 3E (spec §9.6): the Windows app 1.12.0 writes network printers itself (raw TCP).
const WIN_LAN: DesktopPrinters = { ...WIN_NAMED, lan: true };

test("printerIsLocal: a printer is printed here only when it IS this device's printer", () => {
  const lan = printer("lan", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a" });
  assert.equal(printerIsLocal(lan, NATIVE_TCP, null), true, "the app's selected network printer, same host and port");
  assert.equal(printerIsLocal({ ...lan, connection: { kind: "lan", host: "192.168.1.60", port: 9101 } }, NATIVE_TCP, null), false, "another port");
  assert.equal(printerIsLocal(lan, NATIVE_BT, null), false, "a Bluetooth printer is not that LAN printer");
  const bt = printer("bt", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "00:11:22:33:44:55" });
  assert.equal(printerIsLocal(bt, NATIVE_BT, null), true, "the paired printer by its address");
  assert.equal(printerIsLocal({ ...bt, connection: { ...bt.connection, address: "AA:BB" } as PrinterConfig["connection"] }, NATIVE_BT, null), false, "another paired printer");
  // Session 2C's final review (I-1): the app names its printer "<transport>:<id>"; the setup's address is the bare
  // id (§6.3), or the app's whole id when the setup stored what the app reported.
  assert.equal(printerIsLocal(printer("bt2", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "bt-classic:00:11:22:33:44:55" }), NATIVE_BT, null), true, "the app's whole id");
  const ble = printer("ble-n", { kind: "device", deviceId: "dev-a", transport: "ble", address: "00:11:22:33:44:55" });
  assert.equal(printerIsLocal(ble, NATIVE_BLE, null), true, "a BLE printer by its address");
  assert.equal(printerIsLocal(ble, NATIVE_BT, null), false, "the same address over another transport is another printer");
  assert.equal(printerIsLocal(printer("usb", { kind: "device", deviceId: "dev-a", transport: "usb", address: "0416:5011" }), NATIVE_USB, null), true, "a USB printer by its vendor:product id");
  assert.equal(printerIsLocal(printer("usb2", { kind: "device", deviceId: "dev-a", transport: "usb", address: "0416:5012" }), NATIVE_USB, null), false, "another USB model");
  assert.equal(printerIsLocal(printer("ble", { kind: "device", deviceId: "dev-a", transport: "web-bluetooth", address: "ble-1" }), WEB_BLE, null), true);
  assert.equal(printerIsLocal(printer("ser", { kind: "device", deviceId: "dev-a", transport: "web-serial", address: "usb" }), WEB_SERIAL, null), true, "a tab drives one serial printer");
  const win = printer("win", { kind: "device", deviceId: "dev-a", transport: "windows", address: "EPSON TM-T82" });
  assert.equal(printerIsLocal(win, null, WIN_OLD), true, "the Windows app prints the Windows printer chosen there");
  assert.equal(printerIsLocal(win, null, null), false, "a browser does not");
  assert.equal(printerIsLocal(bt, null, null), false, "no printer saved here");
});

// The 2C review gate (F-2): the app spells a MAC upper-case and a USB id lower-case (Kotlin PrinterIds); an
// address typed or copied by hand may not, and a printer that is never this device's waits forever.
test("2C gate (F-2): a Bluetooth, BLE or USB printer is this device's printer whatever the case of its address", () => {
  const mac = "aa:bb:cc:dd:ee:ff";
  const btApp: DevicePrinter = { kind: "native", name: "BT", paper: "58mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" };
  assert.equal(printerIsLocal(printer("bt", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: mac }), btApp, null), true, "a lower-case MAC");
  assert.equal(printerIsLocal(printer("bt", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: `bt-classic:${mac}` }), btApp, null), true, "the whole id, lower-case");
  const usbApp: DevicePrinter = { kind: "native", name: "USB", paper: "80mm", printerId: "usb:04b8:0e15", transport: "usb" };
  assert.equal(printerIsLocal(printer("usb", { kind: "device", deviceId: "dev-a", transport: "usb", address: "04B8:0E15" }), usbApp, null), true, "an upper-case USB id");
  assert.equal(printerIsLocal(printer("ble", { kind: "device", deviceId: "dev-a", transport: "ble", address: mac }), btApp, null), false, "case never makes another transport match");
});

test("agentPrintersOf: printers mode, whether this device writes one, and the ones it prints here", () => {
  const counter = printer("counter", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a" });
  const kitchen = printer("kitchen", { kind: "lan", host: "192.168.1.61", port: 9100 }, { primaryDeviceId: "dev-k" });
  const bar = printer("bar", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB" });
  const off = printer("off", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a", enabled: false });
  assert.deepEqual(agentPrintersOf([counter, kitchen, bar, off], "dev-a", NATIVE_TCP, null), { printersMode: true, isWriter: true, localIds: ["counter"], lanIds: ["counter"], takeoverIds: [], takeoverMissingIds: [], windowsMissingIds: [], targets: {} }, "it writes the counter and the bar; only the counter is its printer (a network printer: Session 3B's lanIds)");
  assert.deepEqual(agentPrintersOf([counter, kitchen], "dev-p", NATIVE_TCP, null), { printersMode: true, isWriter: false, localIds: [], lanIds: [], takeoverIds: [], takeoverMissingIds: [], windowsMissingIds: [], targets: {} }, "an ordering phone writes nothing");
  assert.deepEqual(agentPrintersOf([], "dev-a", NATIVE_TCP, null), { printersMode: false, isWriter: false, localIds: [], lanIds: [], takeoverIds: [], takeoverMissingIds: [], windowsMissingIds: [], targets: {} }, "simple mode");
  assert.deepEqual(agentPrintersOf([counter], "", NATIVE_TCP, null), { printersMode: true, isWriter: false, localIds: [], lanIds: [], takeoverIds: [], takeoverMissingIds: [], windowsMissingIds: [], targets: {} }, "no device identity");
});

// Phase 2 Session 2E (spec §9.2): one Windows PC prints several printers, each by its own Windows name. An older app
// prints only its chosen printer, so another Windows printer is never local there: its slips wait, visibly, rather than
// print on the chosen printer's paper (the 2C gate's F-3).
test("2E: a Windows printer is this PC's printer by its name: any printer Windows reports on an app that prints on a named printer, only the chosen one on an older app", () => {
  const counter = printer("counter", { kind: "device", deviceId: "dev-a", transport: "windows", address: "EPSON TM-T82" });
  const kitchen = printer("kitchen", { kind: "device", deviceId: "dev-a", transport: "windows", address: "Kitchen TVS" });
  const gone = printer("gone", { kind: "device", deviceId: "dev-a", transport: "windows", address: "Old printer" });
  assert.equal(printerIsLocal(kitchen, null, WIN_NAMED), true, "a printer Windows reports on this PC");
  assert.equal(printerIsLocal(gone, null, WIN_NAMED), false, "a printer this PC no longer has");
  assert.equal(printerIsLocal(kitchen, null, WIN_OLD), false, "an older app: never another printer's slips on the chosen printer's paper");
  assert.equal(printerIsLocal(counter, null, WIN_OLD), true, "its chosen printer");
  assert.equal(printerIsLocal(kitchen, null, { ...WIN_NAMED, names: null }), false, "the list not read yet: nothing local yet");
  assert.equal(printerIsLocal(kitchen, null, null), false, "not the Windows app");
});

test("2E: each Windows printer this PC prints gets its target (its name and its paper); none on an older app or another lane", () => {
  const counter = printer("counter", { kind: "device", deviceId: "dev-a", transport: "windows", address: "EPSON TM-T82" });
  const kitchen = printer("kitchen", { kind: "device", deviceId: "dev-a", transport: "windows", address: "Kitchen TVS" }, { paper: 58 });
  const theirs = printer("theirs", { kind: "device", deviceId: "dev-b", transport: "windows", address: "Kitchen TVS" });
  const both = agentPrintersOf([counter, kitchen, theirs], "dev-a", null, WIN_NAMED);
  assert.deepEqual(both.localIds, ["counter", "kitchen"], "both printers of this PC, not another PC's");
  assert.deepEqual(both.targets, { counter: { printerName: "EPSON TM-T82", paper: "80mm" }, kitchen: { printerName: "Kitchen TVS", paper: "58mm" } });
  const old = agentPrintersOf([counter, kitchen], "dev-a", null, WIN_OLD);
  assert.deepEqual([old.localIds, old.targets], [["counter"], {}], "an older app: its chosen printer, printed as before, named nowhere");
  assert.deepEqual(agentPrintersOf([counter], "dev-a", NATIVE_TCP, null).targets, {}, "not the Windows app");
  assert.deepEqual(dotPrintersOf([counter, kitchen], "dev-a", null, WIN_OLD), { printersMode: true, isWriter: true, allLocal: false }, "the dot shows the printer an older app cannot print");
});

// The 2C gate's review (I-2) and its emulator run: a list goes stale both ways when a print-setup frame is missed.
// A device made a writer hears of its printer's jobs; a writer whose printer was removed or moved hears it from the
// wake, or it would poll the wake all day for nothing. A host in simple mode is never a writer: it never re-reads.
test("2D: the dot's view of printers mode: on or off, whether this device writes a printer, and whether it prints every one it writes", () => {
  const counter = printer("counter", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a" });
  const bar = printer("bar", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "00:11:22:33:44:55" });
  assert.deepEqual(dotPrintersOf([counter], "dev-a", NATIVE_TCP, null), { printersMode: true, isWriter: true, allLocal: true }, "it writes the counter, which is its printer");
  assert.deepEqual(dotPrintersOf([counter, bar], "dev-a", NATIVE_TCP, null), { printersMode: true, isWriter: true, allLocal: false }, "it also writes the bar, not its printer");
  assert.deepEqual(dotPrintersOf([counter], "dev-p", null, null), { printersMode: true, isWriter: false, allLocal: true }, "an ordering phone");
  assert.deepEqual(dotPrintersOf([], "dev-a", NATIVE_TCP, null), { printersMode: false, isWriter: false, allLocal: true }, "simple mode");
});

test("printerListLooksStale: a printer job it does not print on, or a writer the setup no longer names", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  const jobs = (printerIds?: string[]) => ({ count: 1, oldestCreatedAt: null, ...(printerIds === undefined ? {} : { printerIds }) });
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, jobsForMe: jobs([a]) }), false, "its own printer's job");
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, jobsForMe: jobs([a, b]) }), true, "a printer it does not know of");
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, jobsForMe: jobs([b]) }), true, "made a writer while the frame was missed");
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, jobsForMe: jobs() }), false, "its own simple-mode line");
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, writesPrinters: false }), true, "its printer removed or moved");
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, writesPrinters: true }), false);
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true }), false, "an older server says nothing");
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, writesPrinters: false }), false, "the host in simple mode");
});

// Session 2C's final review (I-2): jobs-for-me counts every job aimed at the device, including ones on a printer it
// does not print on (a second printer it writes, before Session 2E; a printer whose address is not its own). A kick
// on those leased nothing, on every pulse and every wake, with the wake's fast cadence re-armed: a loop.
test("jobsForMeLeasable: only jobs this agent can lease kick it: its own line, or a printer it prints here", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  assert.equal(jobsForMeLeasable(undefined, [a]), false, "nothing counted");
  assert.equal(jobsForMeLeasable({ count: 0, oldestCreatedAt: null }, [a]), false, "an empty count");
  assert.equal(jobsForMeLeasable({ count: 2, oldestCreatedAt: null }, []), true, "its own simple-mode line (or an older server)");
  assert.equal(jobsForMeLeasable({ count: 1, oldestCreatedAt: null, printerIds: [a] }, [a]), true, "a printer it prints here");
  assert.equal(jobsForMeLeasable({ count: 3, oldestCreatedAt: null, printerIds: [b, a] }, [a]), true, "one of them is");
  assert.equal(jobsForMeLeasable({ count: 1, oldestCreatedAt: null, printerIds: [b] }, [a]), false, "only a printer it does not print on: no kick");
  assert.equal(jobsForMeLeasable({ count: 2, oldestCreatedAt: null, printerIds: [b], ownLine: true }, [a]), true, "beside a job on its own line");
});

// The 2C review gate (F-1): jobs-for-me reads the oldest PRINT_JOBS_FOR_ME_LIMIT jobs, so a full answer cannot
// vouch for the jobs past them: one the agent can lease may wait behind twenty it cannot.
test("2C gate (F-1): a full jobs-for-me answer may hide a job the agent can lease behind the ones it names, so it kicks", () => {
  const full = { count: PRINT_JOBS_FOR_ME_LIMIT, oldestCreatedAt: "2026-10-04T10:00:00.000Z", printerIds: ["second"] };
  assert.equal(jobsForMeLeasable(full, ["kitchen"]), true, "twenty jobs on a printer it does not print on: its own may be the twenty-first");
  assert.equal(jobsForMeLeasable({ ...full, count: PRINT_JOBS_FOR_ME_LIMIT - 1 }, ["kitchen"]), false, "a shorter answer names every job, and none is its own");
  assert.equal(PRINT_JOBS_FOR_ME_LIMIT, 20, "the read's limit, shared by the server and the page");
});

// ── Phase 2 Session 2F1 (spec §9.2): the POS app on bridge v2 prints each of its printers ────────────────────────────

const POOL = {
  printers: [
    { id: "tcp:10.0.2.2:9100", status: "connected" as const },
    { id: "tcp:10.0.2.2:9101", status: "disconnected" as const },
    { id: "bt-classic:00:11:22:33:44:55", status: "connected" as const },
    { id: "usb:0416:5011", status: "connecting" as const },
  ],
};

test("2F1: on bridge v2 every printer of the app is this device's, by the app's id (ignoring case); on v1 only the device's own", () => {
  const kitchen = printer("kitchen", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const bar = printer("bar", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-a" });
  const elsewhere = printer("x", { kind: "lan", host: "10.0.2.2", port: 9102 }, { primaryDeviceId: "dev-a" });
  const bt = printer("bt", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "00:11:22:33:44:55" });
  const btWhole = printer("bt2", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "BT-CLASSIC:00:11:22:33:44:55" });
  const usb = printer("usb", { kind: "device", deviceId: "dev-a", transport: "usb", address: "0416:5011" });
  const ble = printer("ble", { kind: "device", deviceId: "dev-a", transport: "ble", address: "00:11:22:33:44:55" });
  assert.deepEqual([kitchen, bar, bt, btWhole, usb].map((p) => nativeIdOf(p, POOL)), ["tcp:10.0.2.2:9100", "tcp:10.0.2.2:9101", "bt-classic:00:11:22:33:44:55", "bt-classic:00:11:22:33:44:55", "usb:0416:5011"], "each by the app's id");
  assert.deepEqual([nativeIdOf(elsewhere, POOL), nativeIdOf(ble, POOL), nativeIdOf(bt, null)], [null, null, null], "not in the app's list, another transport, or no v2 app");
  assert.deepEqual([kitchen, bar, bt, usb].map((p) => printerIsLocal(p, NATIVE_TCP, null, POOL)), [true, true, true, true], "every printer of the app prints here");
  assert.equal(printerIsLocal(elsewhere, NATIVE_TCP, null, POOL), false, "a network printer the app does not have");
  const stale = printer("stale", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a" });
  assert.deepEqual([printerIsLocal(stale, NATIVE_TCP, null, POOL), printerIsLocal(stale, NATIVE_TCP, null)], [false, true], "on v2 the app's list decides: a device printer record the app no longer lists makes nothing local (the 2E gate's review, I-2)");
  const upper = printer("upper", { kind: "lan", host: "PRINTER.LOCAL", port: 9100 }, { primaryDeviceId: "dev-a" });
  const appLower: DevicePrinter = { ...NATIVE_TCP, printerId: "tcp:printer.local:9100" };
  assert.equal(printerIsLocal(upper, appLower, null), true, "on v1 too a network printer's host is compared ignoring case (the 2D gate's note)");
  assert.equal(printerIsLocal(bar, NATIVE_TCP, null), false, "on v1 the device prints its one printer only");
});

test("2F1: each printer of the app it prints carries its target (the app's id, its own paper); a Windows printer's stays", () => {
  const kitchen = printer("kitchen", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const bar = printer("bar", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-a", paper: 58 });
  // Session 3B (deliberate change): another device's printer at an address the app does not list; one the app lists is a
  // printer this device may take over (its own test below).
  const other = printer("other", { kind: "lan", host: "10.0.2.9", port: 9100 }, { primaryDeviceId: "dev-b" });
  const agent = agentPrintersOf([kitchen, bar, other], "dev-a", NATIVE_TCP, null, POOL);
  assert.deepEqual(agent.localIds, ["bar", "kitchen"], "the printers it writes that the app has (in the setup's order)");
  assert.deepEqual(agent.targets, { kitchen: { nativeId: "tcp:10.0.2.2:9100", paper: "80mm" }, bar: { nativeId: "tcp:10.0.2.2:9101", paper: "58mm" } }, "each at its own paper");
  assert.deepEqual(agentPrintersOf([kitchen, bar], "dev-a", NATIVE_TCP, null).targets, {}, "on v1: no target, the device's one printer as before");
  const win = printer("win", { kind: "device", deviceId: "dev-a", transport: "windows", address: "Kitchen TVS" });
  assert.deepEqual(agentPrintersOf([win], "dev-a", null, WIN_NAMED, null).targets, { win: { printerName: "Kitchen TVS", paper: "80mm" } }, "the Windows app as in 2E");
});

test("2F1: a printer of the app is ready by its own state; any other only while this device's own printer can print", () => {
  const targets = { kitchen: { nativeId: "tcp:10.0.2.2:9100", paper: "80mm" as const }, bar: { nativeId: "tcp:10.0.2.2:9101", paper: "58mm" as const } };
  const statusOf = (id: string) => POOL.printers.find((p) => p.id === id)?.status ?? "none";
  assert.deepEqual(readyPrinterIdsOf(["kitchen", "bar"], targets, false, statusOf), ["kitchen"], "the bar printer is down: only the kitchen's line, whatever the device printer says");
  assert.deepEqual(readyPrinterIdsOf(["p1"], {}, true, statusOf), ["p1"], "the one printer of every other lane: as before");
  assert.deepEqual(readyPrinterIdsOf(["p1"], {}, false, statusOf), [], "and not while it cannot print");
  assert.deepEqual(readyPrinterIdsOf(["win"], { win: { printerName: "Kitchen TVS", paper: "80mm" } }, true, statusOf), ["win"], "a Windows printer as in 2E");
});

test("2F1: the dot shows the worst state among the app's printers this device prints; a network printer it writes but the app lacks is added", () => {
  const kitchen = printer("kitchen", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const bar = printer("bar", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-a" });
  assert.deepEqual(dotPrintersOf([kitchen, bar], "dev-a", NATIVE_TCP, null, POOL), { printersMode: true, isWriter: true, allLocal: true, worst: "disconnected" }, "the bar printer is down");
  assert.deepEqual(dotPrintersOf([kitchen], "dev-a", NATIVE_TCP, null, POOL), { printersMode: true, isWriter: true, allLocal: true, worst: "connected" });
  const appKitchen: DevicePrinter = { ...NATIVE_TCP, printerId: "tcp:10.0.2.2:9100" };
  assert.deepEqual(dotPrintersOf([kitchen], "dev-a", appKitchen, null), { printersMode: true, isWriter: true, allLocal: true }, "on v1: the device printer's own state, as before");
  const third = printer("third", { kind: "lan", host: "10.0.2.3", port: 9100 }, { primaryDeviceId: "dev-a" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.4", port: 9100 }, { primaryDeviceId: "dev-b" });
  const off = printer("off", { kind: "lan", host: "10.0.2.5", port: 9100 }, { primaryDeviceId: "dev-a", enabled: false });
  // Session 3B (deliberate change): also one another device writes, which this device may take over (added ahead of time).
  assert.deepEqual(lanPrintersToAdd([kitchen, third, theirs, off], "dev-a", POOL), [{ host: "10.0.2.3", port: 9100 }, { host: "10.0.2.4", port: 9100 }], "every routable network printer the app lacks: its own, then those it may take over; never one switched off");
  assert.deepEqual(lanPrintersToAdd([third], "dev-a", null), [], "never on an app that speaks only v1");
});

// The 2F2 review gate (M-4, m-3): a printer the setup prints through this device never leaves the POS app from the page,
// and a network printer the page added by itself goes again once the setup stops naming it.
test("2F2 gate (M-4): this device's own printer is in the setup when the setup prints it through this device", () => {
  const kitchen = printer("kitchen", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", null, POOL, "tcp:10.0.2.2:9100"), true, "v2: the app's default is a setup printer this device writes");
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", null, POOL, "tcp:10.0.2.2:9101"), false, "v2: the default is another of the app's printers");
  assert.equal(ownPrinterInSetup([kitchen], "dev-b", null, POOL, "tcp:10.0.2.2:9100"), false, "another device writes it (and this one writes nothing)");
  // Session 3B (deliberate change): on bridge v2, for a device that writes a printer too, another device's network printer
  // is one it may take over, so the page keeps it in the app (removing it would only see it added back).
  const barB = printer("bar-b", { kind: "device", deviceId: "dev-b", transport: "bt-classic", address: "00:11:22:33:44:55" });
  assert.equal(ownPrinterInSetup([kitchen, barB], "dev-b", null, POOL, "tcp:10.0.2.2:9100"), true, "a writer that may take it over keeps it");
  assert.equal(ownPrinterInSetup([kitchen, barB], "dev-b", null, null, null), false, "on v1 another device's printer is never this device's");
  assert.equal(ownPrinterInSetup([{ ...kitchen, enabled: false }], "dev-a", null, POOL, "tcp:10.0.2.2:9100"), false, "a printer switched off prints nothing here");
  assert.equal(ownPrinterInSetup([], "dev-a", null, POOL, "tcp:10.0.2.2:9100"), false, "simple mode: nothing in the setup");
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", null, POOL, null), false, "v2: an app with no default");
  const appKitchen: DevicePrinter = { ...NATIVE_TCP, printerId: "tcp:10.0.2.2:9100" };
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", appKitchen, null, null), true, "v1: its one printer is the setup printer");
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", NATIVE_TCP, null, null), false, "v1: its printer is another one");
  const serial = printer("serial", { kind: "device", deviceId: "dev-a", transport: "web-serial", address: "usb" });
  assert.equal(ownPrinterInSetup([serial], "dev-a", WEB_SERIAL, null, null), true, "a browser's printer the setup prints");
});

test("2F2 gate (m-3): a network printer the page added goes again once no printer of the setup this device writes names it; never one staff added, never the default", () => {
  const kitchen = printer("kitchen", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const added = ["tcp:10.0.2.2:9100", "tcp:10.0.2.2:9101"];
  // The final Phase 2 gate (m-4, deliberate change): asked to go, and kept in the record until the app no longer lists it.
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", POOL, "bt-classic:00:11:22:33:44:55", added), { remove: ["tcp:10.0.2.2:9101"], record: added }, "9101 no longer named: removed, still recorded while the app lists it");
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", POOL, "tcp:10.0.2.2:9101", added), { remove: [], record: added }, "the app's default is never removed");
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", POOL, null, ["tcp:10.0.2.2:9100"]), { remove: [], record: ["tcp:10.0.2.2:9100"] }, "9101 was added by staff (not recorded): kept");
  assert.deepEqual(lanPrintersToRemove([{ ...kitchen, primaryDeviceId: "dev-b" }], "dev-a", POOL, null, ["TCP:10.0.2.2:9100"]).remove, ["tcp:10.0.2.2:9100"], "moved to another device, and this one writes nothing else: removed (ids compared ignoring case)");
  // Session 3B (deliberate change): a device that still writes a printer may take the moved one over, so it stays.
  const own = printer("own", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "00:11:22:33:44:55" });
  assert.deepEqual(lanPrintersToRemove([{ ...kitchen, primaryDeviceId: "dev-b" }, own], "dev-a", POOL, null, ["TCP:10.0.2.2:9100"]).remove, [], "moved to another device while this one writes another: kept, to take it over");
  assert.deepEqual(lanPrintersToRemove([{ ...kitchen, enabled: false }, own], "dev-a", POOL, null, ["TCP:10.0.2.2:9100"]).remove, ["tcp:10.0.2.2:9100"], "switched off: removed");
  assert.deepEqual(lanPrintersToRemove([], "dev-a", POOL, null, ["tcp:10.0.2.3:9100"]), { remove: [], record: [] }, "one the app no longer lists and the setup no longer names is forgotten");
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", null, null, added), { remove: [], record: added }, "never on an app that speaks only v1");
});

// The final Phase 2 gate (Session 2G's review, m-4): a removal the app never confirmed (it failed or timed out) is asked
// again on the next change, so the record forgets a page-added printer only once the app no longer lists it.
test("final Phase 2 gate (m-4): a network printer the page asked the app to remove is forgotten only once the app no longer lists it", () => {
  const added = ["tcp:10.0.2.2:9101"];
  assert.deepEqual(lanPrintersToRemove([], "dev-a", POOL, null, added), { remove: ["tcp:10.0.2.2:9101"], record: added }, "still listed: asked to go and kept in the record");
  const gone = { ...POOL, printers: POOL.printers.filter((entry) => entry.id !== "tcp:10.0.2.2:9101") };
  assert.deepEqual(lanPrintersToRemove([], "dev-a", gone, null, added), { remove: [], record: [] }, "no longer listed: forgotten");
  assert.deepEqual(lanPrintersToRemove([], "dev-a", POOL, null, ["TCP:10.0.2.2:9101"]).record, ["TCP:10.0.2.2:9101"], "listed ids compared ignoring case");
});

// The final Phase 2 gate (Session 2G's review, m-1 and m-2): the setup is known once the printers read has answered at
// least once (data in hand; a failed refetch keeps it), never on a failure with nothing read: until then Other printers
// offers no Remove either, and Change printer keeps this device's printer in the app.
test("PIN (the final Phase 2 gate, m-1, m-2): Remove and Change printer wait for a printers read that has answered, in both sections", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.ok(hook.includes("answered: query.data !== undefined"), "the read says whether it ever answered");
  assert.ok(hook.includes('known: deviceId === "" || answered'), "known only once answered (a failed first read is not known: m-2)");
  const others = src("apps/cafe/components/print/OtherDevicePrinters.tsx");
  assert.ok(others.includes('const { printers, answered } = usePrintersRead(deviceId !== "");'), "Other printers reads the same entry, with its state");
  assert.ok(others.includes('const known = deviceId === "" || answered;'), "known as the device section knows it");
  // Session 3B (deliberate change): a printer this device may take over says so instead of offering Remove.
  assert.match(others, /\{inSetup\.has\(entry\.id\) \? \(\s*<p className="text-xs text-brand-muted">\{IN_SETUP\}<\/p>\s*\) : takeover\.has\(entry\.id\) \? \(\s*<p className="text-xs text-brand-muted">\{TAKEOVER\}<\/p>\s*\) : known \? \(\s*<Button className=\{PRINTER_ACTION_CLASS\} variant="outline" disabled=\{disabled\} onClick=\{\(\) => setRemoving\(entry\.id\)\}>/, "no Remove under Other printers before the setup is known (m-1)");
});

test("PIN (the 2F2 review gate, M-4, m-3): a setup printer never leaves the app from the page; an ask is forgotten once the app lists the printer; the page removes only what it added", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.ok(hook.includes("for (const key of [...lanAsked]) if (pool.printers.some((entry) => entry.id.toLowerCase() === `tcp:${key}`)) lanAsked.delete(key);"), "an ask is forgotten once the app lists the printer");
  // Session 3B (deliberate change): never a printer a job is being written to now (the final Phase 2 gate, (a) item 4).
  assert.ok(hook.includes("const { remove, record } = loaded ? lanPrintersToRemove(printers, deviceId, pool, pool.defaultId, added, busy) : { remove: [], record: added };"), "removals only against a printers read that has loaded");
  assert.ok(hook.includes('const LAN_ADDED_KEY = "pos.app-lan-added.v1";'), "the record is kept on the device");
  assert.ok(hook.indexOf("added.push(`tcp:${key}`)") > 0 && hook.indexOf("added.push(`tcp:${key}`)") < hook.indexOf("void nativePool().add({ tcp: lan })"), "recorded before it is asked for");
  const section = src("apps/cafe/components/print/DevicePrinterSection.tsx");
  assert.match(section, /\{inSetup \? \(\s*<p className="text-xs text-brand-muted">\{PRINTER_IN_SETUP_MESSAGE\}<\/p>\s*\) : known \? \(\s*<Button className=\{PRINTER_ACTION_CLASS\} variant="outline" onClick=\{\(\) => setConfirmRemove\(true\)\} disabled=\{locked\}>/, "no Remove on a setup printer (the 2E gate's I-3 sentence), and none before the setup is known");
  assert.ok(section.includes("if (!listed(target)) await nativePool().add(target);\n    return devicePrinter().selectNative(target, paperDefault);"), "Change printer keeps a setup printer in the app; a listed printer is only chosen");
  assert.ok(section.includes("const keepInApp = pool.active && (inSetup || !known) ?"), "kept also while the setup is not known yet");
  // The final Phase 2 gate (m-2, deliberate change): a failed read with nothing read is no longer "known".
  assert.ok(src("apps/cafe/hooks/use-agent-printers.ts").includes("known: deviceId === \"\" || answered"), "known once the printers read has answered");
  assert.ok(src("apps/cafe/hooks/use-agent-printers.ts").includes('if (!enabled || pool === null || deviceId === "") return;'), "no add or removal without a device id");
  assert.ok(section.includes("<NativePrinterPicker paper={paperDefault} busy={locked} onAttempt={settle} add={keepInApp} />"), "the picker applies it");
  assert.ok(src("apps/cafe/components/print/OtherDevicePrinters.tsx").includes("const IN_SETUP = PRINTER_IN_SETUP_MESSAGE;"), "one sentence for both sections");
});

test("PIN (2F1): the page follows the app's printers: the agent's lines, the dot, the drain, the wake's heartbeat, the network printers it writes", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  // Phase 3 Session 3E deliberately changed: the hook keeps the agent's printers to watch the Windows app's network ones.
  assert.match(hook, /const agent = useMemo\(\(\) => agentPrintersOf\(printers, deviceId, local, desktop, pool\), \[printers, deviceId, local, desktop, pool\]\);/);
  // Session 3B (deliberate change): with the printers the wake says it took over.
  // Phase 3 Session 3E deliberately changed: the dot reads the Windows app's network printers too (`lan`).
  assert.match(hook, /return useMemo\(\(\) => dotPrintersOf\(printers, deviceId, local, desktop, pool, takenOver, lan\), \[printers, deviceId, local, desktop, pool, takenOver, lan\]\);/);
  assert.match(hook, /for \(const lan of lanPrintersToAdd\(printers, deviceId, pool\)\) \{/, "a network printer it writes is added to the app");
  // The 2F2 review gate (M-4, deliberate change): asked again once the app has listed it and lost it, not once per page.
  assert.match(hook, /void nativePool\(\)\.add\(\{ tcp: lan \}\)\.catch\(\(\) => undefined\);/, "a local call");
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  // The 2F1 review gate (N-1, deliberate change): a change of which of the app's printers can print now is a nudge.
  assert.ok(agent.includes("const poolReady = connectedPoolKey(useNativePool());"), "which of the app's printers are connected");
  // Phase 3 Session 3E deliberately changed: and of the Windows app's network printers (lanReady).
  assert.ok(agent.includes("useEffect(() => {\n    agent?.nudge();\n  }, [agent, canPrint, poolReady, lanReady]);"), "a change of the app's printers that can print now is a nudge");
  assert.ok(src("apps/cafe/components/layout/PrintHostProvider.tsx").includes("nativePool().init();"), "read once per page, beside the device printer");
  assert.ok(src("apps/cafe/hooks/use-print-agent-wake.ts").includes("...(caps.native ? { nativeProtocol: nativeV2Bridge() !== null ? NATIVE_BRIDGE_V2 : 1 } : {}),"), "the wake says which app prints several printers");
  // Session 3B (deliberate change): then a printer problem the app says, when every printer answers. Session 3E
  // (deliberate change): on the Windows app a network printer that does not answer reads as on the POS app.
  assert.ok(src("apps/cafe/lib/printer/printer-dot.ts").includes(': noHostRow(lane, printers.worst ?? local, desktopChosen);'), "the dot's worst printer");
  assert.ok(src("apps/cafe/lib/printer/printer-dot.ts").includes('const row = lane === "desktop" && printers.worst !== undefined ? (localRaster(printers.worst) ?? dot("ok"))'), "the Windows app's network printers");
});

test("PIN (2C final review, I-2): the pulse and the wake kick the agent only on jobs it can lease", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  // Session 2E: on the printers it prints here that no refusal holds (agent.openPrinters()).
  assert.match(agent, /if \(jobsForMeLeasable\(data\?\.printJobsForMe, agent\.openPrinters\(\)\)\) agent\.kick\(\);/, "the pulse");
  // The 2E review gate (M-5): the wake poll lives in its own hook.
  assert.match(src("apps/cafe/hooks/use-print-agent-wake.ts"), /leasable: \(jobs\) => jobsForMeLeasable\(jobs, agent\.openPrinters\(\)\),/, "the wake");
  assert.ok(agent.includes("noteJobsForMe(data?.printJobsForMe);"), "a stale list is still read again from the pulse");
});

test("PIN (2C): the page reads the printers on mount, on a print-setup frame and on focus at most every 30 min; every agent and the drain use it", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.match(hook, /queryFn: \(\) => apiGet<PrinterConfig\[\]>\("\/api\/printers"\),/);
  assert.match(hook, /staleTime: PRINTERS_STALE_MS,/);
  assert.match(hook, /refetchOnWindowFocus: true,/);
  assert.match(hook, /if \(kind === "print-setup"\) void qc\.invalidateQueries\(\{ queryKey: PRINTERS_KEYS\.all \}\);/);
  const drain = src("apps/cafe/components/print/PrintHostDrain.tsx");
  assert.match(drain, /const printers = useAgentPrinters\(deviceId, surfacesMounted && deviceId !== ""\);/);
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  // Session 2E: the agent names the printers no refusal holds (lib/print-agent-holds.ts) to the lease and the headers.
  assert.match(agent, /lease: \(printerIds\) => apiSend<PrintLeaseData>\(LEASE_URL, "POST", \{ deviceId, tabId, tokenSlips: true, \.\.\.printerIdsBody\(printerIds\) \}\),/, "it leases its ready printers' lines too");
  // Session 2F1 (deliberate change): the ones of them that can print now.
  assert.match(agent, /readyPrinters: readyNow,/);
  assert.match(agent, /const offReady = setReadyPrintersSource\(\(\) => agent\.openPrinters\(\)\);/);
  // The 2C gate's review (I-2) and its emulator run: a list that looks stale is read again.
  assert.match(agent, /if \(!printerListLooksStale\(\{ ready: readyRef\.current, isWriter: writerRef\.current, jobsForMe: jobs, writesPrinters \}\)\) return;/);
  assert.match(agent, /void qc\.invalidateQueries\(\{ queryKey: PRINTERS_KEYS\.all \}\);/);
  assert.ok(agent.includes("noteJobsForMe(data?.printJobsForMe);") && src("apps/cafe/hooks/use-print-agent-wake.ts").includes("noteJobsForMe(data.jobsForMe, data.writesPrinters);"), "from the pulse and the wake");
});

// The 2A gate's Important 1, the client half: the wake poll ran only on the host and spent against the constant
// 14,400 alone; in printers mode each writer polls, and every one spends against its share from the wake.
test("PIN (2C, the 2A gate's Important 1): the agent polls the wake by printAgentPollsWake and spends against its share", () => {
  // The 2E review gate (M-5): the wake poll moved, unchanged, into its own hook, which the agent's hook calls.
  assert.ok(src("apps/cafe/hooks/use-print-agent.ts").includes("usePrintAgentWake({ agent, enabled, isHost, printers, deviceId, noteJobsForMe });"), "the agent's hook runs it");
  const agent = src("apps/cafe/hooks/use-print-agent-wake.ts");
  assert.match(agent, /const pollsWake = printAgentPollsWake\(\{ hostConfigured: isHost, isHost, printersMode: printers\.printersMode, isWriter: printers\.isWriter \}\);/);
  assert.match(agent, /if \(agent === null \|\| !enabled \|\| !pollsWake\) return;/);
  assert.ok(!agent.includes("if (agent === null || !enabled || !isHost) return;"), "no longer the host alone");
  assert.match(agent, /capRef\.current = Math\.min\(PRINT_WAKE_DAILY_CAP, data\.agentDailyCap\);/, "the wake's answer lowers the cap");
  assert.match(agent, /bumpPrintWakeBudget\(mergePrintWakeBudget\(readPrintWakeBudget\(\), memory, dayKey\), dayKey, capRef\.current\)/, "the constant is no longer the only cap");
});

function printsWith(results: PrintAgentResult[]) {
  const calls: number[] = [];
  const once = async (): Promise<PrintAgentResult> => {
    calls.push(calls.length + 1);
    return results.shift() ?? { ok: true };
  };
  return { calls, once };
}

// Session 2C (spec §6.3 copies, plan decision 2): all copies of a slip are one job, written in its one lease.
test("printJobCopies: only this device's printer; every copy in one lease; a failure after the first copy may be on paper", async () => {
  const away = printsWith([]);
  const refused = await printJobCopies({ printerId: "p-bar" }, ["p-counter"], away.once);
  assert.deepEqual([away.calls.length, refused.ok ? null : printWriteOutcomeOf(refused.error)], [0, { sent: "no", permanent: false, message: PRINTER_NOT_LOCAL_MESSAGE }], "not this device's printer: refused, nothing sent, never counted");
  const simple = printsWith([]);
  assert.deepEqual([await printJobCopies({}, [], simple.once), simple.calls.length], [{ ok: true }, 1], "the device's own simple-mode line: one copy, as today");
  const two = printsWith([]);
  assert.deepEqual([await printJobCopies({ printerId: "p-counter", copies: 2 }, ["p-counter"], two.once), two.calls.length], [{ ok: true }, 2], "both copies, back to back");
  const firstFails = printsWith([{ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) }]);
  const first = await printJobCopies({ printerId: "p-counter", copies: 2 }, ["p-counter"], firstFails.once);
  assert.deepEqual([firstFails.calls.length, first.ok ? null : printWriteOutcomeOf(first.error).sent], [1, "no"], "the first copy's refusal stands: nothing reached paper");
  const secondFails = printsWith([{ ok: true }, { ok: false, error: new PrintWriteError(PRINTER_WRITE_FAILED_MESSAGE, "no") }]);
  const second = await printJobCopies({ printerId: "p-counter", copies: 2 }, ["p-counter"], secondFails.once);
  assert.deepEqual(second.ok ? null : printWriteOutcomeOf(second.error), { sent: "maybe", permanent: false, message: PRINTER_WRITE_FAILED_MESSAGE }, "a copy is on paper already: maybe (its REPRINT repeats every copy)");
});

test("PIN (2C): the agent prints a leased job through printJobCopies on this device's printers; the station line reaches the paper", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  // Session 2E: the same call, inside a body that looks a failed Windows printer up again.
  // Session 3B (deliberate change): the app printer it writes to is marked meanwhile, so the page never removes it mid-print.
  assert.match(agent, /const print = async \(job: LeasedPrintJob\): Promise<PrintAgentResult> => \{[\s\S]*?const result = await printJobCopies\(job, readyRef\.current, \(\) => printOnce\(job\)\);/);
  const kot = src("apps/cafe/components/pos/KOTReceipt.tsx");
  const title = kot.indexOf("KITCHEN ORDER");
  const line = kot.indexOf("{stationLine && (");
  const number = kot.indexOf("#{roundNumber}");
  assert.ok(title > 0 && line > title && number > line, "under the title, above the number a cook calls out");
  assert.ok(src("apps/cafe/components/pos/PrintSources.tsx").includes("stationLine={kotStationLine}"), "PrintSources forwards it");
  assert.ok(src("apps/cafe/components/print/PrintHostPrintSources.tsx").includes("kotStationLine={slip.stationLine}"), "the agent's slip carries it");
});

// Phase 3 Session 3B (spec §9.3; the planning review's M-8 a, d; the 3A review gate): a POS app on bridge v2 says
// lanFailover, so the server may give it any network printer of the setup while that printer's primary is offline or
// cannot reach it. The page adds every such printer to the app ahead of time, prints it once the app has it, names it in
// a lease only while the app reaches it (the signal that ends a skip: Session 3A's I-1), and its dot counts one only while
// the wake says it writes it.
test("3B: on bridge v2 every routable network printer another device writes is one this device may take over; on v1 none", () => {
  const mine = printer("mine", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-b" });
  const away = printer("away", { kind: "lan", host: "10.0.2.9", port: 9100 }, { primaryDeviceId: "dev-b" });
  const bt = printer("bt", { kind: "device", deviceId: "dev-b", transport: "bt-classic", address: "AA:BB" });
  const off = printer("off", { kind: "lan", host: "10.0.2.8", port: 9100 }, { primaryDeviceId: "dev-b", enabled: false });
  const all = [mine, theirs, away, bt, off];
  assert.deepEqual(takeoverPrintersOf(all, "dev-a", POOL).map((p) => p.id).sort(), ["away", "theirs"], "network printers only, routable, another device's");
  assert.deepEqual(takeoverPrintersOf(all, "dev-a", null), [], "the release APK (v1) never takes one over");
  assert.deepEqual(takeoverPrintersOf(all, "", POOL), [], "no device identity");
  const agent = agentPrintersOf(all, "dev-a", NATIVE_TCP, null, POOL);
  assert.deepEqual(agent.localIds, ["mine", "theirs"], "its own printer, then the one it may take over that the app has (not the one the app lacks yet)");
  assert.deepEqual(agent.takeoverIds, ["theirs"]);
  assert.deepEqual(agent.lanIds, ["mine", "theirs"], "both network printers: a refusal before any byte is unreachable");
  assert.deepEqual(agent.targets.theirs, { nativeId: "tcp:10.0.2.2:9101", paper: "80mm" }, "printed through the app by its id");
  assert.equal(agent.isWriter, true, "a writer by the setup alone");
  // The gate's emulator pre-run (E-1): a device that writes no printer takes none over (it never polls the wake, so it is
  // never online for one: P3-2), and so never adds them to its app, where the first would become its own printer.
  assert.deepEqual(takeoverPrintersOf([theirs], "dev-a", POOL), [], "a device that writes nothing takes nothing over");
  assert.deepEqual(agentPrintersOf([theirs], "dev-a", NATIVE_TCP, null, POOL).takeoverIds, [], "and lists none");
  const empty = { printers: [] };
  // Session 3C (the 3B gate review's m-A, deliberately changed): an app with no printer gets only its own; the one it may
  // take over follows once the app lists its own (one status event later), so a refused select of its own can never let
  // another device's printer become its default.
  assert.deepEqual(lanPrintersToAdd([mine, theirs], "dev-a", empty).map((p) => p.port), [9100], "an app with no printer gets its own first (its default), and nothing else yet");
  assert.deepEqual(lanPrintersToAdd([mine, theirs], "dev-a", { printers: [{ id: "tcp:10.0.2.2:9100", status: "connecting" as const }] }).map((p) => p.port), [9101], "then the one it may take over");
  // Session 3C (the 3B review's m-1): one it may take over that its app does not list is named, so its beat says it
  // cannot print it (lib/print-agent-health.ts); an app with no printer lists none of them.
  assert.deepEqual(agentPrintersOf([mine, theirs], "dev-a", NATIVE_TCP, null, empty).takeoverMissingIds, ["theirs"], "the empty app cannot print the printer it may take over");
  assert.deepEqual(agentPrintersOf([mine, theirs], "dev-a", NATIVE_TCP, null, POOL).takeoverMissingIds, [], "an app that lists it prints it");
  assert.deepEqual(lanPrintersToAdd([bt, { ...theirs, primaryDeviceId: "dev-b" }, printer("btA", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "FF:EE" })], "dev-a", empty), [], "an app with no printer and none of its own to add: never seeded with another device's printer");
});

test("3E: on the Windows app 1.12.0 every network printer it writes is this PC's, printed over raw TCP by its address; on 1.11.0 none, as before", () => {
  const kitchen = printer("kitchen", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "pc", paper: 58 });
  const bar = printer("bar", { kind: "device", deviceId: "pc", transport: "windows", address: "Kitchen TVS" });
  assert.equal(printerIsLocal(kitchen, null, WIN_LAN), true, "1.12.0 writes it itself");
  assert.equal(printerIsLocal(kitchen, null, WIN_NAMED), false, "1.11.0 cannot");
  const agent = agentPrintersOf([kitchen, bar], "pc", null, WIN_LAN);
  assert.deepEqual(agent.localIds, ["bar", "kitchen"], "the Windows printer and the network printer");
  assert.deepEqual(agent.lanIds, ["kitchen"], "a refusal before any byte is unreachable for the network one");
  assert.deepEqual(agent.targets.kitchen, { lan: { host: "192.168.1.60", port: 9100 }, paper: "58mm" }, "by its address, drawn for its own paper");
  assert.deepEqual(agent.targets.bar, { printerName: "Kitchen TVS", paper: "80mm" }, "the Windows printer as before");
  const old = agentPrintersOf([kitchen, bar], "pc", null, WIN_NAMED);
  assert.deepEqual([old.localIds, old.lanIds, old.targets.kitchen], [["bar"], [], undefined], "1.11.0 prints only the Windows printer, as in Phase 2");
});

test("3E: the Windows app 1.12.0 may take over every network printer another device writes, once it writes a printer itself; each is named in a lease only while the app reaches it", () => {
  const own = printer("own", { kind: "device", deviceId: "pc", transport: "windows", address: "EPSON TM-T82" });
  const theirs = printer("theirs", { kind: "lan", host: "192.168.1.61", port: 9100 }, { primaryDeviceId: "tab" });
  const away = printer("away", { kind: "lan", host: "192.168.1.62", port: 9100 }, { primaryDeviceId: "tab" });
  assert.deepEqual(takeoverPrintersOf([own, theirs, away], "pc", null, true).map((p) => p.id), ["away", "theirs"], "1.12.0, a writer by the setup");
  assert.deepEqual(takeoverPrintersOf([own, theirs, away], "pc", null), [], "1.11.0 takes none over");
  assert.deepEqual(takeoverPrintersOf([theirs, away], "pc", null, true), [], "a PC that writes nothing takes nothing over (E-1, P3-2)");
  const agent = agentPrintersOf([own, theirs, away], "pc", null, WIN_LAN);
  assert.deepEqual([agent.takeoverIds, agent.takeoverMissingIds], [["away", "theirs"], []], "every one: the app can try any address");
  assert.deepEqual(agent.targets.theirs, { lan: { host: "192.168.1.61", port: 9100 }, paper: "80mm" });
  const status: Record<string, "connected" | "disconnected" | "connecting"> = { "tcp:192.168.1.61:9100": "connected", "tcp:192.168.1.62:9100": "connecting" };
  const ready = readyPrinterIdsOf(agent.localIds, agent.targets, true, (id) => status[id] ?? "none", (id) => id === "tcp:192.168.1.61:9100" && false);
  assert.deepEqual(ready, ["own", "theirs"], "the one the app reaches now; not one still being checked");
  assert.deepEqual(readyPrinterIdsOf(agent.localIds, agent.targets, true, (id) => status[id] ?? "none", (id) => id === "tcp:192.168.1.61:9100"), ["own"], "nor one that says it cannot print");
});

test("3E: the Windows app 1.12.0 names the Windows printers it writes that Windows no longer reports; the dot reads its network printers' links and words", () => {
  const own = printer("own", { kind: "device", deviceId: "pc", transport: "windows", address: "EPSON TM-T82" });
  const gone = printer("gone", { kind: "device", deviceId: "pc", transport: "windows", address: "Old TVS" });
  const kitchen = printer("kitchen", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "pc", name: "Kitchen" });
  assert.deepEqual(agentPrintersOf([own, gone, kitchen], "pc", null, WIN_LAN).windowsMissingIds, ["gone"], "Windows does not report it now");
  assert.deepEqual(agentPrintersOf([own, gone, kitchen], "pc", null, WIN_NAMED).windowsMissingIds, [], "1.11.0: nothing, as before");
  assert.deepEqual(agentPrintersOf([own, gone], "pc", null, { ...WIN_LAN, names: null }).windowsMissingIds, [], "not read yet: nothing");
  const down = [{ id: "tcp:192.168.1.60:9100", host: "192.168.1.60", port: 9100, status: "disconnected" as const }];
  assert.equal(dotPrintersOf([own, kitchen], "pc", null, WIN_LAN, null, [], down).worst, "disconnected", "the kitchen does not answer");
  const empty = [{ id: "tcp:192.168.1.60:9100", host: "192.168.1.60", port: 9100, status: "connected" as const, paper: "out" as const }];
  assert.deepEqual(dotPrintersOf([own, kitchen], "pc", null, WIN_LAN, null, [], empty).problem, { name: "Kitchen", problem: "paper-out" }, "out of paper, by its name");
  assert.equal(dotPrintersOf([own, kitchen], "pc", null, WIN_LAN).worst, undefined, "no check yet: nothing known");
});

test("PIN (3E): the Windows app's network printers are checked while this device prints, their links nudge the agent and release a hold, and the registry reads them", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.ok(hook.includes("desktopLan().watch(JSON.parse(lanTargets) as DesktopLanTarget[]);"), "the printers it prints, its own and the ones it may take over");
  assert.ok(hook.includes("const timer = window.setInterval(() => {\n      void desktopLan().check();\n      void refreshDesktopPrinterChosen();\n    }, DESKTOP_LAN_CHECK_MS);"), "and every minute while it prints, with the Windows printers' presence");
  assert.ok(hook.includes("return useMemo(() => dotPrintersOf(printers, deviceId, local, desktop, pool, takenOver, lan), [printers, deviceId, local, desktop, pool, takenOver, lan]);"), "the dot reads them");
  assert.ok(hook.includes("named: desktopPrintsOnNamed(), lan: desktopLanApi() !== null"), "1.12.0 says it writes network printers");
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.ok(agent.includes("const lanReady = connectedLanKey(useDesktopLan());") && agent.includes("}, [agent, canPrint, poolReady, lanReady]);"), "a network printer that answers again nudges the agent");
  assert.ok(agent.includes("printerState: () => (isDesktopShell() ? desktopPrintersState(desktopPrinterSnapshot()) : printersState()),"), "and releases a refusal's hold");
  assert.ok(agent.includes("const missingKey = [...printers.takeoverMissingIds, ...printers.windowsMissingIds].join(\",\");"), "a Windows printer gone from Windows reads down in the beat");
  assert.ok(agent.includes("presence: isDesktopShell() && desktopLanApi() !== null,") && agent.includes("(listener) => desktopLan().subscribe(listener)]"), "the beat's clock follows the network printers' checks");
  const registry = src("apps/cafe/lib/printer/printer-registry.ts");
  assert.ok(registry.includes('return nativePool().printerOf(nativeId)?.status ?? desktopLan().printerOf(nativeId)?.status ?? "none";'), "its state by the same id");
  assert.equal(DESKTOP_LAN_CHECK_MS, 60_000, "the POS app's cadence");
});

test("PIN (3B, Session 3A's I-1): a page names in its lease only a printer it can print to now; the one it may take over too", () => {
  const statusOf = (id: string) => POOL.printers.find((p) => p.id === id)?.status ?? "none";
  const targets = { theirs: { nativeId: "tcp:10.0.2.2:9100", paper: "80mm" as const }, down: { nativeId: "tcp:10.0.2.2:9101", paper: "80mm" as const } };
  assert.deepEqual(readyPrinterIdsOf(["theirs", "down"], targets, true, statusOf), ["theirs"], "the app reaches one and not the other: only that one is ever named");
  const agent = src("apps/cafe/lib/print-agent.ts");
  assert.ok(agent.includes("const data = await deps.lease(holds.open(ready()));"), "the lease names only the ready printers no refusal holds");
  const hook = src("apps/cafe/hooks/use-print-agent.ts");
  // Session 3C (spec §10) deliberately changed: and not while the app says it cannot print (out of paper, cover open).
  assert.ok(hook.includes("const readyNow = (): string[] => readyPrinterIdsOf(readyRef.current, targetsRef.current, canPrintNow(), printerStatusOf, printerCannotPrintOf);"), "ready: the app's own state per printer");
  assert.ok(hook.includes("readyPrinters: readyNow,"), "the agent's ready list is that");
  const lib = src("apps/cafe/lib/print-agent-printers.ts");
  // Phase 3 Session 3E deliberately changed: a network printer of the Windows app by its own link, by the same rule.
  assert.ok(lib.includes('return key === undefined ? canPrint : statusOf(key) === "connected" && !cannotPrint(key);'), "an app printer is ready only while the app says connected");
  // Session 3C: a printer the app says cannot print is never named in a lease: its slips wait, with no request.
  assert.deepEqual(readyPrinterIdsOf(["theirs"], targets, true, statusOf, (nativeId) => nativeId === "tcp:10.0.2.2:9100"), [], "out of paper: not ready");
});

test("3B: the dot carries the worst paper, cover or error the app says of a printer it counts, by that printer's name", () => {
  const mine = printer("mine", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a", name: "Kitchen" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-b", name: "Bar" });
  const pool = { printers: [{ id: "tcp:10.0.2.2:9100", status: "connected" as const, paper: "low" as const, cover: "open" as const }, { id: "tcp:10.0.2.2:9101", status: "connected" as const, paper: "out" as const }] };
  assert.deepEqual(dotPrintersOf([mine, theirs], "dev-a", NATIVE_TCP, null, pool).problem, { name: "Kitchen", problem: "cover-open" }, "its own printer's cover; the other device's printer does not count");
  assert.deepEqual(dotPrintersOf([mine, theirs], "dev-a", NATIVE_TCP, null, pool, ["theirs"]).problem, { name: "Bar", problem: "paper-out" }, "while it writes the Bar printer, its paper out is worse");
  const low = { printers: [{ id: "tcp:10.0.2.2:9100", status: "connected" as const, paper: "low" as const }] };
  assert.equal(dotPrintersOf([mine], "dev-a", NATIVE_TCP, null, low).problem, undefined, "low paper still prints: no red dot");
  // Session 3C (the 3B golden-copy review's m-7): simple mode prints on the app's default printer: its problem, by its name.
  const own = { printers: [{ id: "bt-classic:00:11:22:33:44:55", status: "connected" as const, paper: "out" as const, printer: { name: "RPP02N" } }, { id: "tcp:10.0.2.2:9100", status: "connected" as const, cover: "open" as const }], defaultId: "bt-classic:00:11:22:33:44:55" };
  assert.deepEqual(dotPrintersOf([], "dev-a", NATIVE_TCP, null, own).problem, { name: "RPP02N", problem: "paper-out" }, "simple mode: the app's own printer");
  assert.equal(dotPrintersOf([], "dev-a", NATIVE_TCP, null, { ...own, defaultId: "tcp:10.0.2.2:9100" }).problem?.problem, "cover-open", "whichever is the default");
  assert.equal(dotPrintersOf([], "dev-a", NATIVE_TCP, null, low).problem, undefined, "no default known: nothing");
});

test("3B: the dot counts a printer it may take over only while the wake says it writes it", () => {
  const mine = printer("mine", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-b" });
  assert.deepEqual(dotPrintersOf([mine, theirs], "dev-a", NATIVE_TCP, null, POOL), { printersMode: true, isWriter: true, allLocal: true, worst: "connected" }, "the other device's printer is down for this app, but it does not write it now: green");
  assert.deepEqual(dotPrintersOf([mine, theirs], "dev-a", NATIVE_TCP, null, POOL, ["theirs"]), { printersMode: true, isWriter: true, allLocal: true, worst: "disconnected" }, "while the wake says it writes it, its state counts");
});

test("3B: a removal waits while a job is being written to that printer (the final Phase 2 gate, (a) item 4)", () => {
  const added = ["tcp:10.0.2.2:9101"];
  assert.deepEqual(lanPrintersToRemove([], "dev-a", POOL, null, added, ["TCP:10.0.2.2:9101"]), { remove: [], record: added }, "being written: kept for now, and still recorded");
  assert.deepEqual(lanPrintersToRemove([], "dev-a", POOL, null, added, []), { remove: ["tcp:10.0.2.2:9101"], record: added }, "done: asked to go");
  assert.match(PRINTER_TAKEOVER_MESSAGE, /offline/, "the words under Other printers for a printer it may take over");
});

test("PIN (3B): the page marks the app printer each job is written to, a removal waits for it, and Other printers says why a takeover printer stays", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.ok(hook.includes('const writing = useSyncExternalStore(onPrintersWritingChange, printersBeingWritten, () => "");'), "the printers being written, followed");
  assert.ok(hook.includes("}, [enabled, loaded, printers, deviceId, pool, writing]);"), "a removal runs again once the print is done");
  assert.ok(hook.includes("const takenOver = useSyncExternalStore(onTakenOverChange, takenOverPrinterIds, () => NO_IDS);"), "the dot follows what the wake says it took over");
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.ok(agent.includes("if (nativeId !== undefined) markPrinterWriting(nativeId, true);") && agent.includes("if (nativeId !== undefined) markPrinterWriting(nativeId, false);"), "marked while it prints, unmarked after");
  const others = src("apps/cafe/components/print/OtherDevicePrinters.tsx");
  assert.ok(others.includes("const TAKEOVER = PRINTER_TAKEOVER_MESSAGE;"), "the takeover words");
});
