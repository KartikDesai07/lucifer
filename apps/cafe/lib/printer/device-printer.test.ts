import { test } from "node:test";
import assert from "node:assert/strict";

import { PortFake, SerialFake, flush } from "@/lib/printer/device-printer-fakes";
import { SERIAL_RECORD, makeEnv } from "@/lib/printer/device-printer-env";
import {
  DEVICE_WRITE_DEADLINE_MS,
  PRINTER_CHOOSE_AGAIN_MESSAGE,
  PRINTER_CONNECT_FAILED_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
  RECONNECT_BACKOFF_MS,
  RECONNECT_STEADY_MS,
  type PrinterStatus,
} from "@/lib/printer/device-printer";

// The serial lane of the device printer and the shared write pipeline, over
// fake ports and a manual clock (nothing sleeps).

async function connectedSerial(extra: { failOpen?: number } = {}) {
  const port = new PortFake();
  port.failOpen = extra.failOpen ?? 0;
  const serial = new SerialFake();
  serial.granted = [port];
  const env = makeEnv({ stored: SERIAL_RECORD, serial });
  env.printer.init();
  await flush();
  return Object.assign(env, { port, serial });
}

function statusLog(printer: { subscribe(l: () => void): () => void; getSnapshot(): { status: PrinterStatus } }): PrinterStatus[] {
  const seen: PrinterStatus[] = [];
  printer.subscribe(() => seen.push(printer.getSnapshot().status));
  return seen;
}

test("constants: backoff 2/5/10 s then 30 s steady, 70 s write deadline", () => {
  assert.deepEqual([...RECONNECT_BACKOFF_MS], [2_000, 5_000, 10_000]);
  assert.equal(RECONNECT_STEADY_MS, 30_000);
  assert.equal(DEVICE_WRITE_DEADLINE_MS, 70_000);
  assert.equal(PRINTER_CHOOSE_AGAIN_MESSAGE, "Tap Reconnect to choose this printer again.");
});

test("init: nothing saved reads none and opens nothing", async () => {
  const serial = new SerialFake();
  const env = makeEnv({ serial });
  env.printer.init();
  await flush();
  assert.deepEqual(env.printer.getSnapshot(), { status: "none", printer: null, message: null });
  assert.equal(serial.getPortsCalls, 0);
});

test("init: a saved serial printer with a granted match opens it at 9600 baud and reads connected", async () => {
  const { printer, port } = await connectedSerial();
  assert.equal(printer.getSnapshot().status, "connected");
  assert.deepEqual(printer.getSnapshot().printer, SERIAL_RECORD);
  assert.deepEqual(port.baud, [9600]);
  assert.equal(port.opens, 1);
});

test("init is idempotent: a second call neither re-asks for ownership nor reopens", async () => {
  const { printer, port, acquireCalls } = await connectedSerial();
  printer.init();
  await flush();
  assert.equal(acquireCalls, 1);
  assert.equal(port.opens, 1);
});

test("init: no granted match reads needs-tap, says what to do, and never starts a backoff", async () => {
  const serial = new SerialFake();
  const env = makeEnv({ stored: SERIAL_RECORD, serial });
  env.printer.init();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "needs-tap");
  assert.equal(env.printer.getSnapshot().message, PRINTER_CHOOSE_AGAIN_MESSAGE);
  assert.equal(env.clock.pending(), 0);
  assert.deepEqual(serial.lastRequest, undefined, "no chooser without a tap");
});

test("init: a granted port that will not open reads disconnected and retries at 2, 5, 10, then every 30 s", async () => {
  const { printer, port, clock } = await connectedSerial({ failOpen: Infinity });
  assert.equal(printer.getSnapshot().status, "disconnected");
  assert.equal(printer.getSnapshot().message, PRINTER_CONNECT_FAILED_MESSAGE);
  assert.equal(port.opens, 1);
  await clock.advance(1_999);
  assert.equal(port.opens, 1);
  await clock.advance(1);
  assert.equal(port.opens, 2, "first retry at 2 s");
  await clock.advance(4_999);
  assert.equal(port.opens, 2);
  await clock.advance(1);
  assert.equal(port.opens, 3, "second retry 5 s later");
  await clock.advance(10_000);
  assert.equal(port.opens, 4, "third retry 10 s later");
  await clock.advance(29_999);
  assert.equal(port.opens, 4);
  await clock.advance(1);
  assert.equal(port.opens, 5, "then steady 30 s");
  await clock.advance(30_000);
  assert.equal(port.opens, 6);
  port.failOpen = 0;
  await clock.advance(30_000);
  assert.equal(printer.getSnapshot().status, "connected");
  assert.equal(clock.pending(), 0, "connected: the backoff is gone");
});

test("a lost link (the port's disconnect event) reads disconnected and reconnects by itself", async () => {
  const { printer, port, clock } = await connectedSerial();
  const seen = statusLog(printer);
  port.drop();
  assert.equal(printer.getSnapshot().status, "disconnected");
  await clock.advance(2_000);
  assert.equal(printer.getSnapshot().status, "connected");
  assert.equal(port.opens, 2);
  assert.ok(seen.includes("disconnected") && seen[seen.length - 1] === "connected");
});

test("connectNew(serial): the chooser is the FIRST await, the other granted ports are forgotten, and the printer is saved", async () => {
  const stale = new PortFake({ bluetoothServiceClassId: 0x1101 });
  const other = new PortFake({ usbVendorId: 1, usbProductId: 2 });
  const chosen = new PortFake({ bluetoothServiceClassId: 0x1101 });
  const serial = new SerialFake();
  serial.granted = [stale, other];
  serial.chooser = chosen;
  const env = makeEnv({ serial });
  env.printer.init();
  await flush();
  const pending = env.printer.connectNew("serial", "58mm");
  assert.equal(serial.requestCalls, 1, "requestPort ran synchronously inside the call");
  assert.equal(serial.getPortsCalls, 0, "nothing awaited before the chooser");
  assert.deepEqual(serial.lastRequest, { allowedBluetoothServiceClassIds: ["00001101-0000-1000-8000-00805f9b34fb"] });
  assert.equal(await pending, "connected");
  assert.deepEqual([stale.forgets, other.forgets, chosen.forgets], [1, 1, 0]);
  assert.equal(env.printer.getSnapshot().status, "connected");
  assert.deepEqual(env.store.value, { kind: "serial", name: "Bluetooth printer", paper: "58mm", bluetoothServiceClassId: "00001101-0000-1000-8000-00805f9b34fb" });
  assert.deepEqual(env.printer.getSnapshot().printer, env.store.value);
});

test("connectNew: a cancelled chooser restores everything silently; a hard chooser error is just a failure", async () => {
  const { printer, serial, store, clock } = await connectedSerial();
  const before = printer.getSnapshot();
  const writesBefore = store.writes;
  serial.chooser = Object.assign(new Error("closed"), { name: "NotFoundError" });
  assert.equal(await printer.connectNew("serial", "80mm"), "cancelled");
  serial.chooser = Object.assign(new Error("dismissed"), { name: "AbortError" });
  assert.equal(await printer.connectNew("serial", "80mm"), "cancelled");
  serial.chooser = Object.assign(new Error("no activation"), { name: "SecurityError" });
  assert.equal(await printer.connectNew("serial", "80mm"), "failed");
  assert.equal(printer.getSnapshot(), before, "the very same snapshot object: nothing was touched");
  assert.equal(store.writes, writesBefore);
  assert.equal(clock.pending(), 0);
});

test("connectNew: a chosen port that will not open keeps the old printer, says so, and retries it", async () => {
  const { printer, serial, store, port } = await connectedSerial();
  const bad = new PortFake({ bluetoothServiceClassId: 0x1101 });
  bad.failOpen = Infinity;
  serial.chooser = bad;
  assert.equal(await printer.connectNew("serial", "58mm"), "failed");
  assert.deepEqual(store.value, SERIAL_RECORD, "the saved printer is unchanged");
  assert.equal(printer.getSnapshot().status, "disconnected");
  assert.equal(printer.getSnapshot().message, PRINTER_CONNECT_FAILED_MESSAGE);
  assert.ok(port.closes >= 1);
});

test("reconnect() with nothing granted any more falls through to the chooser (a tap)", async () => {
  const serial = new SerialFake();
  const env = makeEnv({ stored: SERIAL_RECORD, serial });
  env.printer.init();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "needs-tap");
  serial.chooser = new PortFake();
  assert.equal(await env.printer.reconnect(), "connected");
  assert.equal(serial.requestCalls, 1);
});

test("write: a job goes out in 2048-byte chunks, awaiting ready before each", async () => {
  const { printer, port } = await connectedSerial();
  await printer.write(new Uint8Array(5000));
  assert.deepEqual(port.delivered, [2048, 2048, 904]);
  assert.equal(port.readyCount, 3);
});

test("write: an uncertain send is not replayed and reports disconnected", async () => {
  const { printer, port } = await connectedSerial();
  const seen = statusLog(printer);
  port.failWrites = 1;
  await assert.rejects(printer.write(new Uint8Array(3000)), { message: PRINTER_WRITE_FAILED_MESSAGE });
  assert.deepEqual(port.delivered, []);
  assert.equal(port.writeAttempts, 1, "no automatic replay");
  assert.equal(port.opens, 1);
  assert.equal(seen[seen.length - 1], "disconnected");
});

test("write: repeated transport failure sends only once and arms reconnect for future jobs", async () => {
  const { printer, port, clock } = await connectedSerial();
  port.failWrites = 99;
  await assert.rejects(printer.write(new Uint8Array(100)), (e: unknown) => (e as Error).message === PRINTER_WRITE_FAILED_MESSAGE);
  assert.equal(port.writeAttempts, 1, "uncertain delivery is never replayed");
  assert.equal(printer.getSnapshot().status, "disconnected");
  assert.equal(clock.pending(), 1, "the reconnect backoff is armed");
});

test("write: a failure after the first chunk does not duplicate it; the next job reconnects", async () => {
  const { printer, port } = await connectedSerial();
  let rejectChunk!: (error: Error) => void;
  port.gates.push(Promise.resolve(), new Promise<void>((_resolve, reject) => { rejectChunk = reject; }));
  const result = assert.rejects(printer.write(new Uint8Array(3000)), { message: PRINTER_WRITE_FAILED_MESSAGE });
  await flush();
  assert.deepEqual(port.delivered, [2048], "the printer has already received part of this slip");
  rejectChunk(new Error("cable removed"));
  await result;
  assert.equal(port.writeAttempts, 2, "the first chunk must not be replayed");
  await printer.write(new Uint8Array(20));
  assert.deepEqual(port.delivered, [2048, 20], "only the new job is sent after reconnect");
});

test("write: when the reconnect itself fails the job is not sent and the sentence says so", async () => {
  const { printer, port } = await connectedSerial();
  port.drop();
  port.failOpen = Infinity;
  await assert.rejects(printer.write(new Uint8Array(10)), (e: unknown) => (e as Error).message === PRINTER_NOT_CONNECTED_MESSAGE);
  assert.equal(port.writeAttempts, 0);
});

test("write: jobs are FIFO and never interleave", async () => {
  const { printer, port } = await connectedSerial();
  let release: () => void = () => undefined;
  port.gates.push(new Promise<void>((resolve) => (release = resolve)));
  const first = printer.write(new Uint8Array(10));
  const second = printer.write(new Uint8Array(20));
  await flush();
  assert.equal(port.writeAttempts, 1, "the second job has not started while the first is in flight");
  release();
  await Promise.all([first, second]);
  assert.deepEqual(port.delivered, [10, 20]);
});

test("write: the deadline fails a hung job at 70 s and the queue moves on to the next one", async () => {
  const { printer, port, clock } = await connectedSerial();
  port.hangWrites = 1;
  const hung = printer.write(new Uint8Array(10));
  const next = printer.write(new Uint8Array(20));
  const hungOutcome = hung.then(() => "resolved", (e: Error) => e.message);
  await flush();
  await clock.advance(DEVICE_WRITE_DEADLINE_MS - 1);
  assert.equal(port.delivered.length, 0);
  await clock.advance(1);
  assert.equal(await hungOutcome, PRINTER_WRITE_FAILED_MESSAGE);
  await next;
  assert.deepEqual(port.delivered, [20]);
});

test("write with no printer saved rejects with the not-connected sentence", async () => {
  const env = makeEnv({ serial: new SerialFake() });
  env.printer.init();
  await flush();
  await assert.rejects(env.printer.write(new Uint8Array(1)), (e: unknown) => (e as Error).message === PRINTER_NOT_CONNECTED_MESSAGE);
});

test("setPaper saves the new size and keeps the connection", async () => {
  const { printer, store } = await connectedSerial();
  printer.setPaper("58mm");
  assert.equal(printer.getSnapshot().status, "connected");
  assert.equal(printer.getSnapshot().printer?.paper, "58mm");
  assert.equal(store.value?.paper, "58mm");
});

test("forget closes the link, gives the permission back, clears the record and every timer", async () => {
  const { printer, port, store, clock } = await connectedSerial();
  await printer.forget();
  assert.equal(port.closes, 1);
  assert.equal(port.forgets, 1);
  assert.equal(store.value, null);
  assert.deepEqual(printer.getSnapshot(), { status: "none", printer: null, message: null });
  assert.equal(clock.pending(), 0);
});

test("forget during a backoff stops the retries for good", async () => {
  const { printer, port, clock } = await connectedSerial({ failOpen: Infinity });
  assert.equal(clock.pending(), 1);
  await printer.forget();
  assert.equal(clock.pending(), 0);
  const opens = port.opens;
  await clock.advance(120_000);
  assert.equal(port.opens, opens);
});

test("a forgotten printer is not resurrected by an open that was still in flight", async () => {
  const port = new PortFake();
  const serial = new SerialFake();
  serial.granted = [port];
  let finishOpen: () => void = () => undefined;
  port.open = (options) => new Promise<void>((resolve) => {
    finishOpen = () => {
      port.opened = true;
      port.baud.push(options.baudRate);
      resolve();
    };
  });
  const env = makeEnv({ stored: SERIAL_RECORD, serial });
  env.printer.init();
  await flush();
  const forgetting = env.printer.forget();
  await flush();
  finishOpen();
  await forgetting;
  await flush();
  assert.equal(env.printer.getSnapshot().status, "none");
  assert.equal(env.store.value, null);
});

test("write: a port that is no longer writable is refused before any byte: one reconnect and ONE resend", async () => {
  const { printer, port } = await connectedSerial();
  // The OS closed the port underneath us and no disconnect event fired: the panel still says connected.
  port.opened = false;
  await printer.write(new Uint8Array(100));
  assert.deepEqual(port.delivered, [100], "the resend delivered the whole job exactly once");
  assert.equal(port.opens, 2, "one silent reconnect");
  assert.equal(printer.getSnapshot().status, "connected");
});

test("write: a refusal whose reconnect fails says the printer is not connected, because nothing printed", async () => {
  const { printer, port } = await connectedSerial();
  port.opened = false;
  port.failOpen = 99;
  await assert.rejects(printer.write(new Uint8Array(10)), { message: PRINTER_NOT_CONNECTED_MESSAGE });
  assert.deepEqual(port.delivered, []);
});
