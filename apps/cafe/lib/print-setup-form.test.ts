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
  appPrinterConnectionOf,
  onePrinterAppMessage,
  onePrinterDevicesOf,
  lanPrintingDevicesOf,
  PRINTER_PORT_INVALID,
  SETUP_PRINTER_NAME,
  draftWithLocal,
  localPrinterConnectionOf,
  printerBodyOf,
  printerDraftOf,
  setUpPrintersBody,
} from "@/lib/print-setup-form";
import { connectionText, deviceName, printerRowState, printersLeftEmptyBy, setupGaps, slipsText, testPrintBlock, testPrintSentText } from "@/lib/print-setup-text";
import { DEVICE_TAKES_OVER_TEXT, PRINTER_NO_TAKEOVER_TEXT, printerFailoverLines } from "@/lib/print-setup-text";
import { backupChoicesOf } from "@/lib/print-setup-form";
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
    // Phase 3 (the planning review, I-1): a body may say `backupPrinterId: null` (clear it); a config never holds null.
    const config: PrinterConfig = { id: "p1", order: 0, ...body, backupPrinterId: body.backupPrinterId ?? undefined };
    assert.equal(printerIsLocal(config, local ?? null, null), true, `the agent recognises it as this device's printer (${local?.kind})`);
  }
  const windows = localPrinterConnectionOf({ local: null, deviceId: "dev-a", desktop: { printerName: "EPSON" }, defaultPaper: 58 });
  const windowsBody = windows === null ? null : setUpPrintersBody(windows);
  assert.ok(
    windowsBody !== null && printerIsLocal({ id: "w", order: 0, ...windowsBody, backupPrinterId: windowsBody.backupPrinterId ?? undefined }, null, { selected: "EPSON", names: ["EPSON"], named: false }),
    "the Windows app's printer",
  );
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
  // Session 2F1 (deliberate change): a tablet whose POS app speaks bridge v2 prints several printers; one on v1 (the
  // form's `onePrinter`) still one, and no device prints the same printer twice.
  const clash = printerBodyOf(base, [kitchenTab], undefined, undefined, ["kitchen-tab"]);
  assert.ok(!clash.ok && clash.error.includes("already prints Counter"), "that device already prints the Counter printer");
  assert.ok(printerBodyOf(base, [kitchenTab]).ok, "Session 2F1: a tablet whose app prints several printers prints both");
  const same = printerBodyOf({ ...base, host: "10.0.0.5" }, [kitchenTab]);
  assert.deepEqual(same, { ok: false, error: "Counter already prints on that printer. Choose another printer." }, "never the same printer twice");
  assert.ok(printerBodyOf({ ...base, enabled: false }, [kitchenTab], undefined, undefined, ["kitchen-tab"]).ok, "saved switched off: no clash");
  assert.ok(printerBodyOf(base, [kitchenTab], "Counter", undefined, ["kitchen-tab"]).ok, "editing that very printer");
  const copies = printerBodyOf({ ...base, copiesKot: 9, copiesBill: 0 }, []);
  assert.ok(copies.ok && copies.body.copies.kot === 3 && copies.body.copies.bill === 1, "copies kept within 1–3");
});

// Phase 2 Session 2F1 (spec §9.2, §11): the POS app on bridge v2 prints each of its printers; an app on v1 prints one.
test("2F1: one of the app's printers as a connection, at the form's paper; a POS app on v1 prints one printer, said in words", () => {
  const tcp = { kind: "native" as const, name: "Network printer", paper: "80mm" as const, printerId: "tcp:10.0.2.2:9101", transport: "tcp" as const };
  assert.deepEqual(appPrinterConnectionOf(tcp, "dev-a", 58), { connection: { kind: "lan", host: "10.0.2.2", port: 9101 }, primaryDeviceId: "dev-a", paper: 58 }, "a network printer this device prints, at the form's paper");
  const bt = { kind: "native" as const, name: "RPP02N", paper: "80mm" as const, printerId: "bt-classic:00:11:22:33:44:55", transport: "bt-classic" as const };
  assert.deepEqual(appPrinterConnectionOf(bt, "dev-a", 80), { connection: { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "00:11:22:33:44:55" }, paper: 80 }, "a Bluetooth printer of this device");
  const devices: PrintDeviceSummary[] = [
    { deviceId: "tab-v2", label: "POS app", shell: "android", online: true, lastSeenAt: "2026-10-05T10:00:00.000Z", nativeProtocol: 2 },
    { deviceId: "tab-v1", label: "POS app", shell: "android", online: true, lastSeenAt: "2026-10-05T10:00:00.000Z", nativeProtocol: 1 },
    { deviceId: "tab-old", label: "POS app", shell: "android", online: false, lastSeenAt: "2026-10-04T10:00:00.000Z" },
    { deviceId: "pc", label: "Counter PC", shell: "windows", online: true, lastSeenAt: "2026-10-05T10:00:00.000Z" },
  ];
  assert.deepEqual(onePrinterDevicesOf(devices, { deviceId: "me", native: true, v2: true }), ["tab-v1", "tab-old"], "a tablet whose wake said v1, or nothing yet");
  assert.deepEqual(onePrinterDevicesOf(devices, { deviceId: "me", native: true, v2: false }), ["me", "tab-v1", "tab-old"], "this device too, on an app that speaks only v1");
  assert.deepEqual(onePrinterDevicesOf(devices, { deviceId: "me", native: false, v2: false }), ["tab-v1", "tab-old"], "a browser or a PC is never in it");
  const counter = printer("Counter", { connection: { kind: "lan", host: "10.0.0.5", port: 9100 }, primaryDeviceId: "tab-v1" });
  const bar = { ...printerDraftOf(null, []), name: "Bar", host: "10.0.0.6", primaryDeviceId: "tab-v1", notices: true };
  assert.deepEqual(printerBodyOf(bar, [counter], undefined, undefined, ["tab-v1"]), { ok: false, error: onePrinterAppMessage("Counter") });
  assert.equal(onePrinterAppMessage("Counter"), "That device's POS app prints one printer (or has not checked in since it was updated), and it already prints Counter. Update the POS app on it to print several printers there.");
  assert.ok(printerBodyOf({ ...bar, primaryDeviceId: "tab-v2" }, [{ ...counter, primaryDeviceId: "tab-v2" }]).ok, "a tablet on v2 prints both");
  assert.ok(printerBodyOf({ ...bar, enabled: false }, [counter], undefined, undefined, ["tab-v1"]).ok, "saved switched off: never leased");
});

test("3E: a network printer may be printed by this device when it writes network printers, every POS app, and a Windows app 1.12.0; its saved device stays offered", () => {
  const devices: PrintDeviceSummary[] = [
    { deviceId: "tab", label: "POS app", shell: "android", online: true, lastSeenAt: "2026-10-09T10:00:00.000Z", lan: true },
    { deviceId: "pc-new", label: "Counter PC", shell: "windows", online: true, lastSeenAt: "2026-10-09T10:00:00.000Z", lan: true },
    { deviceId: "pc-old", label: "Counter PC", shell: "windows", online: true, lastSeenAt: "2026-10-09T10:00:00.000Z" },
    { deviceId: "tab-old", label: "POS app", shell: "android", online: false, lastSeenAt: "2026-10-09T09:00:00.000Z" },
    { deviceId: "web", label: "Counter PC", shell: "browser", online: true, lastSeenAt: "2026-10-09T10:00:00.000Z" },
  ];
  assert.deepEqual(lanPrintingDevicesOf(devices, { deviceId: "pc-new", lan: true }, ""), ["pc-new", "tab", "tab-old"], "a Windows app 1.12.0 offers itself, and every POS app");
  assert.deepEqual(lanPrintingDevicesOf(devices, { deviceId: "web", lan: false }, ""), ["tab", "pc-new", "tab-old"], "from a browser: the POS apps and the Windows app 1.12.0, never the old one or a browser");
  assert.deepEqual(lanPrintingDevicesOf(devices, { deviceId: "web", lan: false }, "pc-old"), ["tab", "pc-new", "tab-old", "pc-old"], "a saved device stays offered");
  assert.deepEqual(lanPrintingDevicesOf(devices, { deviceId: "", lan: true }, ""), ["tab", "pc-new", "tab-old"], "no device identity yet: not itself");
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

// The 2F1 review gate (M-2): one of the POS app's printers (bridge v2) has a state of its own, so its words name it.
test("2F1 gate (M-2): a printer with a state of its own is named when it is not ready, and in its Test print's reason", () => {
  const here = { deviceId: "me", localIds: ["Mine"], canPrint: false, ownState: true };
  const mine = printer("Mine", { connection: { kind: "device", deviceId: "me", transport: "bt-classic", address: "00:11:22:33:44:55" } });
  assert.deepEqual(printerRowState(mine, DEVICES, here), { tone: "bad", text: "Mine is not ready on this device" });
  assert.equal(testPrintBlock(mine, [mine], here), "Connect Mine on this device to test it.");
  assert.deepEqual(printerRowState(mine, DEVICES, { ...here, ownState: false }), { tone: "bad", text: "This device's printer is not ready" }, "this device's own printer: as before");
  assert.deepEqual(printerRowState(mine, DEVICES, { ...here, canPrint: true }), { tone: "ok", text: "Prints on this device" });
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

// Phase 3 Session 3B (spec §9.4, §11): the backup printer in the printer form. "None", or another printer routing sends
// slips to; a saved backup that stopped taking slips stays offered, marked "(not in use)", so a save keeps it; a saved
// id the form cannot find (deleted in the instant before a save) shows as none and is sent as null, never an error.
const B_SLIPS = { bill: true, kotStations: [], kotAll: false, notices: false, eod: false };
function cfg(id: string, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return { id, name: id.toUpperCase(), connection: { kind: "lan", host: `10.0.0.${id.length}`, port: 9100 }, primaryDeviceId: `dev-${id}`, order: 0, paper: 80, slips: B_SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

test("3B: the form's backup printer: none, or another printer that takes slips; a saved one that stopped is '(not in use)'; one it cannot find is none, sent as null", () => {
  const printers = [cfg("bar"), cfg("counter"), cfg("off", { enabled: false }), cfg("idle", { slips: { ...B_SLIPS, bill: false } })];
  assert.deepEqual(backupChoicesOf(printers, "bar", ""), [{ id: "counter", label: "COUNTER" }], "never itself, never a printer that takes no slips");
  assert.deepEqual(backupChoicesOf(printers, null, ""), [{ id: "bar", label: "BAR" }, { id: "counter", label: "COUNTER" }], "a new printer may pick any");
  assert.deepEqual(backupChoicesOf(printers, "bar", "off"), [{ id: "counter", label: "COUNTER" }, { id: "off", label: "OFF (not in use)" }], "the saved one, switched off since, stays offered so a save keeps it");
  const saved = printerDraftOf({ ...cfg("bar"), backupPrinterId: "counter" }, []);
  assert.equal(saved.backupPrinterId, "counter");
  assert.equal(printerDraftOf(null, []).backupPrinterId, "", "a new printer: none");
  const body = (draft: typeof saved, list: PrinterConfig[] = printers) => {
    const result = printerBodyOf(draft, list, "bar");
    return result.ok ? result.body.backupPrinterId : "refused";
  };
  assert.equal(body(saved), "counter");
  assert.equal(body({ ...saved, backupPrinterId: "" }), null, "none is sent as null (absent would keep a saved backup: A3)");
  assert.equal(body({ ...saved, backupPrinterId: "gone" }), null, "one the form cannot find: none, never an error");
});

test("3B: a printer row says its backup, who prints it now, its problem in its words, and that no device can take it over", () => {
  const NOW = Date.parse("2026-10-07T12:00:00.000Z");
  const devices: PrintDeviceSummary[] = [
    { deviceId: "dev-kitchen", label: "Kitchen tablet", shell: "android", online: false, lastSeenAt: new Date(NOW - 300_000).toISOString(), nativeProtocol: 2, lanFailover: true },
    { deviceId: "dev-counter", label: "Counter tablet", shell: "android", online: true, lastSeenAt: new Date(NOW).toISOString(), nativeProtocol: 2, lanFailover: true },
  ];
  const counter = cfg("counter", { primaryDeviceId: "dev-counter", health: { link: "connected", paper: "out", deviceId: "dev-counter", at: new Date(NOW - 60_000).toISOString() } });
  const kitchen = cfg("kitchen", { primaryDeviceId: "dev-kitchen", backupPrinterId: "counter" });
  const printers = [kitchen, counter];
  assert.deepEqual(printerFailoverLines(kitchen, printers, devices, "me", NOW), ["Backup: COUNTER", "Printed now by Counter tablet …nter"], "the kitchen tablet offline: the counter took its network printer over");
  assert.deepEqual(printerFailoverLines(counter, printers, devices, "me", NOW), ["COUNTER is out of paper.", PRINTER_NO_TAKEOVER_TEXT], "its writer's fresh report; the kitchen tablet, offline, cannot take it over now");
  assert.deepEqual(printerFailoverLines(kitchen, [kitchen, { ...counter, enabled: false }], devices, "me", NOW)[0], "Backup: COUNTER (not in use)", "a backup that stopped taking slips");
  const off = { ...kitchen, enabled: false };
  assert.deepEqual(printerFailoverLines(off, [off, counter], devices, "me", NOW), ["Backup: COUNTER"], "a printer switched off says only its backup");
  assert.equal(DEVICE_TAKES_OVER_TEXT, "Can take over network printers");
  // Session 3C (the 3B gate review's m-B): with the devices read failed, nothing is known of who prints it now or who could
  // take it over, so the row says only its backup (never "No other device online can take it over").
  assert.deepEqual(printerFailoverLines(counter, printers, [], "me", NOW, true), [], "the devices read failed: no takeover words");
  assert.deepEqual(printerFailoverLines(kitchen, printers, [], "me", NOW, true), ["Backup: COUNTER"], "… only the backup, which the printers read says");
});
