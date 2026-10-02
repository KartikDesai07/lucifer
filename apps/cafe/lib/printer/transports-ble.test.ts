import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BLE_CHUNK_BYTES,
  BLE_CHUNK_PAUSE_MS,
  BLE_PRINTER_SERVICES,
  BLE_PRINTER_SERVICE_UUIDS,
  bleRecordOf,
  bleWriteMode,
  connectBle,
  findWritableCharacteristic,
} from "@/lib/printer/transport-ble";
import type { BleCharacteristicLike, BleDeviceLike, BleServerLike, BleServiceLike } from "@/lib/printer/web-printer-types";

// ---- Web Bluetooth ---------------------------------------------------------------

function fakeChar(uuid: string, write: boolean, withoutResponse: boolean, calls: { kind: string; len: number }[] = []): BleCharacteristicLike {
  return {
    uuid,
    properties: { write, writeWithoutResponse: withoutResponse },
    writeValueWithResponse: async (v) => void calls.push({ kind: "with", len: v.length }),
    writeValueWithoutResponse: async (v) => void calls.push({ kind: "without", len: v.length }),
  };
}

function fakeServer(services: Record<string, BleCharacteristicLike[]>, probes: string[] = []): BleServerLike {
  const serviceOf = (uuid: string): BleServiceLike => ({
    uuid,
    getCharacteristic: async (c) => {
      const found = services[uuid]?.find((x) => x.uuid === c);
      if (!found) throw new Error("no such characteristic");
      return found;
    },
    getCharacteristics: async () => services[uuid] ?? [],
  });
  const server: BleServerLike = {
    connected: true,
    connect: async () => server,
    disconnect: () => undefined,
    getPrimaryService: async (uuid) => {
      probes.push(uuid);
      if (!(uuid in services)) throw new Error("no such service");
      return serviceOf(uuid);
    },
    getPrimaryServices: async () => Object.keys(services).map(serviceOf),
  };
  return server;
}

test("the BLE service table has the five known printers, lowercase 128-bit, and feeds the chooser list", () => {
  assert.equal(BLE_PRINTER_SERVICES.length, 5);
  for (const row of BLE_PRINTER_SERVICES) {
    assert.match(row.service, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    if (row.characteristic !== null) assert.match(row.characteristic, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  }
  assert.deepEqual(BLE_PRINTER_SERVICE_UUIDS, BLE_PRINTER_SERVICES.map((r) => r.service));
  assert.equal(BLE_PRINTER_SERVICES.filter((r) => r.characteristic === null).length, 1);
});

test("bleWriteMode: without-response only when it is the sole write property", () => {
  assert.equal(bleWriteMode({ write: true, writeWithoutResponse: true }), "with-response");
  assert.equal(bleWriteMode({ write: true, writeWithoutResponse: false }), "with-response");
  assert.equal(bleWriteMode({ write: false, writeWithoutResponse: true }), "without-response");
  assert.equal(bleWriteMode({ write: false, writeWithoutResponse: false }), null);
});

test("discovery tries the known table BEFORE scanning every service", async () => {
  const known = BLE_PRINTER_SERVICES[1];
  const wanted = fakeChar(known.characteristic ?? "", true, false);
  const decoy = fakeChar("0000beef-0000-1000-8000-00805f9b34fb", true, false);
  const probes: string[] = [];
  const server = fakeServer({ "0000dead-0000-1000-8000-00805f9b34fb": [decoy], [known.service]: [wanted] }, probes);
  const found = await findWritableCharacteristic(server);
  assert.equal(found?.characteristic, wanted);
  assert.equal(found?.serviceUuid, known.service);
  assert.deepEqual(probes, [BLE_PRINTER_SERVICES[0].service, known.service], "stopped at the first table hit");
});

test("a known service with no named characteristic uses its first writable one; unknown printers fall back to any writable", async () => {
  const noChar = BLE_PRINTER_SERVICES.find((r) => r.characteristic === null);
  assert.ok(noChar);
  const readOnly = fakeChar("0000a001-0000-1000-8000-00805f9b34fb", false, false);
  const writable = fakeChar("0000a002-0000-1000-8000-00805f9b34fb", false, true);
  const viaTable = await findWritableCharacteristic(fakeServer({ [noChar.service]: [readOnly, writable] }));
  assert.equal(viaTable?.characteristic, writable);
  const generic = await findWritableCharacteristic(fakeServer({ "0000cafe-0000-1000-8000-00805f9b34fb": [readOnly, writable] }));
  assert.equal(generic?.characteristic, writable);
  assert.equal(generic?.serviceUuid, "0000cafe-0000-1000-8000-00805f9b34fb");
  assert.equal(await findWritableCharacteristic(fakeServer({ "0000cafe-0000-1000-8000-00805f9b34fb": [readOnly] })), null);
});

test("a saved service+characteristic is tried first; a changed layout falls back to discovery", async () => {
  const saved = fakeChar("0000a002-0000-1000-8000-00805f9b34fb", true, false);
  const server = fakeServer({ "0000cafe-0000-1000-8000-00805f9b34fb": [saved] });
  const direct = await findWritableCharacteristic(server, { serviceUuid: "0000cafe-0000-1000-8000-00805f9b34fb", characteristicUuid: saved.uuid });
  assert.equal(direct?.characteristic, saved);
  const moved = await findWritableCharacteristic(server, { serviceUuid: "0000gone-0000-1000-8000-00805f9b34fb", characteristicUuid: "x" });
  assert.equal(moved?.characteristic, saved);
});

function fakeDevice(server: BleServerLike, name?: string): BleDeviceLike & { listeners: Set<() => void> } {
  const listeners = new Set<() => void>();
  return {
    id: "device-1",
    name,
    gatt: server,
    listeners,
    addEventListener: (_t, fn) => void listeners.add(fn),
    removeEventListener: (_t, fn) => void listeners.delete(fn),
  };
}

test("connectBle writes 180-byte chunks with a 20 ms pause between them (none after the last)", async () => {
  const calls: { kind: string; len: number }[] = [];
  const sleeps: number[] = [];
  const char = fakeChar(BLE_PRINTER_SERVICES[0].characteristic ?? "", true, false, calls);
  const device = fakeDevice(fakeServer({ [BLE_PRINTER_SERVICES[0].service]: [char] }), "Kitchen");
  const link = await connectBle(device, async (ms) => void sleeps.push(ms));
  await link.transport.write(new Uint8Array(BLE_CHUNK_BYTES * 2 + 5));
  assert.equal(BLE_CHUNK_BYTES, 180);
  assert.equal(BLE_CHUNK_PAUSE_MS, 20);
  assert.deepEqual(calls, [{ kind: "with", len: 180 }, { kind: "with", len: 180 }, { kind: "with", len: 5 }]);
  assert.deepEqual(sleeps, [20, 20]);
  sleeps.length = 0;
  await link.transport.write(new Uint8Array(10));
  assert.deepEqual(sleeps, [], "a single chunk never pauses");
});

test("connectBle uses write-without-response only when that is the only write property", async () => {
  const calls: { kind: string; len: number }[] = [];
  const only = fakeChar("0000a002-0000-1000-8000-00805f9b34fb", false, true, calls);
  const device = fakeDevice(fakeServer({ "0000cafe-0000-1000-8000-00805f9b34fb": [only] }));
  const link = await connectBle(device, async () => undefined);
  await link.transport.write(new Uint8Array(3));
  assert.deepEqual(calls, [{ kind: "without", len: 3 }]);
});

test("connectBle falls back to the older writeValue call when that is all the engine has", async () => {
  const seen: number[] = [];
  const legacy: BleCharacteristicLike = { uuid: "0000a002-0000-1000-8000-00805f9b34fb", properties: { write: true, writeWithoutResponse: false }, writeValue: async (v) => void seen.push(v.length) };
  const device = fakeDevice(fakeServer({ "0000cafe-0000-1000-8000-00805f9b34fb": [legacy] }));
  const link = await connectBle(device, async () => undefined);
  await link.transport.write(new Uint8Array(7));
  assert.deepEqual(seen, [7]);
});

test("connectBle: a dropped link refuses the write, reports lost to its listener, and close detaches it", async () => {
  const server = fakeServer({ [BLE_PRINTER_SERVICES[0].service]: [fakeChar(BLE_PRINTER_SERVICES[0].characteristic ?? "", true, false)] });
  const device = fakeDevice(server);
  const link = await connectBle(device, async () => undefined);
  let lost = 0;
  link.transport.onLost(() => (lost += 1));
  assert.equal(device.listeners.size, 1);
  [...device.listeners].forEach((fn) => fn());
  assert.equal(lost, 1);
  (server as { connected: boolean }).connected = false;
  await assert.rejects(link.transport.write(new Uint8Array(1)));
  await link.transport.close();
  assert.equal(device.listeners.size, 0);
});

test("connectBle: a device with no gatt, or nothing writable, fails", async () => {
  await assert.rejects(connectBle({ ...fakeDevice(fakeServer({})), gatt: undefined }, async () => undefined));
  await assert.rejects(connectBle(fakeDevice(fakeServer({})), async () => undefined));
});

test("bleRecordOf names the device (or a plain fallback) and keeps the discovered pair", async () => {
  const char = fakeChar(BLE_PRINTER_SERVICES[0].characteristic ?? "", true, false);
  const server = fakeServer({ [BLE_PRINTER_SERVICES[0].service]: [char] });
  const named = fakeDevice(server, "Kitchen");
  const link = await connectBle(named, async () => undefined);
  assert.deepEqual(bleRecordOf(named, "58mm", link), {
    kind: "ble",
    name: "Kitchen",
    paper: "58mm",
    deviceId: "device-1",
    serviceUuid: BLE_PRINTER_SERVICES[0].service,
    characteristicUuid: BLE_PRINTER_SERVICES[0].characteristic,
  });
  assert.equal(bleRecordOf(fakeDevice(server), "80mm", link).name, "Bluetooth printer");
  assert.equal(bleRecordOf(fakeDevice(server, "n".repeat(500)), "80mm", link).name.length, 120);
});
