import { test } from "node:test";
import assert from "node:assert/strict";

import { PAGE_HELD_STATUS, heldPrinterStatusOf, type HeldStatusMemory } from "@/lib/printer/held-status";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// PX-2 (spec §6.9 B6): the app retries a printer by itself (disconnected → connecting → disconnected …); the dot and the
// status card must not flicker red ↔ "Checking…" on every try. "connected" always shows at once.

function run(memory: HeldStatusMemory, key: string, statuses: PrinterStatus[]): PrinterStatus[] {
  return statuses.map((status) => heldPrinterStatusOf(memory, key, status));
}

test("connecting after a settled disconnected stays disconnected", () => {
  const memory: HeldStatusMemory = new Map();
  assert.deepEqual(run(memory, "local", ["disconnected", "connecting", "connecting", "disconnected", "connecting"]), ["disconnected", "disconnected", "disconnected", "disconnected", "disconnected"], "every retry reads as the settled state");
});

test("the same after needs-tap", () => {
  const memory: HeldStatusMemory = new Map();
  assert.deepEqual(run(memory, "local", ["needs-tap", "connecting"]), ["needs-tap", "needs-tap"], "a tap is still needed while it tries");
});

test("connected shows at once", () => {
  const memory: HeldStatusMemory = new Map();
  assert.deepEqual(run(memory, "local", ["disconnected", "connecting", "connected"]), ["disconnected", "disconnected", "connected"], "connected is never held back");
  assert.equal(heldPrinterStatusOf(memory, "local", "connecting"), "connecting", "after connected, a connecting is connecting (a drop is reported as disconnected first)");
});

test("a first connecting is connecting", () => {
  assert.equal(heldPrinterStatusOf(new Map(), "local", "connecting"), "connecting", "nothing settled yet: the page is checking");
  const memory: HeldStatusMemory = new Map();
  assert.deepEqual(run(memory, "local", ["none", "connecting"]), ["none", "connecting"], "no printer, then one being connected: checking");
  assert.deepEqual(run(memory, "local", ["elsewhere", "connecting"]), ["elsewhere", "connecting"], "only disconnected and needs-tap hold");
});

test("keys are separate", () => {
  const memory: HeldStatusMemory = new Map();
  assert.equal(heldPrinterStatusOf(memory, "bt-classic:A", "disconnected"), "disconnected", "Kitchen settles down");
  assert.equal(heldPrinterStatusOf(memory, "bt-classic:B", "connecting"), "connecting", "Bill's own first try is its own");
  assert.equal(heldPrinterStatusOf(memory, "bt-classic:A", "connecting"), "disconnected", "Kitchen's retry stays down");
  assert.equal(heldPrinterStatusOf(memory, "local", "connecting"), "connecting", "the device's own key is apart too");
});

test("one memory per page, shared by the button and the panel", () => {
  assert.ok(PAGE_HELD_STATUS instanceof Map, "a module memory");
  heldPrinterStatusOf(PAGE_HELD_STATUS, "held-status.test", "disconnected");
  assert.equal(heldPrinterStatusOf(PAGE_HELD_STATUS, "held-status.test", "connecting"), "disconnected", "a second reader of the same key reads the same held value");
  PAGE_HELD_STATUS.delete("held-status.test");
});
