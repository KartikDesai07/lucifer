import { test } from "node:test";
import assert from "node:assert/strict";

import { BLE_RECORD, NATIVE_RECORD, SERIAL_RECORD, makeEnv, nativeFake, nativeStatus } from "@/lib/printer/device-printer-env";
import { BleFake, PortFake, SerialFake, bluetoothOf, flush } from "@/lib/printer/device-printer-fakes";
import {
  PRINTER_CHOOSE_AGAIN_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
} from "@/lib/printer/device-printer";
import { createWebLink } from "@/lib/printer/device-printer-link";
import { makeClock } from "@/lib/printer/device-printer-fakes";
import { nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_BLUETOOTH_OFF_MESSAGE } from "@/lib/printer/transport-native";

// The two other lanes of the device printer: BLE (in-session auto-reconnect,
// needs a tap after a reload) and the POS app (the Kotlin side owns the link:
// no web reconnect loop, one silent reconnect on a failed write).

async function nativeEnv(opts: { stored?: typeof NATIVE_RECORD | null; status?: unknown } = {}) {
  const native = nativeFake();
  native.respond("printer.status", () => opts.status ?? nativeStatus("connected"));
  const env = makeEnv({ stored: opts.stored === undefined ? NATIVE_RECORD : opts.stored, native });
  env.printer.init();
  await flush();
  return Object.assign(env, { fake: native });
}

// ---- BLE -------------------------------------------------------------------------------

test("BLE: connectNew saves the device and pair; a dropped link reconnects at 2 s then 5 s with no tap", async () => {
  const ble = new BleFake();
  const api = bluetoothOf(ble, false);
  const env = makeEnv({ bluetooth: api });
  env.printer.init();
  await flush();
  const pending = env.printer.connectNew("ble", "58mm");
  assert.equal(api.requestCalls, 1, "the chooser ran synchronously inside the call");
  assert.equal(await pending, "connected");
  assert.deepEqual(env.store.value, BLE_RECORD);
  ble.failConnect = 1;
  const callsBefore = ble.connectCalls;
  ble.drop();
  assert.equal(env.printer.getSnapshot().status, "disconnected");
  await env.clock.advance(1_999);
  assert.equal(ble.connectCalls, callsBefore);
  await env.clock.advance(1);
  assert.equal(ble.connectCalls, callsBefore + 1, "retry at 2 s (out of range)");
  assert.equal(env.printer.getSnapshot().status, "disconnected");
  await env.clock.advance(5_000);
  assert.equal(env.printer.getSnapshot().status, "connected", "retry 5 s later");
  assert.equal(env.clock.pending(), 0);
  const writing = env.printer.write(new Uint8Array(400));
  await flush();
  assert.deepEqual(ble.writes, [180], "then a 20 ms pause");
  await env.clock.advance(20);
  assert.deepEqual(ble.writes, [180, 180]);
  await env.clock.advance(20);
  await writing;
  assert.deepEqual(ble.writes, [180, 180, 40]);
});

test("BLE: after a reload with no getDevices the saved printer needs a tap and nothing retries", async () => {
  const ble = new BleFake();
  const env = makeEnv({ stored: BLE_RECORD, bluetooth: bluetoothOf(ble, false) });
  env.printer.init();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "needs-tap");
  assert.equal(env.printer.getSnapshot().message, PRINTER_CHOOSE_AGAIN_MESSAGE);
  assert.equal(env.clock.pending(), 0);
  assert.equal(ble.connectCalls, 0);
});

test("BLE: when getDevices exists the saved device is found and reconnected without a tap", async () => {
  const ble = new BleFake();
  const env = makeEnv({ stored: BLE_RECORD, bluetooth: bluetoothOf(ble, true) });
  env.printer.init();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "connected");
});

test("BLE: a getDevices that throws reads as needs-tap, not as an error", async () => {
  const ble = new BleFake();
  const api = bluetoothOf(ble, true);
  api.getDevices = async () => Promise.reject(new Error("flag off"));
  const env = makeEnv({ stored: BLE_RECORD, bluetooth: api });
  env.printer.init();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "needs-tap");
});

test("BLE: reconnect() on needs-tap goes through the chooser (the tap) and forget releases the device", async () => {
  const ble = new BleFake();
  const api = bluetoothOf(ble, false);
  const env = makeEnv({ stored: BLE_RECORD, bluetooth: api });
  env.printer.init();
  await flush();
  assert.equal(await env.printer.reconnect(), "connected");
  assert.equal(api.requestCalls, 1);
  let forgotten = 0;
  (ble.device as { forget?: () => Promise<void> }).forget = async () => void (forgotten += 1);
  await env.printer.forget();
  assert.equal(forgotten, 1);
  assert.equal(env.store.value, null);
  assert.equal(ble.connected, false);
});

test("switching from a serial printer to a BLE one closes the old link first", async () => {
  const port = new PortFake();
  const serial = new SerialFake();
  serial.granted = [port];
  const ble = new BleFake();
  const env = makeEnv({ stored: SERIAL_RECORD, serial, bluetooth: bluetoothOf(ble, false) });
  env.printer.init();
  await flush();
  assert.equal(await env.printer.connectNew("ble", "58mm"), "connected");
  assert.equal(port.closes, 1);
  assert.equal(env.store.value?.kind, "ble");
});

// ---- POS app (native) --------------------------------------------------------------------

test("native: init asks the app for its status, mirrors it, and keeps the page's saved paper size", async () => {
  const { printer, store, fake } = await nativeEnv();
  assert.equal(printer.getSnapshot().status, "connected");
  assert.deepEqual(printer.getSnapshot().printer, NATIVE_RECORD, "58mm kept, not the 80mm default");
  assert.equal(store.writes, 0, "an identical record is not rewritten");
  assert.equal(fake.listeners.size, 1, "subscribed to status events");
});

test("native: the app's status events drive the snapshot; there is NO web reconnect loop", async () => {
  const { printer, fake, clock } = await nativeEnv();
  fake.emit(nativeStatus("disconnected", undefined, "off"));
  assert.equal(printer.getSnapshot().status, "disconnected");
  assert.equal(printer.getSnapshot().message, NATIVE_BLUETOOTH_OFF_MESSAGE);
  assert.equal(clock.pending(), 0);
  await clock.advance(120_000);
  assert.equal(fake.count("printer.reconnect"), 0);
  fake.emit(nativeStatus("connected"));
  assert.equal(printer.getSnapshot().status, "connected");
  assert.equal(printer.getSnapshot().message, null);
});

test("native: an app printer chosen elsewhere is adopted into the saved record; 'none' clears a native record but not a web one", async () => {
  const adopt = await nativeEnv({ stored: null });
  assert.equal(adopt.store.value?.kind, "native");
  assert.equal(adopt.store.value?.paper, "80mm");
  adopt.fake.emit(nativeStatus("none", null));
  assert.equal(adopt.store.value, null);
  assert.equal(adopt.printer.getSnapshot().status, "none");

  const native = nativeFake();
  native.respond("printer.status", () => nativeStatus("none", null));
  const web = makeEnv({ stored: SERIAL_RECORD, native, serial: new SerialFake() });
  web.printer.init();
  await flush();
  assert.deepEqual(web.store.value, SERIAL_RECORD, "a web printer is untouched by an app that has none");
});

test("native: a LATE bridge — saved printer reads disconnected, then the ready event runs the init once", async () => {
  const env = makeEnv({ stored: NATIVE_RECORD });
  env.printer.init();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "disconnected");
  const fake = nativeFake();
  fake.respond("printer.status", () => nativeStatus("connected"));
  env.native = fake;
  env.ready();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "connected");
  assert.equal(fake.count("printer.status"), 1);
  env.ready();
  await flush();
  assert.equal(fake.listeners.size, 1, "re-running the init does not stack subscriptions");
});

test("native: a status request that fails leaves a saved printer disconnected, not stuck connecting", async () => {
  const native = nativeFake();
  native.respond("printer.status", () => Promise.reject(nativeError("TIMEOUT", "x")));
  const env = makeEnv({ stored: NATIVE_RECORD, native });
  env.printer.init();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "disconnected");
  assert.equal(env.printer.getSnapshot().message, PRINTER_NOT_CONNECTED_MESSAGE);
});

test("native write: a pre-write NOT_CONNECTED refusal allows ONE reconnect and resend", async () => {
  const { printer, fake } = await nativeEnv();
  let prints = 0;
  fake.respond("printer.print", () => {
    prints += 1;
    if (prints === 1) throw nativeError("NOT_CONNECTED", "x");
    return { bytes: 4 };
  });
  fake.respond("printer.reconnect", () => nativeStatus("connected"));
  await printer.write(new Uint8Array(4));
  assert.deepEqual(fake.calls.filter((c) => c.method !== "printer.status").map((c) => c.method), ["printer.print", "printer.reconnect", "printer.print"]);
});

test("native write: a partial WRITE_FAILED is never replayed", async () => {
  const { printer, fake } = await nativeEnv();
  fake.respond("printer.print", () => {
    throw nativeError("WRITE_FAILED", "x");
  });
  fake.respond("printer.reconnect", () => nativeStatus("connected"));
  await assert.rejects(printer.write(new Uint8Array(4)), (e: unknown) => (e as Error).message === PRINTER_WRITE_FAILED_MESSAGE);
  assert.equal(fake.count("printer.print"), 1);
  assert.equal(fake.count("printer.reconnect"), 0);
});

test("native write: a TIMEOUT is never resent (the app may still be printing) and does not reconnect", async () => {
  const { printer, fake } = await nativeEnv();
  fake.respond("printer.print", () => {
    throw nativeError("TIMEOUT", "x");
  });
  await assert.rejects(printer.write(new Uint8Array(4)), (e: unknown) => (e as Error).message === PRINTER_WRITE_FAILED_MESSAGE);
  assert.equal(fake.count("printer.print"), 1);
  assert.equal(fake.count("printer.reconnect"), 0);
});

test("native write: an explained refusal (Bluetooth off) is reported as that, once, without a reconnect", async () => {
  const { printer, fake } = await nativeEnv();
  fake.respond("printer.print", () => {
    throw nativeError("BLUETOOTH_OFF", "x");
  });
  await assert.rejects(printer.write(new Uint8Array(4)), (e: unknown) => (e as Error).message === NATIVE_BLUETOOTH_OFF_MESSAGE);
  assert.equal(fake.count("printer.print"), 1);
  assert.equal(fake.count("printer.reconnect"), 0);
});

test("native write: not connected -> one silent printer.reconnect first, then the print; still down -> not-connected sentence", async () => {
  const { printer, fake } = await nativeEnv({ status: nativeStatus("disconnected") });
  fake.respond("printer.reconnect", () => nativeStatus("connected"));
  fake.respond("printer.print", () => ({ bytes: 2 }));
  await printer.write(new Uint8Array(2));
  assert.equal(fake.count("printer.reconnect"), 1);
  assert.equal(fake.count("printer.print"), 1);

  const down = await nativeEnv({ status: nativeStatus("disconnected") });
  down.fake.respond("printer.reconnect", () => nativeStatus("disconnected"));
  await assert.rejects(down.printer.write(new Uint8Array(2)), (e: unknown) => (e as Error).message === PRINTER_NOT_CONNECTED_MESSAGE);
  assert.equal(down.fake.count("printer.print"), 0);
});

test("native: selectNative sends the target, saves the record with the paper the page chose", async () => {
  const { printer, store, fake } = await nativeEnv({ stored: null, status: nativeStatus("none", null) });
  fake.respond("printer.select", () => nativeStatus("connected"));
  assert.equal(await printer.selectNative({ id: "AA:BB" }, "58mm"), "connected");
  assert.deepEqual(fake.calls.find((c) => c.method === "printer.select")?.params, { id: "AA:BB" });
  assert.deepEqual(store.value, NATIVE_RECORD);
  fake.respond("printer.select", () => {
    throw nativeError("BLUETOOTH_OFF", "x");
  });
  assert.equal(await printer.selectNative({ tcp: { host: "10.0.0.5", port: 9100 } }, "80mm"), "failed");
  assert.equal(printer.getSnapshot().message, NATIVE_BLUETOOTH_OFF_MESSAGE);
});

test("native: listNative forwards the scan flag, and is empty without the app", async () => {
  const { printer, fake } = await nativeEnv();
  fake.respond("printer.list", () => ({ printers: [{ id: "AA:BB", name: "Counter", transport: "bt-classic" }] }));
  assert.equal((await printer.listNative(true)).length, 1);
  assert.deepEqual(fake.calls.find((c) => c.method === "printer.list")?.params, { scan: true });
  const bare = makeEnv();
  bare.printer.init();
  assert.deepEqual(await bare.printer.listNative(false), []);
});

test("native: forget tells the app, clears the record, and Reconnect asks the app (not a browser chooser)", async () => {
  const { printer, store, fake } = await nativeEnv();
  fake.respond("printer.reconnect", () => nativeStatus("connected"));
  assert.equal(await printer.reconnect(), "connected");
  fake.respond("printer.forget", () => nativeStatus("none", null));
  await printer.forget();
  assert.equal(fake.count("printer.forget"), 1);
  assert.equal(store.value, null);
  assert.equal(printer.getSnapshot().status, "none");
});

// The 2F1 review gate (G-2, seen on the emulator with Session 2F2's app): an app on bridge v2 makes the first of its
// other printers the default when this device's printer leaves it (the contract's promotion), and answers the forget
// with that printer's status. The page keeps it as this device's printer, whichever of the answer and the app's own
// status event lands first; an app with no other printer answers "none" and the record is cleared as before.
test("2F1 gate (G-2): forget on an app that makes another of its printers the default keeps that one as this device's", async () => {
  const { printer, store, fake } = await nativeEnv();
  const promoted = { id: "tcp:10.0.2.2:9100", name: "Network printer 10.0.2.2", transport: "tcp", address: "10.0.2.2:9100" };
  fake.respond("printer.forget", () => nativeStatus("connected", promoted));
  await printer.forget();
  assert.equal(fake.count("printer.forget"), 1, "the app was told");
  assert.equal(store.value?.kind === "native" ? store.value.printerId : null, promoted.id, "the promoted printer is this device's printer");
  assert.equal(printer.getSnapshot().status, "connected", "and it reads as the app reports it");
  fake.respond("printer.forget", () => nativeStatus("none", null));
  await printer.forget();
  assert.equal(store.value, null, "the last printer gone: no printer, as before");
  assert.equal(printer.getSnapshot().status, "none");
});

// The 2F2 review gate (m-5, m-1): on the device the app's status event comes first, then the forget's answer
// (PrinterPool.change() posts the event before PrinterApi answers); the page keeps the promoted printer either way,
// writes it once, and at the default paper: the removed printer's paper is not its paper.
test("2F2 gate (m-5, m-1): the promoted printer is kept whichever of the app's event and the forget's answer lands first, written once, at the default paper", async () => {
  const promoted = { id: "tcp:10.0.2.2:9100", name: "Network printer 10.0.2.2", transport: "tcp", address: "10.0.2.2:9100" };
  for (const eventFirst of [true, false]) {
    const { printer, store, fake } = await nativeEnv();
    const order = eventFirst ? "event first" : "answer first";
    const writes = store.writes;
    fake.respond("printer.forget", () => {
      if (eventFirst) fake.emit(nativeStatus("connected", promoted));
      return nativeStatus("connected", promoted);
    });
    await printer.forget();
    if (!eventFirst) fake.emit(nativeStatus("connected", promoted));
    assert.equal(store.value?.kind === "native" ? store.value.printerId : null, promoted.id, `${order}: the promoted printer is this device's printer`);
    assert.equal(store.value?.paper, "80mm", `${order}: the default paper, not the removed printer's 58mm`);
    assert.equal(store.writes - writes, 1, `${order}: the record is written once`);
    assert.equal(printer.getSnapshot().status, "connected", `${order}: it reads as the app reports it`);
  }
});

test("2F2 gate (m-1): a status naming the saved printer keeps its paper; one naming another printer does not take it", async () => {
  const { printer, store, fake } = await nativeEnv();
  fake.emit(nativeStatus("disconnected"));
  assert.equal(store.value?.paper, "58mm", "the same printer keeps the paper the page chose");
  fake.emit(nativeStatus("connected", { id: "AA:CC", name: "Other", transport: "bt-classic", address: "AA:CC" }));
  assert.equal(store.value?.paper, "80mm", "another printer starts at the default paper");
  assert.equal(printer.getSnapshot().printer?.paper, "80mm", "and the panel shows it");
});

test("the web reconnect backoff refuses to start for an app printer, even if asked (Kotlin owns that loop)", () => {
  const clock = makeClock();
  const link = createWebLink({
    deps: { serial: () => null, bluetooth: () => null, setTimer: clock.setTimer, clearTimer: clock.clearTimer, writeStore: () => undefined },
    snapshot: () => ({ status: "disconnected", printer: NATIVE_RECORD, message: null }),
    publish: () => undefined,
    isOwner: () => true,
  });
  link.schedule();
  assert.equal(clock.pending(), 0);
  const web = createWebLink({
    deps: { serial: () => null, bluetooth: () => null, setTimer: clock.setTimer, clearTimer: clock.clearTimer, writeStore: () => undefined },
    snapshot: () => ({ status: "disconnected", printer: SERIAL_RECORD, message: null }),
    publish: () => undefined,
    isOwner: () => true,
  });
  web.schedule();
  assert.equal(clock.pending(), 1, "landmark: the same call DOES arm a timer for a web printer");
});

test("native write: a NOT_CONNECTED refusal whose reconnect fails says not connected, because nothing printed", async () => {
  const { printer, fake } = await nativeEnv();
  fake.respond("printer.print", () => {
    throw nativeError("NOT_CONNECTED", "x");
  });
  fake.respond("printer.reconnect", () => nativeStatus("disconnected"));
  await assert.rejects(printer.write(new Uint8Array(4)), { message: PRINTER_NOT_CONNECTED_MESSAGE });
  assert.equal(fake.count("printer.print"), 1, "no resend without a link");
});
