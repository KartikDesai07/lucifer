import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterHere, WaitingPrinter } from "@/lib/print-agent-here";
import {
  PRINTER_BUTTON_NAME_OK,
  PRINTER_BUTTON_NAME_WAITING,
  printerButtonName,
  printerDotOf,
  printerDotTone,
  type PrinterDotInput,
  type PrinterDotPrinters,
} from "@/lib/printer/printer-dot";

// PX-2 (spec §6.5, PX-D6, R1): a waiter's phone showed green while the kitchen printer was down. In printers mode a
// device turns amber (the warn dot) while a printer it does not print has fresh slips waiting. Kept out of
// lib/printer/printer-dot.test.ts (over 300 lines: controller Ruling B); every case there stays as it is.

const BASE: PrinterDotInput = { remote: "none", isHostDevice: false, lane: "system", local: "none", deviceOffline: false, desktopChosen: "unknown" };
const KITCHEN_WAITS: WaitingPrinter = { printerId: "kitchen", name: "Kitchen printer", count: 3, stuck: true };
const PHONE: PrinterDotPrinters = { printersMode: true, isWriter: false, allLocal: true };
const BILL_HERE: PrinterHere = { id: "bill", name: "Bill printer", appName: "RPP02N", transport: "bluetooth", nativeId: "bt-classic:B", status: "connected" };
const KITCHEN_HERE: PrinterHere = { id: "kitchen", name: "Kitchen printer", appName: "RPP02N", transport: "bluetooth", nativeId: "bt-classic:A", status: "connected" };

test("a device that writes nothing turns amber when a printer's slips wait", () => {
  const dot = printerDotOf({ ...BASE, printers: { ...PHONE, waiting: KITCHEN_WAITS } });
  assert.deepEqual(dot, { show: true, ok: false, reason: "printer-waiting" }, "the phone says a printer is not printing");
  assert.equal(printerDotTone(dot), "red", "the warn dot (the button draws 'red' in the warn colour)");
  assert.equal(printerButtonName(dot), PRINTER_BUTTON_NAME_WAITING, "its own accessible name");
  assert.equal(PRINTER_BUTTON_NAME_WAITING, "Printer not printing — open printer setup", "the spec's words (§6.4)");
});

test("stays green with nothing waiting", () => {
  const dot = printerDotOf({ ...BASE, printers: PHONE });
  assert.deepEqual(dot, { show: true, ok: true, reason: "printers-elsewhere" }, "slips print at the cafe's printers");
  assert.equal(printerButtonName(dot), PRINTER_BUTTON_NAME_OK, "today's name");
  assert.deepEqual(printerDotOf({ ...BASE, printers: { ...PHONE, here: [], notHere: [] } }), { show: true, ok: true, reason: "printers-elsewhere" }, "empty lists change nothing");
});

test("a writer whose printers are fine turns amber for another printer that waits (R1)", () => {
  const writer: PrinterDotPrinters = { printersMode: true, isWriter: true, allLocal: true, worst: "connected", here: [BILL_HERE] };
  assert.deepEqual(printerDotOf({ ...BASE, lane: "raster", local: "connected", printers: writer }), { show: true, ok: true, reason: "ok" }, "fixture: green with nothing waiting");
  assert.deepEqual(printerDotOf({ ...BASE, lane: "raster", local: "connected", printers: { ...writer, waiting: KITCHEN_WAITS } }), { show: true, ok: false, reason: "printer-waiting" }, "the kitchen printer is another device's");
});

test("a writer's own waiting printer keeps its own reason", () => {
  const writer: PrinterDotPrinters = { printersMode: true, isWriter: true, allLocal: true, worst: "connected", here: [KITCHEN_HERE, BILL_HERE], waiting: KITCHEN_WAITS };
  assert.deepEqual(printerDotOf({ ...BASE, lane: "raster", local: "connected", printers: writer }), { show: true, ok: true, reason: "ok" }, "its own printer is connected: it is printing them");
  const down = { ...writer, worst: "disconnected" as const };
  assert.deepEqual(printerDotOf({ ...BASE, lane: "raster", local: "connected", printers: down }), { show: true, ok: false, reason: "printer-off" }, "its own printer is down: today's row says so");
  const elsewhere = { ...down, here: [BILL_HERE] };
  assert.deepEqual(printerDotOf({ ...BASE, lane: "raster", local: "connected", printers: elsewhere }), { show: true, ok: false, reason: "printer-off" }, "a red row of its own is never turned into amber");
});

test("the rules ahead of it still win: offline, no lane, simple mode, a printer that is not here", () => {
  const waiting = { ...PHONE, waiting: KITCHEN_WAITS };
  assert.deepEqual(printerDotOf({ ...BASE, deviceOffline: true, printers: waiting }), { show: true, ok: false, reason: "device-offline" }, "offline first");
  assert.deepEqual(printerDotOf({ ...BASE, lane: "pending", printers: waiting }), { show: false }, "no dot before the lane is known");
  assert.deepEqual(printerDotOf({ ...BASE, remote: "ok", printers: { ...waiting, printersMode: false } }), { show: true, ok: true, reason: "ok" }, "simple mode: as before");
  assert.deepEqual(printerDotOf({ ...BASE, lane: "raster", local: "connected", printers: { ...waiting, isWriter: true, allLocal: false } }), { show: true, ok: false, reason: "printer-not-here" }, "a printer it writes is not here: that first");
});
