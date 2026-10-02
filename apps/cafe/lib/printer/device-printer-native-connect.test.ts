import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { NATIVE_RECORD, makeEnv, nativeFake, nativeStatus } from "@/lib/printer/device-printer-env";
import { flush } from "@/lib/printer/device-printer-fakes";
import { PRINTER_CONNECT_FAILED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/device-printer";
import { NATIVE_CONNECT_TIMEOUT_MS, nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_BLUETOOTH_OFF_MESSAGE } from "@/lib/printer/transport-native";

// App lane connect: a select/reconnect that times out says "could not connect"
// (not the print sentence), keeps the paper the operator asked for until the
// app's late status arrives, and the web timeout outlasts the app's own worst case.

async function emptyNative() {
  const native = nativeFake();
  native.respond("printer.status", () => nativeStatus("none", null));
  const env = makeEnv({ native });
  env.printer.init();
  await flush();
  return Object.assign(env, { fake: native });
}

test("W-Y: a select that times out reads as a connect failure, not the print sentence", async () => {
  const { printer, fake } = await emptyNative();
  fake.respond("printer.select", () => {
    throw nativeError("TIMEOUT", "x");
  });
  assert.equal(await printer.selectNative({ id: "AA:BB" }, "58mm"), "failed");
  assert.equal(printer.getSnapshot().message, PRINTER_CONNECT_FAILED_MESSAGE);
  assert.notEqual(printer.getSnapshot().message, PRINTER_WRITE_FAILED_MESSAGE);
});

test("W-Y: a reconnect that times out reads as a connect failure too", async () => {
  const native = nativeFake();
  native.respond("printer.status", () => nativeStatus("disconnected"));
  const env = makeEnv({ stored: NATIVE_RECORD, native });
  env.printer.init();
  await flush();
  native.respond("printer.reconnect", () => {
    throw nativeError("TIMEOUT", "x");
  });
  assert.equal(await env.printer.reconnect(), "failed");
  assert.equal(env.printer.getSnapshot().message, PRINTER_CONNECT_FAILED_MESSAGE);
});

test("W-Y: the paper asked for survives a select that timed out — the late status saves 58mm, not the 80mm default", async () => {
  const { printer, store, fake } = await emptyNative();
  fake.respond("printer.select", () => {
    throw nativeError("TIMEOUT", "x");
  });
  await printer.selectNative({ id: "AA:BB" }, "58mm");
  // `as unknown`: the assertion signatures would otherwise narrow store.value (null, then never) for the reads below
  assert.equal(store.value as unknown, null, "nothing saved yet");
  fake.emit(nativeStatus("connected")); // the app finished connecting after the page gave up
  assert.deepEqual(store.value as unknown, NATIVE_RECORD, "58mm, from the original request");
  assert.equal(printer.getSnapshot().printer?.paper, "58mm");
  printer.setPaper("80mm"); // a later change by hand is not undone by the next status
  fake.emit(nativeStatus("connected"));
  assert.equal(store.value?.paper, "80mm");
});

test("W-Y: a tcp request is remembered under the id the app will report (tcp:host:port)", async () => {
  const { printer, store, fake } = await emptyNative();
  fake.respond("printer.select", () => {
    throw nativeError("TIMEOUT", "x");
  });
  await printer.selectNative({ tcp: { host: "192.168.1.50", port: 9100 } }, "58mm");
  fake.emit(nativeStatus("connected", { id: "tcp:192.168.1.50:9100", name: "Kitchen", transport: "tcp" }));
  assert.equal(store.value?.paper, "58mm");
});

test("W-Y: a refused select (not a timeout) does not leave its paper behind for a later status", async () => {
  const { printer, store, fake } = await emptyNative();
  fake.respond("printer.select", () => {
    throw nativeError("BLUETOOTH_OFF", "x");
  });
  await printer.selectNative({ id: "AA:BB" }, "58mm");
  assert.equal(printer.getSnapshot().message, NATIVE_BLUETOOTH_OFF_MESSAGE);
  fake.emit(nativeStatus("connected"));
  assert.equal(store.value?.paper, "80mm", "the default, because nothing remembered the refused request");
});

// ---- the cross-app pin: the web timeout outlasts the Kotlin side's worst case ----

const KT_DIR = path.join(__dirname, "..", "..", "..", "mobile", "android", "app", "src", "main", "java", "com", "possoftware", "pos", "printer");
const readKt = (file: string): string => readFileSync(path.join(KT_DIR, file), "utf8");

function kotlinMs(source: string, name: string): number {
  const found = new RegExp(`const val \w*${name} = ([0-9_]+)L?`).exec(source);
  if (found === null) throw new Error(`Kotlin constant ${name} not found`);
  return Number(found[1].replace(/_/g, ""));
}

// Classic connects twice (secure, then the insecure retry), each up to the pairing limit.
const CLASSIC_ATTEMPTS = 2;

function checkConnectTimeout(webMs: number, classic: string, usb: string): void {
  const worst = CLASSIC_ATTEMPTS * kotlinMs(classic, "PAIRING_CONNECT_TIMEOUT_MS");
  const prompt = kotlinMs(usb, "PERMISSION_TIMEOUT_MS");
  assert.ok(webMs > worst, `web connect timeout ${webMs} must exceed 2 x Classic pairing ${worst}`);
  assert.ok(webMs > prompt, `web connect timeout ${webMs} must exceed the USB permission wait ${prompt}`);
}

test("pin: NATIVE_CONNECT_TIMEOUT_MS exceeds 2 x the Classic pairing limit and the USB permission wait (Kotlin read as text)", () => {
  const classic = readKt("ClassicTransport.kt");
  const usb = readKt("UsbTransport.kt");
  checkConnectTimeout(NATIVE_CONNECT_TIMEOUT_MS, classic, usb);
  assert.equal(NATIVE_CONNECT_TIMEOUT_MS, 75_000);
});

test("pin mutation: the checker fails when either Kotlin limit rises past the web timeout or a constant disappears", () => {
  const classic = readKt("ClassicTransport.kt");
  const usb = readKt("UsbTransport.kt");
  const raise = (source: string, name: string, to: number): string => {
    const mutated = source.replace(new RegExp(`(const val \w*${name} = )[0-9_]+`), `$1${to}`);
    assert.notEqual(mutated, source, `anchor for ${name}`);
    return mutated;
  };
  assert.throws(() => checkConnectTimeout(NATIVE_CONNECT_TIMEOUT_MS, raise(classic, "PAIRING_CONNECT_TIMEOUT_MS", 40_000), usb), /Classic pairing/);
  assert.throws(() => checkConnectTimeout(NATIVE_CONNECT_TIMEOUT_MS, classic, raise(usb, "PERMISSION_TIMEOUT_MS", 90_000)), /USB permission/);
  assert.throws(() => checkConnectTimeout(45_000, classic, usb), /Classic pairing/, "the old 45 s value fails the pin");
  assert.throws(() => kotlinMs("", "PAIRING_CONNECT_TIMEOUT_MS"), /not found/);
});
