import { test } from "node:test";
import assert from "node:assert/strict";

import type { SerialDevicePrinter } from "@/lib/printer/device-printer-store";
import { PortFake } from "@/lib/printer/device-printer-fakes";
import { nativeError, nativeErrorCode, type NativeClient } from "@/lib/printer/native-bridge";
import { PRINT_DATA_MAX_BASE64_CHARS, type NativePrinterStatus } from "@/lib/printer/native-bridge-protocol";
import {
  NATIVE_BLUETOOTH_BLOCKED_MESSAGE,
  NATIVE_BLUETOOTH_OFF_MESSAGE,
  NATIVE_BUSY_MESSAGE,
  NATIVE_LOCATION_OFF_MESSAGE,
  base64CharsFor,
  nativeErrorMessage,
  nativeStatusToSnapshot,
  nativeWrite,
} from "@/lib/printer/transport-native";
import {
  SERIAL_CHUNK_BYTES,
  SPP_SERVICE_CLASS_ID,
  matchGrantedPort,
  normalizeServiceClassId,
  openSerial,
  serialPrinterName,
  serialRecordOf,
} from "@/lib/printer/transport-serial";
import {
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_TOO_LARGE_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
  type SerialPortInfoLike,
  type SerialPortLike,
} from "@/lib/printer/web-printer-types";

// ---- Web Serial ------------------------------------------------------------------

function fakePort(info: SerialPortInfoLike, log?: { ready: number; chunks: number[]; order: string[] }) {
  return {
    getInfo: () => info,
    open: async () => undefined,
    close: async () => void log?.order.push("close"),
    writable: {
      getWriter: () => {
        log?.order.push("lock");
        return {
          get ready() {
            log?.order.push("ready");
            if (log) log.ready += 1;
            return Promise.resolve();
          },
          write: async (chunk: Uint8Array) => {
            log?.order.push("write");
            log?.chunks.push(chunk.length);
          },
          abort: async () => void log?.order.push("abort"),
          releaseLock: () => void log?.order.push("release"),
        };
      },
    },
  } satisfies SerialPortLike;
}

test("normalizeServiceClassId: a 16-bit number and its UUID string are the same id", () => {
  assert.equal(normalizeServiceClassId(0x1101), SPP_SERVICE_CLASS_ID);
  assert.equal(normalizeServiceClassId("0x1101"), SPP_SERVICE_CLASS_ID);
  assert.equal(normalizeServiceClassId("1101"), SPP_SERVICE_CLASS_ID);
  assert.equal(normalizeServiceClassId(SPP_SERVICE_CLASS_ID.toUpperCase()), SPP_SERVICE_CLASS_ID);
  assert.equal(normalizeServiceClassId(undefined), undefined);
  assert.equal(normalizeServiceClassId(""), undefined);
  assert.equal(normalizeServiceClassId(-1), undefined);
});

test("matchGrantedPort: Bluetooth by class id (number or string), USB by vendor+product, else null", () => {
  const bt: SerialDevicePrinter = { kind: "serial", name: "Bluetooth printer", paper: "80mm", bluetoothServiceClassId: SPP_SERVICE_CLASS_ID };
  const usb: SerialDevicePrinter = { kind: "serial", name: "USB printer", paper: "80mm", usbVendorId: 1208, usbProductId: 514 };
  const numeric = fakePort({ bluetoothServiceClassId: 0x1101 });
  const stringy = fakePort({ bluetoothServiceClassId: SPP_SERVICE_CLASS_ID });
  const wrongUsb = fakePort({ usbVendorId: 1208, usbProductId: 999 });
  const rightUsb = fakePort({ usbVendorId: 1208, usbProductId: 514 });
  assert.equal(matchGrantedPort([wrongUsb, numeric], bt), numeric);
  assert.equal(matchGrantedPort([stringy], bt), stringy);
  assert.equal(matchGrantedPort([wrongUsb, rightUsb], usb), rightUsb);
  assert.equal(matchGrantedPort([wrongUsb], usb), null, "same vendor, other product");
  assert.equal(matchGrantedPort([], bt), null);
  assert.equal(matchGrantedPort([rightUsb], bt), null);
  assert.equal(matchGrantedPort([numeric], { kind: "serial", name: "x", paper: "80mm" }), null, "a record with no identity matches nothing");
});

test("serialRecordOf and serialPrinterName describe the chosen port", () => {
  assert.equal(serialPrinterName({ bluetoothServiceClassId: 0x1101 }), "Bluetooth printer");
  assert.equal(serialPrinterName({ usbVendorId: 1 }), "USB printer");
  assert.equal(serialPrinterName({}), "Printer");
  assert.deepEqual(serialRecordOf(fakePort({ bluetoothServiceClassId: 0x1101 }), "58mm"), {
    kind: "serial",
    name: "Bluetooth printer",
    paper: "58mm",
    bluetoothServiceClassId: SPP_SERVICE_CLASS_ID,
  });
  assert.deepEqual(serialRecordOf(fakePort({ usbVendorId: 1208, usbProductId: 514 }), "80mm"), {
    kind: "serial",
    name: "USB printer",
    paper: "80mm",
    usbVendorId: 1208,
    usbProductId: 514,
  });
});

test("openSerial writes in 2048-byte chunks, awaiting `ready` before each, and always releases the lock", async () => {
  const log = { ready: 0, chunks: [] as number[], order: [] as string[] };
  const transport = await openSerial(fakePort({}, log));
  await transport.write(new Uint8Array(SERIAL_CHUNK_BYTES * 2 + 904));
  assert.equal(SERIAL_CHUNK_BYTES, 2048);
  assert.deepEqual(log.chunks, [2048, 2048, 904]);
  assert.equal(log.ready, 3);
  assert.deepEqual(log.order, ["lock", "ready", "write", "ready", "write", "ready", "write", "release"]);
  log.order.length = 0;
  await transport.write(new Uint8Array(0));
  assert.deepEqual(log.order, ["lock", "release"], "an empty job still takes and gives back the lock");
});

test("openSerial releases the lock when a write throws, and a port that is not writable throws", async () => {
  let released = 0;
  const failing = {
    ...fakePort({}),
    writable: { getWriter: () => ({ ready: Promise.resolve(), write: async () => Promise.reject(new Error("gone")), abort: async () => undefined, releaseLock: () => void (released += 1) }) },
  } satisfies SerialPortLike;
  await assert.rejects((await openSerial(failing)).write(new Uint8Array(10)), /gone/);
  assert.equal(released, 1);
  const closed = { ...fakePort({}), writable: null } satisfies SerialPortLike;
  await assert.rejects((await openSerial(closed)).write(new Uint8Array(1)));
});

test("openSerial retries once through an already-open port and reports a lost link to its one listener", async () => {
  let opens = 0;
  let closes = 0;
  const listeners = new Set<() => void>();
  const port = {
    ...fakePort({}),
    open: async () => {
      opens += 1;
      if (opens === 1) throw Object.assign(new Error("open"), { name: "InvalidStateError" });
    },
    close: async () => void (closes += 1),
    addEventListener: (_t: "disconnect", fn: () => void) => void listeners.add(fn),
    removeEventListener: (_t: "disconnect", fn: () => void) => void listeners.delete(fn),
  } satisfies SerialPortLike;
  const transport = await openSerial(port);
  assert.equal(opens, 2);
  assert.equal(closes, 1);
  let lost = 0;
  transport.onLost(() => (lost += 1));
  [...listeners].forEach((fn) => fn());
  assert.equal(lost, 1);
  await transport.close();
  assert.equal(listeners.size, 0, "closing detaches the listener");
});

test("R2-W1: close() aborts a write still in flight, gives the lock back, THEN closes the port", async () => {
  const log = { ready: 0, chunks: [] as number[], order: [] as string[] };
  const port = fakePort({}, log);
  port.writable.getWriter = ((original) => () => {
    const writer = original();
    return { ...writer, write: () => new Promise<void>(() => undefined) }; // a write that never answers
  })(port.writable.getWriter);
  const transport = await openSerial(port);
  void transport.write(new Uint8Array(10)).catch(() => undefined);
  await Promise.resolve();
  await Promise.resolve();
  await transport.close();
  const tail = log.order.slice(log.order.indexOf("abort"));
  assert.deepEqual(tail, ["abort", "release", "close"]);
});

test("R2-W1: against a port that refuses close() while a writer holds it, close() frees the hung write and the port closes", async () => {
  const port = new PortFake();
  port.hangWrites = 1;
  const transport = await openSerial(port);
  const hung = transport.write(new Uint8Array(10)).then(() => "resolved", (e: Error) => e.message);
  await Promise.resolve();
  await Promise.resolve();
  assert.notEqual(port.held, null);
  await transport.close();
  assert.equal(await hung, "The write was aborted.");
  assert.equal(port.held, null);
  assert.equal(port.opened, false);
  assert.equal(port.closes, 1);
  await transport.close().catch(() => undefined); // closing twice never throws a lock error
  const again = await openSerial(port);
  await again.write(new Uint8Array(3));
  assert.deepEqual(port.delivered, [3], "the stream can be written again after the reopen");
});

// ---- POS app (native) -------------------------------------------------------------

function fakeClient(answer: (method: string, params: unknown) => unknown) {
  const calls: { method: string; params: unknown }[] = [];
  const client = {
    request: async (method: string, params?: unknown) => {
      calls.push({ method, params });
      return answer(method, params);
    },
    on: () => () => undefined,
  } as unknown as NativeClient;
  return { client, calls };
}

test("base64CharsFor matches the encoder and the cap boundary is exact", async () => {
  assert.equal(base64CharsFor(0), 0);
  assert.equal(base64CharsFor(1), 4);
  assert.equal(base64CharsFor(3), 4);
  assert.equal(base64CharsFor(4), 8);
  assert.equal(base64CharsFor(1_500_000), PRINT_DATA_MAX_BASE64_CHARS);
  assert.equal(base64CharsFor(1_500_001), PRINT_DATA_MAX_BASE64_CHARS + 4);
  const atCap = fakeClient((_m, params) => ({ bytes: 1_500_000, sent: (params as { data: string }).data.length }));
  await nativeWrite(atCap.client, new Uint8Array(1_500_000));
  assert.equal((atCap.calls[0].params as { data: string }).data.length, PRINT_DATA_MAX_BASE64_CHARS);
  const over = fakeClient(() => ({ bytes: 1_500_001 }));
  await assert.rejects(nativeWrite(over.client, new Uint8Array(1_500_001)), (e: unknown) => nativeErrorCode(e) === "TOO_LARGE" && (e as Error).message === PRINTER_TOO_LARGE_MESSAGE);
  assert.equal(over.calls.length, 0, "refused before encoding or sending anything");
});

test("nativeWrite sends printer.print with base64 data and treats a short byte count as a failed print", async () => {
  const ok = fakeClient(() => ({ bytes: 3 }));
  await nativeWrite(ok.client, Uint8Array.from([1, 2, 3]));
  assert.deepEqual(ok.calls, [{ method: "printer.print", params: { data: "AQID" } }]);
  const short = fakeClient(() => ({ bytes: 2 }));
  await assert.rejects(nativeWrite(short.client, Uint8Array.from([1, 2, 3])), (e: unknown) => nativeErrorCode(e) === "WRITE_FAILED");
});

test("nativeErrorMessage gives plain English per code and never echoes the app's text", () => {
  assert.equal(nativeErrorMessage(nativeError("NOT_CONNECTED", "raw")), PRINTER_NOT_CONNECTED_MESSAGE);
  assert.equal(nativeErrorMessage(nativeError("TOO_LARGE", "raw")), PRINTER_TOO_LARGE_MESSAGE);
  assert.equal(nativeErrorMessage(nativeError("BUSY", "raw")), NATIVE_BUSY_MESSAGE);
  assert.equal(nativeErrorMessage(nativeError("BLUETOOTH_OFF", "raw")), NATIVE_BLUETOOTH_OFF_MESSAGE);
  assert.equal(nativeErrorMessage(nativeError("UNAUTHORIZED", "raw")), NATIVE_BLUETOOTH_BLOCKED_MESSAGE);
  assert.equal(nativeErrorMessage(nativeError("LOCATION_OFF", "raw")), NATIVE_LOCATION_OFF_MESSAGE);
  assert.equal(NATIVE_LOCATION_OFF_MESSAGE, "Turn on Location so this tablet can find nearby printers.");
  for (const code of ["WRITE_FAILED", "TIMEOUT", "UNSUPPORTED", "BAD_REQUEST"] as const) {
    assert.equal(nativeErrorMessage(nativeError(code, "raw")), PRINTER_WRITE_FAILED_MESSAGE, code);
  }
  assert.equal(nativeErrorMessage(new Error("raw")), PRINTER_WRITE_FAILED_MESSAGE);
});

test("nativeStatusToSnapshot maps the app's status and keeps the page's paper size", () => {
  const printer = { id: "AA:BB", name: "Counter", transport: "bt-classic" as const };
  const connected: NativePrinterStatus = { state: "connected", printer, bluetooth: "on" };
  assert.deepEqual(nativeStatusToSnapshot(connected, { paper: "58mm" }), {
    status: "connected",
    printer: { kind: "native", name: "Counter", paper: "58mm", printerId: "AA:BB", transport: "bt-classic" },
    message: null,
  });
  assert.equal(nativeStatusToSnapshot(connected, null).printer?.paper, "80mm", "default when the page had none");
  assert.deepEqual(nativeStatusToSnapshot({ state: "none", printer: null, bluetooth: "on" }, null), { status: "none", printer: null, message: null });
  assert.equal(nativeStatusToSnapshot({ ...connected, state: "disconnected", bluetooth: "off" }, null).message, NATIVE_BLUETOOTH_OFF_MESSAGE);
  assert.equal(nativeStatusToSnapshot({ ...connected, state: "disconnected", bluetooth: "unauthorized" }, null).message, NATIVE_BLUETOOTH_BLOCKED_MESSAGE);
  assert.equal(nativeStatusToSnapshot({ ...connected, state: "connected", bluetooth: "off" }, null).message, null);
  const net = { ...connected, state: "disconnected" as const, printer: { id: "tcp", name: "10.0.0.5", transport: "tcp" as const }, bluetooth: "off" as const };
  assert.equal(nativeStatusToSnapshot(net, null).message, null, "Bluetooth being off says nothing about a network printer");
  assert.equal(nativeStatusToSnapshot({ ...connected, state: "connecting" }, null).status, "connecting");
});
