import { test } from "node:test";
import assert from "node:assert/strict";
import { canScanBluetooth, createStatusOrder, loadPicker } from "@/lib/printer/native-picker-state";
import type { NativePrinter } from "@/lib/printer/native-bridge-protocol";

const USB: NativePrinter[] = [{ id: "usb:1:2", name: "USB printer", transport: "usb" }];

test("canScanBluetooth: only a Bluetooth known to be unusable disables the scan", () => {
  assert.equal(canScanBluetooth(null), true, "unknown (status failed) stays enabled; the scan reports its own error");
  assert.equal(canScanBluetooth("on"), true);
  for (const state of ["off", "unauthorized", "unsupported"] as const) assert.equal(canScanBluetooth(state), false, state);
});

test("loadPicker: a failed status keeps a good list (USB works without Bluetooth)", async () => {
  const result = await loadPicker(() => Promise.reject(new Error("timeout")), () => Promise.resolve(USB));
  assert.equal(result.bluetooth, null);
  assert.deepEqual(result.printers, USB);
  assert.equal(result.listError, null);
});

test("loadPicker: a failed list keeps a good status and returns the error", async () => {
  const error = new Error("list failed");
  const result = await loadPicker(() => Promise.resolve({ bluetooth: "on" as const }), () => Promise.reject(error));
  assert.equal(result.bluetooth, "on");
  assert.equal(result.printers, null);
  assert.equal(result.listError, error);
});

test("loadPicker: both requests start together (neither waits for the other)", async () => {
  const started: string[] = [];
  let releaseStatus!: () => void;
  const status = () => {
    started.push("status");
    return new Promise<{ bluetooth: "on" }>((resolve) => (releaseStatus = () => resolve({ bluetooth: "on" })));
  };
  const list = () => {
    started.push("list");
    return Promise.resolve(USB);
  };
  const pending = loadPicker(status, list);
  assert.deepEqual(started, ["status", "list"]);
  releaseStatus();
  assert.equal((await pending).bluetooth, "on");
});

test("createStatusOrder: a reply to a request that started before a pushed event is stale", () => {
  const order = createStatusOrder();
  const before = order.start();
  order.event();
  assert.equal(order.fresh(before), false, "the event is newer than this reply");
  const after = order.start();
  assert.equal(order.fresh(after), true);
});
