// Printer UX PX-3 Task 13 (spec §6.9 B9/B11): one Bluetooth row per physical printer, and what a refused scan asks.
import { test } from "node:test";
import assert from "node:assert/strict";

import { bluetoothRowsOf, connectRowsOf } from "@/lib/printer/connect-flow";
import { scanRefusalOf } from "@/lib/printer/native-picker-state";
import type { NativePrinter } from "@/lib/printer/native-bridge-protocol";

test("one row for a printer seen twice", () => {
  const rows = bluetoothRowsOf([
    { id: "ble:aa:bb", name: "POS-58", transport: "ble", address: "aa:bb" },
    { id: "bt-classic:AA:BB", name: "POS-58", transport: "bt-classic", paired: true, address: "AA:BB" },
  ]);
  assert.deepEqual(rows, [{ id: "bt-classic:AA:BB", name: "POS-58", sub: "Paired", primary: true, transport: "bt-classic" }], "one row, the classic id, Paired");
  const noAddress = bluetoothRowsOf([
    { id: "bt:AA:CC", name: "X", transport: "bt-classic", paired: true },
    { id: "ble:aa:cc", name: "X", transport: "ble" },
  ]);
  assert.equal(noAddress.length, 1, "no address: the id after its first colon is the key");
  const both = bluetoothRowsOf([
    { id: "ble:AA:DD", name: "Y", transport: "ble", address: "AA:DD" },
    { id: "bt-classic:AA:DD", name: "Y", transport: "bt-classic", address: "AA:DD" },
  ]);
  assert.deepEqual(both.map((r) => [r.id, r.sub]), [["bt-classic:AA:DD", "Nearby"]], "neither paired: classic over ble, Nearby");
});

test("a BLE-only printer is nearby", () => {
  assert.deepEqual(bluetoothRowsOf([{ id: "ble:AA:EE", name: "Z", transport: "ble", address: "AA:EE" }]), [{ id: "ble:AA:EE", name: "Z", sub: "Nearby", primary: false, transport: "ble" }], "the ble row, no primary");
});

test("paired first, in the list's order", () => {
  const list: NativePrinter[] = [
    { id: "ble:01", name: "N1", transport: "ble", address: "01" },
    { id: "bt-classic:02", name: "P1", transport: "bt-classic", paired: true, address: "02" },
    { id: "ble:03", name: "N2", transport: "ble", address: "03" },
    { id: "bt-classic:04", name: "P2", transport: "bt-classic", paired: true, address: "04" },
  ];
  assert.deepEqual(bluetoothRowsOf(list).map((r) => [r.name, r.primary]), [["P1", true], ["P2", false], ["N1", false], ["N2", false]], "paired rows first, each group in order; the first paired is primary");
});

test("USB and network entries are not Bluetooth rows", () => {
  const list: NativePrinter[] = [{ id: "usb:1", name: "U", transport: "usb" }, { id: "tcp:1", name: "T", transport: "tcp" }];
  assert.deepEqual(bluetoothRowsOf(list), [], "none");
  assert.equal(connectRowsOf(list, "usb").length, 1, "USB keeps its rows");
});

test("a scan refused asks to Allow, then shows the steps", () => {
  const refused = Object.assign(new Error("no"), { code: "UNAUTHORIZED" });
  assert.equal(scanRefusalOf(refused, false), "allow", "first: Allow");
  assert.equal(scanRefusalOf(refused, true), "settings-steps", "after a refused Allow: the steps");
});

test("other errors are not a refusal", () => {
  assert.equal(scanRefusalOf(Object.assign(new Error("x"), { code: "BLUETOOTH_OFF" }), false), null, "another code");
  assert.equal(scanRefusalOf(new Error("x"), true), null, "no code");
  assert.equal(scanRefusalOf(null, false), null, "nothing");
});
