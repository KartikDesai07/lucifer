import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import { stripComments } from "@/lib/source-pin-utils";
import { printerIsLocal } from "@/lib/print-agent-printers";
import {
  printerPaperOf,
  windowsPrinterConnectionOf,
  PRINTER_DEVICE_REQUIRED,
  PRINTER_HOST_REQUIRED,
  PRINTER_LOCAL_REQUIRED,
  PRINTER_WINDOWS_REQUIRED,
  PRINTER_NAME_REQUIRED,
  PRINTER_PORT_INVALID,
  SETUP_PRINTER_NAME,
  draftWithLocal,
  localPrinterConnectionOf,
  printerBodyOf,
  printerDraftOf,
  setUpPrintersBody,
} from "@/lib/print-setup-form";
import { connectionText, deviceName, printerRowState, printersLeftEmptyBy, setupGaps, slipsText, testPrintBlock, testPrintSentText } from "@/lib/print-setup-text";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Printing redesign, Phase 2 Session 2D (spec §11): the Printer setup page's pure half: the form, "Set up printers"
// and this device's own printer as a connection the agent recognises, and the words each printer is shown with.

const KITCHEN: StationConfig = { id: "s-kitchen", name: "Kitchen", order: 0, isDefault: true };
const BAR: StationConfig = { id: "s-bar", name: "Bar", order: 1, isDefault: false };
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

function printer(id: string, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id,
    name: id,
    connection: { kind: "device", deviceId: `dev-${id}`, transport: "bt-classic", address: "AA:BB:CC:DD:EE:FF" },
    order: 0,
    paper: 80,
    slips: { ...NO_SLIPS, bill: true },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

const NATIVE: Record<string, DevicePrinter> = {
  bt: { kind: "native", name: "BT", paper: "58mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" },
  ble: { kind: "native", name: "BLE", paper: "58mm", printerId: "ble:11:22:33:44:55:66", transport: "ble" },
  usb: { kind: "native", name: "USB", paper: "80mm", printerId: "usb:04b8:0e15", transport: "usb" },
  tcp: { kind: "native", name: "LAN", paper: "80mm", printerId: "tcp:192.168.1.60:9100", transport: "tcp" },
};
const WEB_BLE: DevicePrinter = { kind: "ble", name: "BLE", paper: "58mm", deviceId: "opaque-ble-id", serviceUuid: "s", characteristicUuid: "c" };
const SERIAL: DevicePrinter = { kind: "serial", name: "USB", paper: "80mm", usbVendorId: 0x4b8, usbProductId: 0xe15 };

test("2D: this device's own printer as a connection: the app's and the browser's spelling kept, a network printer printed here", () => {
  const of = (local: DevicePrinter | null, desktop: { printerName: string | null } | null = null) => localPrinterConnectionOf({ local, deviceId: "dev-a", desktop, defaultPaper: 80 });
  assert.deepEqual(of(NATIVE.bt ?? null), { connection: { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB:CC:DD:EE:FF" }, paper: 58 }, "Bluetooth: the bare MAC, as the app spells it");
  assert.deepEqual(of(NATIVE.ble ?? null)?.connection, { kind: "device", deviceId: "dev-a", transport: "ble", address: "11:22:33:44:55:66" }, "BLE: the app decides the transport");
  assert.deepEqual(of(NATIVE.usb ?? null)?.connection, { kind: "device", deviceId: "dev-a", transport: "usb", address: "04b8:0e15" });
  assert.deepEqual(of(NATIVE.tcp ?? null), { connection: { kind: "lan", host: "192.168.1.60", port: 9100 }, primaryDeviceId: "dev-a", paper: 80 }, "the app's network printer: a LAN printer this device prints");
  assert.deepEqual(of(WEB_BLE)?.connection, { kind: "device", deviceId: "dev-a", transport: "web-bluetooth", address: "opaque-ble-id" });
  assert.deepEqual(of(SERIAL)?.connection, { kind: "device", deviceId: "dev-a", transport: "web-serial", address: "04b8:0e15" });
  assert.deepEqual(of({ kind: "serial", name: "USB", paper: "80mm" })?.connection, { kind: "device", deviceId: "dev-a", transport: "web-serial", address: "serial" });
  assert.deepEqual(of(null, { printerName: "EPSON TM-T82" }), { connection: { kind: "device", deviceId: "dev-a", transport: "windows", address: "EPSON TM-T82" }, paper: 80 }, "the Windows app's chosen printer");
  assert.equal(of(null, { printerName: null }), null, "the Windows app with no printer chosen: nothing to save (the 2D gate's review, M-2)");
  assert.equal(of(null), null, "no printer on this device");
  assert.equal(localPrinterConnectionOf({ local: NATIVE.bt ?? null, deviceId: "", desktop: null, defaultPaper: 80 }), null, "no device identity");
});

test("2D: Set up printers makes Printer 1 from this device's printer with every slip but stations, and the agent prints it here", () => {
  for (const local of [NATIVE.bt, NATIVE.ble, NATIVE.usb, NATIVE.tcp, WEB_BLE, SERIAL]) {
    const found = localPrinterConnectionOf({ local: local ?? null, deviceId: "dev-a", desktop: null, defaultPaper: 80 });
    assert.ok(found !== null, `a connection for ${local?.kind}`);
    const body = setUpPrintersBody(found);
    assert.equal(body.name, SETUP_PRINTER_NAME);
    assert.deepEqual(body.slips, { bill: true, kotStations: [], kotAll: true, notices: true, eod: true }, "nothing changes on paper (decision 5)");
    assert.deepEqual(body.copies, { kot: 1, bill: 1 });
    const config: PrinterConfig = { id: "p1", order: 0, ...body };
    assert.equal(printerIsLocal(config, local ?? null, null), true, `the agent recognises it as this device's printer (${local?.kind})`);
  }
  const windows = localPrinterConnectionOf({ local: null, deviceId: "dev-a", desktop: { printerName: "EPSON" }, defaultPaper: 58 });
  assert.ok(windows !== null && printerIsLocal({ id: "w", order: 0, ...setUpPrintersBody(windows) }, null, { selected: "EPSON", names: ["EPSON"], named: false }), "the Windows app's printer");
});

test("2D: a new printer's form starts with Notices on (the 2B gate's M-7); an edit drops a station that is gone (the 2A gate's M4)", () => {
  const fresh = printerDraftOf(null, [KITCHEN]);
  assert.equal(fresh.notices, true);
  assert.equal(fresh.kind, "lan");
  assert.equal(fresh.port, "9100");
  const saved = printer("bar", { slips: { ...NO_SLIPS, kotStations: ["s-bar", "s-gone"], notices: true } });
  assert.deepEqual(printerDraftOf(saved, [KITCHEN, BAR]).kotStations, ["s-bar"]);
  assert.deepEqual(printerDraftOf(saved, [KITCHEN, BAR]).device, saved.connection, "a device printer keeps its saved connection");
  assert.deepEqual(printerDraftOf(saved, []).kotStations, ["s-bar", "s-gone"], "a list not read yet drops nothing (the 2D gate's review, I-1)");
  const local = localPrinterConnectionOf({ local: NATIVE.tcp ?? null, deviceId: "dev-a", desktop: null, defaultPaper: 80 });
  assert.ok(local !== null);
  const lan = draftWithLocal(fresh, local);
  assert.deepEqual([lan.kind, lan.host, lan.port, lan.primaryDeviceId], ["lan", "192.168.1.60", "9100", "dev-a"], "this device's network printer fills the LAN fields");
});

test("2D: the form's body: what is missing in words; Full KOT copy clears the stations; one enabled printer per printing device", () => {
  const base = { ...printerDraftOf(null, [KITCHEN]), name: "Kitchen printer", host: " 192.168.1.61 ", primaryDeviceId: "kitchen-tab", kotStations: ["s-kitchen"] };
  const ok = printerBodyOf(base, []);
  assert.ok(ok.ok, "a complete LAN printer");
  if (ok.ok) {
    assert.deepEqual(ok.body.connection, { kind: "lan", host: "192.168.1.61", port: 9100 });
    assert.equal(ok.body.primaryDeviceId, "kitchen-tab");
    assert.deepEqual(ok.body.slips.kotStations, ["s-kitchen"]);
  }
  const error = (draft: typeof base) => {
    const result = printerBodyOf(draft, []);
    return result.ok ? null : result.error;
  };
  assert.equal(error({ ...base, name: "  " }), PRINTER_NAME_REQUIRED);
  assert.equal(error({ ...base, host: "" }), PRINTER_HOST_REQUIRED);
  assert.equal(error({ ...base, port: "91x" }), PRINTER_PORT_INVALID);
  assert.equal(error({ ...base, port: "70000" }), PRINTER_PORT_INVALID);
  assert.equal(error({ ...base, primaryDeviceId: "" }), PRINTER_DEVICE_REQUIRED);
  assert.equal(error({ ...base, kind: "device", device: null }), PRINTER_LOCAL_REQUIRED);
  // The 2E review gate (M-4): a form that chooses the printer itself (a Windows app's printers) says so.
  const windows = printerBodyOf({ ...base, kind: "device", device: null }, [], undefined, PRINTER_WINDOWS_REQUIRED);
  assert.deepEqual(windows, { ok: false, error: "Choose the Windows printer." }, "the Windows form's own words");
  const full = printerBodyOf({ ...base, kotAll: true }, []);
  assert.ok(full.ok && full.body.slips.kotStations.length === 0 && full.body.slips.kotAll, "a full copy takes every station already");
  const kitchenTab = printer("Counter", { connection: { kind: "lan", host: "10.0.0.5", port: 9100 }, primaryDeviceId: "kitchen-tab" });
  assert.equal(error({ ...base }) ?? "", "", "no clash with no printers");
  const clash = printerBodyOf(base, [kitchenTab]);
  assert.ok(!clash.ok && clash.error.includes("already prints Counter"), "that device already prints the Counter printer");
  assert.ok(printerBodyOf({ ...base, enabled: false }, [kitchenTab]).ok, "saved switched off: no clash");
  assert.ok(printerBodyOf(base, [kitchenTab], "Counter").ok, "editing that very printer");
  const copies = printerBodyOf({ ...base, copiesKot: 9, copiesBill: 0 }, []);
  assert.ok(copies.ok && copies.body.copies.kot === 3 && copies.body.copies.bill === 1, "copies kept within 1–3");
});

const DEVICES: PrintDeviceSummary[] = [
  { deviceId: "tablet-0001", label: "POS app", shell: "android", online: true, lastSeenAt: "2026-10-04T10:00:00.000Z" },
  { deviceId: "phone-0002", label: "POS app", shell: "android", online: false, lastSeenAt: "2026-10-04T09:00:00.000Z" },
];

test("2D: each printer in words: its connection, its slips and stations, and its state", () => {
  assert.equal(deviceName("tablet-0001", DEVICES, "me"), "POS app …0001", "the id's tail tells two POS app devices apart");
  assert.equal(deviceName("me", DEVICES, "me"), "This device");
  assert.equal(deviceName("gone-9999", DEVICES, "me"), "Device …9999");
  const lan = printer("Kitchen", { connection: { kind: "lan", host: "192.168.1.60", port: 9100 }, primaryDeviceId: "tablet-0001", slips: { ...NO_SLIPS, kotStations: ["s-kitchen", "s-bar"], notices: true } });
  assert.equal(connectionText(lan, DEVICES, "me"), "Network 192.168.1.60:9100 · printed by POS app …0001");
  assert.equal(connectionText(printer("Bar"), DEVICES, "dev-Bar"), "Bluetooth · This device");
  assert.equal(slipsText(lan, [KITCHEN, BAR]), "Kitchen KOTs, Bar KOTs, Notices");
  assert.equal(slipsText(printer("C", { slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true } }), []), "Bill, Full KOT copy, Notices, End of day");
  assert.equal(slipsText(printer("N", { slips: NO_SLIPS }), []), "No slips");
  const here = { deviceId: "me", localIds: ["Mine"], canPrint: true };
  assert.deepEqual(printerRowState(lan, DEVICES, here), { tone: "ok", text: "POS app is online" });
  assert.deepEqual(printerRowState({ ...lan, primaryDeviceId: "phone-0002" }, DEVICES, here), { tone: "bad", text: "POS app is offline" });
  assert.deepEqual(printerRowState({ ...lan, primaryDeviceId: "new-device" }, DEVICES, here), { tone: "bad", text: "Its printing device has not checked in" });
  // The 2E review gate (M-3): with the devices read failed, nothing is claimed about it.
  assert.deepEqual(printerRowState({ ...lan, primaryDeviceId: "new-device" }, [], { ...here, devicesFailed: true }), { tone: "off", text: "Its printing device is unknown (the devices did not load)" });
  assert.deepEqual(printerRowState({ ...lan, primaryDeviceId: undefined }, DEVICES, here), { tone: "bad", text: "No printing device" });
  assert.deepEqual(printerRowState({ ...lan, enabled: false }, DEVICES, here), { tone: "off", text: "Switched off" });
  assert.deepEqual(printerRowState({ ...lan, slips: NO_SLIPS }, DEVICES, here), { tone: "off", text: "Takes no slips" });
  const mine = printer("Mine", { connection: { kind: "device", deviceId: "me", transport: "usb", address: "04b8:0e15" } });
  assert.deepEqual(printerRowState(mine, DEVICES, here), { tone: "ok", text: "Prints on this device" });
  assert.deepEqual(printerRowState(mine, DEVICES, { ...here, canPrint: false }), { tone: "bad", text: "This device's printer is not ready" });
  assert.deepEqual(printerRowState({ ...mine, id: "Other" }, DEVICES, here), { tone: "bad", text: "Not this device's printer" });
});

test("2D: what the setup leaves without a printer (printers mode only), and the printers a station's delete leaves empty (the 2A gate's M5)", () => {
  assert.deepEqual(setupGaps([], [KITCHEN]), [], "simple mode: nothing to say");
  const kitchen = printer("Kitchen", { slips: { ...NO_SLIPS, kotStations: ["s-kitchen"] } });
  assert.deepEqual(setupGaps([kitchen], [KITCHEN, BAR]), [
    "No printer takes bills: bills will not print.",
    "No printer takes Bar KOTs: they will not print.",
    "No printer takes notices: void, moved and cancel slips will not print.",
  ]);
  const counter = printer("Counter", { slips: { bill: true, kotStations: [], kotAll: false, notices: true, eod: true } });
  assert.deepEqual(setupGaps([kitchen, counter], [KITCHEN, BAR]), ["No printer takes Bar KOTs: they print at Counter, marked NO PRINTER SET."]);
  assert.deepEqual(setupGaps([kitchen, { ...counter, slips: { ...counter.slips, kotAll: true } }], [KITCHEN, BAR]), [], "a full copy covers every station");
  const bar = printer("Bar", { slips: { ...NO_SLIPS, kotStations: ["s-bar"] } });
  const both = printer("Both", { slips: { ...NO_SLIPS, kotStations: ["s-bar", "s-kitchen"] } });
  assert.deepEqual(printersLeftEmptyBy([bar, both, counter], "s-bar").map((p) => p.id), ["Bar"], "only the printer that took nothing else");
});

// Phase 2 Session 2E (spec §9.2, §11): a printer of this PC is one of its Windows printers, by name, on the cafe's own
// paper; a second Windows printer of the same PC is saved, the same one twice is refused in words.
test("2E: a Windows printer of this PC by its name, on the cafe's paper; a second one saves, the same one twice is refused", () => {
  assert.equal(printerPaperOf("58mm"), 58);
  assert.equal(printerPaperOf("80mm"), 80);
  const kitchen = windowsPrinterConnectionOf("dev-pc", "Kitchen TVS", 58);
  assert.deepEqual(kitchen, { connection: { kind: "device", deviceId: "dev-pc", transport: "windows", address: "Kitchen TVS" }, paper: 58 });
  const counter = printer("Counter", { connection: { kind: "device", deviceId: "dev-pc", transport: "windows", address: "EPSON TM-T82" } });
  const draft = draftWithLocal({ ...printerDraftOf(null, [KITCHEN]), name: "Kitchen" }, kitchen);
  const saved = printerBodyOf(draft, [counter]);
  assert.ok(saved.ok && saved.body.connection.kind === "device" && saved.body.connection.address === "Kitchen TVS" && saved.body.paper === 58, "a second Windows printer of this PC");
  const twice = printerBodyOf(draftWithLocal(draft, windowsPrinterConnectionOf("dev-pc", "EPSON TM-T82", 80)), [counter]);
  assert.ok(!twice.ok && twice.error === "Counter already prints on that Windows printer. Choose another Windows printer.", "the same printer twice");
  // Two Windows printers of one PC: each row says which Windows printer it is (a Bluetooth address says nothing to staff).
  assert.equal(connectionText(counter, DEVICES, "dev-pc"), "Windows printer EPSON TM-T82 · This device");
});

// The 2D review gate (M-4): Test print said "sent" for a printer this device writes but could not print right then; the
// slip only waited in the panel until it went stale. It is offered only when its slip can print, or will once the
// printer's own device is back, and the toast says which.
test("2D gate (M-4): Test print is offered only when its slip can print, and the toast says when another device is away", () => {
  const here = { deviceId: "me", localIds: ["Mine"], canPrint: true };
  const mine = printer("Mine", { connection: { kind: "device", deviceId: "me", transport: "usb", address: "04b8:0e15" } });
  const lan = printer("Kitchen", { connection: { kind: "lan", host: "192.168.1.60", port: 9100 }, primaryDeviceId: "tablet-0001", slips: { ...NO_SLIPS, notices: true } });
  const all = [mine, lan];
  assert.equal(testPrintBlock(mine, all, here), null, "this device's own printer, ready");
  assert.equal(testPrintBlock(mine, all, { ...here, canPrint: false }), "Connect this device's printer to test it.", "not ready here: nothing would print");
  assert.equal(testPrintBlock({ ...mine, id: "Other" }, [{ ...mine, id: "Other" }], here), "This device prints it, but it is not this device's printer. Edit it first.", "written here, but not its printer");
  assert.equal(testPrintBlock(lan, all, here), null, "another device's printer: its slip waits for that device");
  assert.equal(testPrintBlock({ ...lan, enabled: false }, [{ ...lan, enabled: false }], here), "Switch it on, choose its slips and its printing device to test it.", "not routable");
  assert.equal(testPrintSentText(lan, { tone: "ok", text: "POS app is online" }), "Test slip sent to Kitchen.");
  assert.equal(testPrintSentText(lan, { tone: "bad", text: "POS app is offline" }), "Test slip sent to Kitchen. It prints when its printing device is back online.");
});

// The 2D review gate (M-8): a printer already switched off does not "stop printing" because of a station delete.
test("2D gate (M-8): a station delete names only printers that print now and would take no slip after it", () => {
  const bar = printer("Bar", { slips: { ...NO_SLIPS, kotStations: ["s-bar"] } });
  const barOff = printer("Bar off", { enabled: false, slips: { ...NO_SLIPS, kotStations: ["s-bar"] } });
  assert.deepEqual(printersLeftEmptyBy([bar, barOff], "s-bar").map((p) => p.id), ["Bar"], "the switched-off printer is not named");
});

const CAFE = process.cwd();
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

test("PIN (2D): the setup page's reads are on that page only (never polled); every error is toasted at the hook; a save refreshes this device's printers", () => {
  const hooks = src("hooks/use-print-setup.ts");
  assert.ok(!/refetchInterval/.test(hooks), "never polled");
  assert.equal((hooks.match(/onError: \(err: Error\) => toast\.error\(/g) ?? []).length, 5, "each write toasts its own error");
  assert.ok(!/\.mutate\(\s*[^)]*,\s*\{/.test(hooks), "no per-call callbacks");
  assert.equal((hooks.match(/onSuccess: \(\) => qc\.invalidateQueries\(\{ queryKey: PRINTERS_KEYS\.all \}\)/g) ?? []).length, 2, "a printer save or delete refreshes the printers this device (and its agent) reads");
  assert.match(hooks, /headers: printAgentHeaders\(readDeviceId\(\)\)/, "a test print names this device and tab");
  assert.match(hooks, /if \(ref\.leased !== undefined\) deliverLeasedJob\(ref\.leased\);/, "a test slip leased to this tab prints here at once");
});
