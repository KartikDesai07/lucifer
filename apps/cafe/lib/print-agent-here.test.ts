import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterConfig } from "@pos/shared/print-printers";
import { agentPrintersOf, type DesktopPrinters, type NativePoolView } from "@/lib/print-agent-printers";
import { deviceTransportOf, printersHereOf, printersNotHereOf } from "@/lib/print-agent-here";
import type { DesktopLanPrinter } from "@/lib/printer/desktop-lan";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// PX-2 (spec §6.5, R9, F-I3): `here`, every printer this device prints now, in the setup's display order, each with the
// app's name for it, its transport word and its (held) state; and `notHere`, the printers it writes that are not its own.
// The client's case: one Android tablet, two Bluetooth printers (Kitchen, Bill), Kitchen stopped.

const SLIPS = { bill: true, kotStations: [], kotAll: false, notices: false, eod: false };

function printer(id: string, name: string, order: number, connection: PrinterConfig["connection"], over: Partial<PrinterConfig> = {}): PrinterConfig {
  return { id, name, connection, order, paper: 58, slips: SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

const KITCHEN = printer("kitchen", "Kitchen printer", 0, { kind: "device", deviceId: "tab", transport: "bt-classic", address: "A" });
const BILL = printer("bill", "Bill printer", 1, { kind: "device", deviceId: "tab", transport: "bt-classic", address: "B" });
const RPP = { name: "RPP02N" };
const POOL: NativePoolView = {
  printers: [
    { id: "bt-classic:A", status: "disconnected", printer: RPP },
    { id: "bt-classic:B", status: "connected", printer: RPP },
  ],
  defaultId: "bt-classic:B",
};
const SAME = (_key: string, status: PrinterStatus): PrinterStatus => status;

function recording(): { keys: string[]; held: (key: string, status: PrinterStatus) => PrinterStatus } {
  const keys: string[] = [];
  return { keys, held: (key, status) => (keys.push(key), status) };
}

test("the client's tablet on bridge v2: Kitchen down, Bill ready, in the setup's order with the app's name and Bluetooth", () => {
  const printers = [BILL, KITCHEN];
  const agent = agentPrintersOf(printers, "tab", null, null, POOL);
  const { keys, held } = recording();
  const here = printersHereOf(printers, agent, POOL, null, null, "none", held);
  assert.deepEqual(
    here,
    [
      { id: "kitchen", name: "Kitchen printer", appName: "RPP02N", transport: "bluetooth", nativeId: "bt-classic:A", status: "disconnected" },
      { id: "bill", name: "Bill printer", appName: "RPP02N", transport: "bluetooth", nativeId: "bt-classic:B", status: "connected" },
    ],
    "Kitchen first (order 0), whatever order the read lists them in",
  );
  assert.deepEqual(keys, ["bt-classic:A", "bt-classic:B"], "each app printer is held by its native id");
});

test("the held status is what `here` says (a retry stays down)", () => {
  const retrying: NativePoolView = { printers: [{ id: "bt-classic:A", status: "connecting", printer: RPP }], defaultId: null };
  const agent = agentPrintersOf([KITCHEN], "tab", null, null, retrying);
  const here = printersHereOf([KITCHEN], agent, retrying, null, null, "none", (key, status) => (key === "bt-classic:A" && status === "connecting" ? "disconnected" : status));
  assert.equal(here[0]?.status, "disconnected", "the held value, not the raw connecting");
});

test("a printer's problem comes from the pool entry's paper, cover and error flags; low paper is no problem", () => {
  const pool = (over: Partial<NativePoolView["printers"][number]>): NativePoolView => ({ printers: [{ id: "bt-classic:A", status: "connected", printer: RPP, ...over }], defaultId: null });
  const of = (p: NativePoolView) => printersHereOf([KITCHEN], agentPrintersOf([KITCHEN], "tab", null, null, p), p, null, null, "none", SAME)[0];
  assert.equal(of(pool({ paper: "out" }))?.problem, "paper-out", "out of paper");
  assert.equal(of(pool({ cover: "open" }))?.problem, "cover-open", "cover open");
  assert.equal(of(pool({ error: true }))?.problem, "error", "an error");
  assert.equal(of(pool({ paper: "low" }))?.problem, undefined, "low paper still prints");
  assert.equal(of(pool({}))?.problem, undefined, "nothing said");
});

test("a network printer on the POS app is 'network'; one it may only take over is left out until it is taken over (R9)", () => {
  const counter = printer("counter", "Counter printer", 0, { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "tab" });
  const theirs = printer("theirs", "Bar printer", 1, { kind: "lan", host: "192.168.1.61", port: 9100 }, { primaryDeviceId: "other" });
  const pool: NativePoolView = {
    printers: [
      { id: "tcp:192.168.1.60:9100", status: "connected", printer: { name: "192.168.1.60" } },
      { id: "tcp:192.168.1.61:9100", status: "connected", printer: { name: "192.168.1.61" } },
    ],
    defaultId: null,
  };
  const agent = agentPrintersOf([counter, theirs], "tab", null, null, pool);
  assert.deepEqual(agent.takeoverIds, ["theirs"], "fixture: the bar printer is one it may take over");
  const here = printersHereOf([counter, theirs], agent, pool, null, null, "none", SAME);
  assert.deepEqual(here.map((h) => [h.id, h.transport]), [["counter", "network"]], "only its own network printer while nothing is taken over");
  const taken = printersHereOf([counter, theirs], agent, pool, null, null, "none", SAME, ["theirs"]);
  assert.deepEqual(taken.map((h) => h.id), ["counter", "theirs"], "the bar printer counts while the wake says it writes it");
});

test("a browser tab's or an older app's one printer is held by device:<printer id>, with its own transport", () => {
  const web = printer("web", "Kitchen printer", 0, { kind: "device", deviceId: "tab", transport: "web-bluetooth", address: "ble-1" });
  const local: DevicePrinter = { kind: "ble", name: "MTP-II", paper: "58mm", deviceId: "ble-1", serviceUuid: "s", characteristicUuid: "c" };
  const { keys, held } = recording();
  const here = printersHereOf([web], agentPrintersOf([web], "tab", local, null, null), null, null, local, "needs-tap", held);
  assert.deepEqual(here, [{ id: "web", name: "Kitchen printer", appName: "MTP-II", transport: "bluetooth", status: "needs-tap" }], "no native id: this device's own printer");
  assert.deepEqual(keys, ["device:web"], "held under the setup printer's id");
  const v1: DevicePrinter = { kind: "native", name: "RPP02N", paper: "58mm", printerId: "bt-classic:A", transport: "bt-classic" };
  const onV1 = printersHereOf([KITCHEN], agentPrintersOf([KITCHEN], "tab", v1, null, null), null, null, v1, "disconnected", SAME);
  assert.deepEqual(onV1.map((h) => [h.appName, h.transport, h.status, h.nativeId]), [["RPP02N", "bluetooth", "disconnected", undefined]], "the app on v1: its one printer");
});

test("deviceTransportOf: the saved printer's transport word", () => {
  const native = (transport: "bt-classic" | "ble" | "tcp" | "usb"): DevicePrinter => ({ kind: "native", name: "P", paper: "80mm", printerId: `${transport}:x`, transport });
  assert.deepEqual(["bt-classic", "ble", "tcp", "usb"].map((t) => deviceTransportOf(native(t as "bt-classic"))), ["bluetooth", "bluetooth", "network", "usb"], "the app's four transports");
  assert.equal(deviceTransportOf({ kind: "ble", name: "P", paper: "58mm", deviceId: "d", serviceUuid: "s", characteristicUuid: "c" }), "bluetooth", "Web Bluetooth");
  assert.equal(deviceTransportOf({ kind: "serial", name: "P", paper: "80mm", usbVendorId: 1 }), "usb", "a Web Serial USB port");
  assert.equal(deviceTransportOf({ kind: "serial", name: "P", paper: "80mm", bluetoothServiceClassId: "x" }), "bluetooth", "a Web Serial Bluetooth port");
  assert.equal(deviceTransportOf({ kind: "serial", name: "P", paper: "80mm" }), "browser", "a Web Serial port the browser says nothing of");
});

test("the Windows app: a printer chosen by name has no state word; a network printer has its link; neither has a native id (F-I3)", () => {
  const epson = printer("epson", "Bill printer", 0, { kind: "device", deviceId: "pc", transport: "windows", address: "EPSON TM-T82" });
  const kitchen = printer("kitchen", "Kitchen printer", 1, { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "pc" });
  const desktop: DesktopPrinters = { selected: "EPSON TM-T82", names: ["EPSON TM-T82"], named: true, lan: true };
  const lan: DesktopLanPrinter[] = [{ id: "tcp:192.168.1.60:9100", host: "192.168.1.60", port: 9100, status: "disconnected" }];
  const { keys, held } = recording();
  const here = printersHereOf([epson, kitchen], agentPrintersOf([epson, kitchen], "pc", null, desktop, null), null, lan, null, "none", held);
  assert.deepEqual(
    here,
    [
      { id: "epson", name: "Bill printer", appName: "EPSON TM-T82", transport: "windows", status: "none" },
      { id: "kitchen", name: "Kitchen printer", appName: "192.168.1.60", transport: "network", status: "disconnected" },
    ],
    "a Windows printer by name, no state word; the app's network printer by its address and its own link",
  );
  assert.ok(here.every((h) => h.nativeId === undefined), "no Windows printer is ever reconnected by a native id");
  assert.deepEqual(keys, [], "the Windows app's printers are not held (the desktop dot is unchanged, R9)");
  const old: DesktopPrinters = { ...desktop, named: false, lan: false };
  const onOld = printersHereOf([epson], agentPrintersOf([epson], "pc", null, old, null), null, null, null, "none", SAME);
  assert.deepEqual(onOld.map((h) => [h.transport, h.status]), [["windows", "none"]], "an older app's chosen printer too");
});

test("printersNotHereOf names the printers this device writes that are not its own, in the setup's order", () => {
  const bar = printer("bar", "Bar printer", 2, { kind: "device", deviceId: "tab", transport: "bt-classic", address: "C" });
  const theirs = printer("theirs", "Pass printer", 3, { kind: "device", deviceId: "other", transport: "bt-classic", address: "D" });
  const printers = [bar, theirs, BILL, KITCHEN];
  const agent = agentPrintersOf(printers, "tab", null, null, POOL);
  assert.deepEqual(printersNotHereOf(printers, "tab", agent), ["Bar printer"], "the app has no printer C");
  assert.deepEqual(printersNotHereOf([KITCHEN, BILL], "tab", agentPrintersOf([KITCHEN, BILL], "tab", null, null, POOL)), [], "both are its own");
  assert.deepEqual(printersNotHereOf(printers, "", agent), [], "no device id: nothing");
  assert.deepEqual(printersNotHereOf(printers, "phone", agentPrintersOf(printers, "phone", null, null, null)), [], "a phone that writes nothing");
});
