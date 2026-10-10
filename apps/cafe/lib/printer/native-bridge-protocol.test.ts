import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import * as protocol from "@/lib/printer/native-bridge-protocol";

// ---- the protocol file ------------------------------------------------------

test("protocol: every list and scalar is exactly the contract (the Android file mirrors these)", () => {
  assert.deepEqual([...protocol.NATIVE_METHODS], ["app.info", "printer.status", "printer.list", "printer.select", "printer.reconnect", "printer.forget", "printer.print", "permissions.request", "bluetooth.enable", "host.background", "app.changeUrl", "app.battery"]);
  assert.deepEqual([...protocol.NATIVE_EVENTS], ["printer.status", "app.wake"]);
  assert.deepEqual([...protocol.NATIVE_TRANSPORTS], ["bt-classic", "ble", "tcp", "usb"]);
  assert.deepEqual([...protocol.NATIVE_PRINTER_STATES], ["none", "connecting", "connected", "disconnected"]);
  assert.deepEqual([...protocol.NATIVE_BLUETOOTH_STATES], ["on", "off", "unauthorized", "unsupported"]);
  assert.deepEqual([...protocol.NATIVE_ERROR_CODES], ["NOT_CONNECTED", "WRITE_FAILED", "TOO_LARGE", "BUSY", "TIMEOUT", "UNAUTHORIZED", "BLUETOOTH_OFF", "UNSUPPORTED", "BAD_REQUEST", "LOCATION_OFF"]);
  assert.deepEqual([...protocol.NATIVE_PERMISSION_KINDS], ["bluetooth", "notifications"]);
  assert.deepEqual([...protocol.NATIVE_PLATFORMS], ["android", "ios"]);
  assert.deepEqual([...protocol.NATIVE_FEATURES], ["battery"]);
  assert.equal(protocol.NATIVE_BRIDGE_VERSION, 1);
  assert.equal(protocol.PRINTER_SCAN_MS, 8_000);
  assert.equal(protocol.PRINT_DATA_MAX_BASE64_CHARS, 2_000_000);
  assert.equal(protocol.BRIDGE_MESSAGE_MAX_CHARS, 2_100_000);
  assert.equal(protocol.NATIVE_APP_ID, "pos-mobile");
  assert.equal(protocol.NATIVE_GLOBAL, "PosNative");
  assert.equal(protocol.NATIVE_DELIVER_FN, "__posNativeDeliver");
  assert.equal(protocol.DEFAULT_TCP_PRINTER_PORT, 9100);
});

const PROTOCOL_LISTS: [string, string][] = [
  ["NATIVE_METHODS", "NativeMethod"],
  ["NATIVE_EVENTS", "NativeEvent"],
  ["NATIVE_TRANSPORTS", "NativeTransport"],
  ["NATIVE_PRINTER_STATES", "NativePrinterState"],
  ["NATIVE_BLUETOOTH_STATES", "NativeBluetoothState"],
  ["NATIVE_ERROR_CODES", "NativeErrorCode"],
  ["NATIVE_PERMISSION_KINDS", "NativePermissionKind"],
  ["NATIVE_PLATFORMS", "NativePlatform"],
  // Phase 3 Session 3D: what the POS app can do beyond the method list.
  ["NATIVE_FEATURES", "NativeFeature"],
];

function protocolSource(): string {
  return readFileSync(path.join(__dirname, "native-bridge-protocol.ts"), "utf8");
}

test("protocol source: each list is `export const NAME = [...] as const;` + its derived type, plain literals only", () => {
  const code = stripComments(protocolSource());
  for (const [name, type] of PROTOCOL_LISTS) {
    assert.match(code, new RegExp(`export const ${name} = \\[[^\\]]*\\] as const;`), name);
    assert.ok(code.includes(`export type ${type} = (typeof ${name})[number];`), type);
  }
  assert.ok(!/from\s+["']zod["']/.test(code), "the parity diff stays simple: no Zod in the protocol file");
  assert.ok(!/^import\s/m.test(code), "the protocol file imports nothing");
  assert.ok(code.includes("declare global"), "landmark: the Window augmentation lives here");
});
