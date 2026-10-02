import { test } from "node:test";
import assert from "node:assert/strict";

import { PAPER_WIDTHS } from "@/lib/constants";
import {
  DEVICE_PRINTER_KEY,
  NAME_MAX_CHARS,
  parseDevicePrinter,
  readDevicePrinter,
  watchDevicePrinter,
  writeDevicePrinter,
  type DevicePrinter,
} from "@/lib/printer/device-printer-store";
import { NATIVE_TRANSPORTS } from "@/lib/printer/native-bridge-protocol";

// The per-device printer record: strict validation on read, never throwing.
// The window is faked per test and restored in t.after.

const SERIAL: DevicePrinter = { kind: "serial", name: "Bluetooth printer", paper: "80mm", bluetoothServiceClassId: "00001101-0000-1000-8000-00805f9b34fb" };
const USB: DevicePrinter = { kind: "serial", name: "USB printer", paper: "58mm", usbVendorId: 1208, usbProductId: 514 };
const BLE: DevicePrinter = { kind: "ble", name: "Kitchen", paper: "58mm", deviceId: "abc", serviceUuid: "000018f0-0000-1000-8000-00805f9b34fb", characteristicUuid: "00002af1-0000-1000-8000-00805f9b34fb" };
const NATIVE: DevicePrinter = { kind: "native", name: "Counter", paper: "80mm", printerId: "AA:BB", transport: "bt-classic" };

type FakeStorage = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

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

function memoryStorage(): FakeStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

test("the storage key is the documented one", () => {
  assert.equal(DEVICE_PRINTER_KEY, "pos.device-printer.v1");
});

test("every printer kind survives a write-read round trip", (t) => {
  const storage = memoryStorage();
  installWindow(t, { localStorage: storage });
  for (const printer of [SERIAL, USB, BLE, NATIVE]) {
    writeDevicePrinter(printer);
    assert.deepEqual(readDevicePrinter(), printer);
  }
});

test("writing null removes the record", (t) => {
  const storage = memoryStorage();
  installWindow(t, { localStorage: storage });
  writeDevicePrinter(BLE);
  assert.ok(storage.map.has(DEVICE_PRINTER_KEY));
  writeDevicePrinter(null);
  assert.equal(storage.map.has(DEVICE_PRINTER_KEY), false);
  assert.equal(readDevicePrinter(), null);
});

test("anything absent, corrupt or foreign reads as no printer", () => {
  const bad: (string | null)[] = [
    null,
    "",
    "{not json",
    "null",
    "[]",
    '"serial"',
    JSON.stringify({ kind: "usb", name: "x", paper: "80mm" }),
    JSON.stringify({ ...SERIAL, paper: "100mm" }),
    JSON.stringify({ ...SERIAL, name: "" }),
    JSON.stringify({ ...SERIAL, name: "n".repeat(NAME_MAX_CHARS + 1) }),
    JSON.stringify({ ...USB, usbVendorId: 70000 }),
    JSON.stringify({ ...USB, usbVendorId: 1.5 }),
    JSON.stringify({ ...BLE, deviceId: undefined }),
    JSON.stringify({ ...NATIVE, transport: "carrier-pigeon" }),
    JSON.stringify({ kind: "constructor", name: "x", paper: "80mm" }),
  ];
  for (const raw of bad) assert.equal(parseDevicePrinter(raw), null, String(raw));
});

test("a record with an extra key is rejected (strict)", () => {
  assert.equal(parseDevicePrinter(JSON.stringify({ ...SERIAL, extra: 1 })), null);
  assert.equal(parseDevicePrinter(JSON.stringify({ ...NATIVE, address: "x" })), null);
  assert.notEqual(parseDevicePrinter(JSON.stringify(SERIAL)), null);
});

test("the paper and transport sets are the shared lists, nothing narrower", () => {
  for (const paper of PAPER_WIDTHS) assert.notEqual(parseDevicePrinter(JSON.stringify({ ...BLE, paper })), null, paper);
  for (const transport of NATIVE_TRANSPORTS) {
    assert.notEqual(parseDevicePrinter(JSON.stringify({ ...NATIVE, transport })), null, transport);
  }
});

test("storage that throws never throws out of read or write", (t) => {
  const angry: FakeStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  installWindow(t, { localStorage: angry });
  assert.equal(readDevicePrinter(), null);
  assert.doesNotThrow(() => writeDevicePrinter(SERIAL));
  assert.doesNotThrow(() => writeDevicePrinter(null));
});

test("without a window the helpers are inert", () => {
  assert.equal(readDevicePrinter(), null);
  assert.doesNotThrow(() => writeDevicePrinter(SERIAL));
  const off = watchDevicePrinter(() => assert.fail("never"));
  assert.doesNotThrow(off);
});

test("watchDevicePrinter fires for this key and for clear-all only, and the remover detaches", (t) => {
  const listeners = new Set<(event: { key: string | null }) => void>();
  installWindow(t, {
    addEventListener: (_type: string, fn: (event: { key: string | null }) => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: (event: { key: string | null }) => void) => listeners.delete(fn),
  });
  let fired = 0;
  const off = watchDevicePrinter(() => (fired += 1));
  assert.equal(listeners.size, 1);
  const [handler] = [...listeners];
  handler({ key: "something.else" });
  assert.equal(fired, 0);
  handler({ key: DEVICE_PRINTER_KEY });
  handler({ key: null });
  assert.equal(fired, 2);
  off();
  assert.equal(listeners.size, 0);
});
