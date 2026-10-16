import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DEVICE_PRINTER_KEY } from "@/lib/printer/device-printer-store";
import {
  TEXT_KOT_KEY,
  readTextKot,
  subscribeTextKot,
  textKotKeyForDevice,
  textKotKeyForPrinter,
  writeTextKot,
} from "./text-kot-store";

// Printing Phase 4 (spec 2026-10-15 §5.1, S1, S2): the "Fast text KOTs" switch per printer, kept only in this device's
// storage under its own key. Anything absent, unreadable or foreign reads as every switch off (today's pictures).

type FakeStorage = { map: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

function memoryStorage(): FakeStorage {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function installWindow(t: { after(fn: () => void): void }, win: unknown): void {
  const holder = globalThis as unknown as { window?: unknown };
  const had = Object.prototype.hasOwnProperty.call(holder, "window");
  const before = holder.window;
  holder.window = win;
  t.after(() => {
    if (had) holder.window = before;
    else delete holder.window;
  });
}

const KITCHEN = "printer:6710aa00000000000000000a:app:tcp:192.168.1.50:9100";
const BAR = "device:native:bt-classic:aa:bb:cc:dd:ee:ff";

test("the switch's own storage key, never the device printer's", () => {
  assert.equal(TEXT_KOT_KEY, "pos.text-kot.v1", "the documented key");
  assert.notEqual(TEXT_KOT_KEY, DEVICE_PRINTER_KEY, "a key of its own");
  const source = readFileSync(path.join(process.cwd(), "lib/printer/kot-text/text-kot-store.ts"), "utf8");
  for (const name of ["pos.device-printer", "DEVICE_PRINTER_KEY", "readDevicePrinter", "writeDevicePrinter", "watchDevicePrinter"]) {
    assert.ok(!source.includes(name), `the store never reads or writes the device printer's record (${name})`);
  }
});

test("an absent, unreadable or foreign record reads as every switch off", (t) => {
  const storage = memoryStorage();
  installWindow(t, { localStorage: storage });
  assert.equal(readTextKot(KITCHEN), null, "absent");
  for (const raw of ["", "{", "null", "[]", '"on"', "{}", '{"v":2,"printers":{}}', '{"v":1}', `{"v":1,"printers":{"${KITCHEN}":true}}`, `{"v":1,"printers":{"${KITCHEN}":{"narrow80":"yes"}}}`, `{"v":1,"printers":{"${KITCHEN}":{"narrow80":false,"columns":48}}}`, `{"v":1,"printers":{"${KITCHEN}":{"narrow80":false}},"extra":1}`]) {
    storage.map.set(TEXT_KOT_KEY, raw);
    assert.equal(readTextKot(KITCHEN), null, `unreadable: ${raw}`);
  }
});

test("a storage that throws reads as off, and a write does not throw", (t) => {
  const blocked = (): never => {
    throw new Error("blocked");
  };
  installWindow(t, { localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
  assert.equal(readTextKot(KITCHEN), null, "a blocked read is off");
  assert.doesNotThrow(() => writeTextKot(KITCHEN, { narrow80: false }), "a blocked write is swallowed");
});

test("with no window at all (the server render) every switch is off", (t) => {
  installWindow(t, undefined);
  assert.equal(readTextKot(KITCHEN), null, "no window is off");
  assert.doesNotThrow(() => writeTextKot(KITCHEN, null), "no window: nothing to write");
});

test("a write round-trips; null removes that printer only; the last one gone removes the record", (t) => {
  const storage = memoryStorage();
  installWindow(t, { localStorage: storage });
  writeTextKot(KITCHEN, { narrow80: false });
  writeTextKot(BAR, { narrow80: true });
  assert.deepEqual(readTextKot(KITCHEN), { narrow80: false }, "the kitchen printer is on, Automatic");
  assert.deepEqual(readTextKot(BAR), { narrow80: true }, "the bar printer is on, 42 characters");
  assert.deepEqual(JSON.parse(storage.map.get(TEXT_KOT_KEY) ?? ""), { v: 1, printers: { [KITCHEN]: { narrow80: false }, [BAR]: { narrow80: true } } }, "only the 42 choice is kept, never the columns");
  writeTextKot(KITCHEN, null);
  assert.equal(readTextKot(KITCHEN), null, "the kitchen printer is off");
  assert.deepEqual(readTextKot(BAR), { narrow80: true }, "the bar printer stays on");
  writeTextKot(BAR, null);
  assert.equal(storage.map.has(TEXT_KOT_KEY), false, "no printer on: no record at all");
});

test("a write never touches the device printer's record", (t) => {
  const storage = memoryStorage();
  installWindow(t, { localStorage: storage });
  const device = '{"kind":"native","name":"Counter","paper":"80mm","printerId":"AA:BB","transport":"bt-classic"}';
  storage.map.set(DEVICE_PRINTER_KEY, device);
  writeTextKot(BAR, { narrow80: false });
  writeTextKot(BAR, null);
  assert.equal(storage.map.get(DEVICE_PRINTER_KEY), device, "pos.device-printer.v1 is exactly as it was");
});

const ID = "6710AA00000000000000000A";

test("a setup printer's key: its id and how this device reaches it, lower-cased", () => {
  assert.equal(textKotKeyForPrinter(ID, { kind: "app", nativeId: "tcp:192.168.1.50:9100" }), "printer:6710aa00000000000000000a:app:tcp:192.168.1.50:9100", "one of the POS app's printers, by the app's id");
  assert.equal(textKotKeyForPrinter(ID, { kind: "app", nativeId: "bt-classic:AA:BB:CC:DD:EE:FF" }), "printer:6710aa00000000000000000a:app:bt-classic:aa:bb:cc:dd:ee:ff", "a Bluetooth printer of the app");
  assert.equal(textKotKeyForPrinter(ID, { kind: "lan", host: "192.168.1.50", port: 9100 }), "printer:6710aa00000000000000000a:lan:192.168.1.50:9100", "a network printer of the Windows app");
  assert.equal(textKotKeyForPrinter(ID, { kind: "windows", name: "POS-80 Printer" }), "printer:6710aa00000000000000000a:windows:pos-80 printer", "a Windows printer by name");
  assert.equal(
    textKotKeyForPrinter(ID, { kind: "native", name: "Counter", paper: "80mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" }),
    "printer:6710aa00000000000000000a:native:bt-classic:aa:bb:cc:dd:ee:ff",
    "printed on this device's own printer (an app on bridge v1)",
  );
});

test("a setup printer reached another way has a new key, so its switch reads off until its own text test", () => {
  const base = textKotKeyForPrinter(ID, { kind: "app", nativeId: "tcp:192.168.1.50:9100" });
  assert.equal(textKotKeyForPrinter(ID.toLowerCase(), { kind: "app", nativeId: "TCP:192.168.1.50:9100" }), base, "the same printer: the same key, whatever the case");
  for (const [why, key] of [
    ["another address", textKotKeyForPrinter(ID, { kind: "app", nativeId: "tcp:192.168.1.51:9100" })],
    ["another port", textKotKeyForPrinter(ID, { kind: "app", nativeId: "tcp:192.168.1.50:9101" })],
    ["another Bluetooth printer", textKotKeyForPrinter(ID, { kind: "app", nativeId: "bt-classic:aa:bb:cc:dd:ee:01" })],
    ["reached as the Windows app's network printer", textKotKeyForPrinter(ID, { kind: "lan", host: "192.168.1.50", port: 9100 })],
    ["another setup printer", textKotKeyForPrinter("6710aa00000000000000000b", { kind: "app", nativeId: "tcp:192.168.1.50:9100" })],
    ["this device's own printer in simple mode", textKotKeyForDevice({ kind: "native", name: "N", paper: "80mm", printerId: "tcp:192.168.1.50:9100", transport: "tcp" })],
  ] as const) {
    assert.notEqual(key, base, why);
  }
});

test("this device's own printer's key, per kind", () => {
  assert.equal(textKotKeyForDevice({ kind: "native", name: "Counter", paper: "80mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" }), BAR, "the POS app's printer, by the app's id");
  assert.equal(textKotKeyForDevice({ kind: "native", name: "Network printer 10.0.2.2", paper: "58mm", printerId: "tcp:10.0.2.2:9100", transport: "tcp" }), "device:native:tcp:10.0.2.2:9100", "the POS app's network printer");
  assert.equal(textKotKeyForDevice({ kind: "serial", name: "USB printer", paper: "58mm", usbVendorId: 1208, usbProductId: 514 }), "device:serial:1208:514", "a USB serial printer by its ids");
  assert.equal(textKotKeyForDevice({ kind: "serial", name: "Bluetooth Printer", paper: "80mm", bluetoothServiceClassId: "00001101-0000-1000-8000-00805f9b34fb" }), "device:serial:bluetooth printer", "a serial printer with no USB ids, by its name (the planning review's m-8)");
  assert.equal(textKotKeyForDevice({ kind: "ble", name: "Kitchen", paper: "58mm", deviceId: "Abc123==", serviceUuid: "s", characteristicUuid: "c" }), "device:ble:abc123==", "a Bluetooth LE printer by its device id");
  assert.equal(textKotKeyForDevice({ kind: "windows", name: "POS-80 Printer" }), "device:windows:pos-80 printer", "the Windows app's chosen printer, by its name");
  assert.notEqual(textKotKeyForDevice({ kind: "windows", name: "POS-58" }), textKotKeyForDevice({ kind: "windows", name: "POS-80 Printer" }), "another Windows printer");
});

test("a change in this page or another tab tells the subscribers; another key does not", (t) => {
  const storage = memoryStorage();
  const handlers: Array<(event: { key: string | null }) => void> = [];
  installWindow(t, {
    localStorage: storage,
    addEventListener: (type: string, fn: (event: { key: string | null }) => void) => {
      if (type === "storage") handlers.push(fn);
    },
    removeEventListener: (type: string, fn: (event: { key: string | null }) => void) => {
      if (type === "storage") handlers.splice(handlers.indexOf(fn), 1);
    },
  });
  let heard = 0;
  const stop = subscribeTextKot(() => heard++);
  writeTextKot(KITCHEN, { narrow80: false });
  assert.equal(heard, 1, "an in-page write");
  for (const fn of [...handlers]) fn({ key: TEXT_KOT_KEY });
  assert.equal(heard, 2, "another tab's write");
  for (const fn of [...handlers]) fn({ key: DEVICE_PRINTER_KEY });
  assert.equal(heard, 2, "another record's change is not this one");
  for (const fn of [...handlers]) fn({ key: null });
  assert.equal(heard, 3, "storage cleared");
  stop();
  writeTextKot(KITCHEN, null);
  assert.equal(heard, 3, "unsubscribed");
  assert.equal(handlers.length, 0, "the storage listener is removed");
});
