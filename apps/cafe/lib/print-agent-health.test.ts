import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterLinkState } from "@pos/shared/print-failover";
import { printerHealthReportsOf, settledLinkOf } from "@/lib/print-agent-health";
import type { PoolPrinter } from "@/lib/printer/native-pool";

// Phase 3 Session 3B (spec §10, P3-6): the health this page reports on its wake, for the printers it prints here. The
// server keeps a report only from the device that writes the printer now, and only when it changed.

const TCP = { kind: "native" as const, transport: "tcp" as const, printerId: "tcp:10.0.2.2:9100", name: "Network printer 10.0.2.2", paper: "80mm" as const };

function poolPrinter(id: string, status: PoolPrinter["status"], over: Partial<PoolPrinter> = {}): PoolPrinter {
  return { id, printer: { ...TCP, printerId: id }, status, message: null, ...over };
}

test("settledLinkOf: connected and disconnected settle; a probe in between keeps the last settled link; nothing settled says nothing (the 3A gate, m-5)", () => {
  const memory = new Map<string, PrinterLinkState>();
  assert.equal(settledLinkOf(memory, "a", "connecting"), null, "nothing settled yet");
  assert.equal(settledLinkOf(memory, "a", "disconnected"), "disconnected");
  assert.equal(settledLinkOf(memory, "a", "connecting"), "disconnected", "the app's 30 s probe of a down printer never flickers it");
  assert.equal(settledLinkOf(memory, "a", "connected"), "connected");
  assert.equal(settledLinkOf(memory, "a", "needs-tap"), "disconnected", "a Bluetooth printer waiting for a tap cannot print");
  assert.equal(settledLinkOf(memory, "b", "elsewhere"), null, "another tab owns it: this tab says nothing");
  assert.equal(settledLinkOf(memory, "b", "none"), null);
});

test("printerHealthReportsOf: each of the app's printers by its own state and status; the device's one printer; nothing from the Windows spooler", () => {
  const memory = new Map<string, PrinterLinkState>();
  const pool = [
    poolPrinter("tcp:10.0.2.2:9100", "connected", { paper: "out" }),
    poolPrinter("tcp:10.0.2.2:9101", "disconnected", { cover: "open", error: true }),
    poolPrinter("tcp:10.0.2.2:9102", "connecting"),
  ];
  const targets = {
    "p-kitchen": { nativeId: "tcp:10.0.2.2:9100", paper: "80mm" as const },
    "p-bar": { nativeId: "tcp:10.0.2.2:9101", paper: "80mm" as const },
    "p-new": { nativeId: "tcp:10.0.2.2:9102", paper: "80mm" as const },
    "p-gone": { nativeId: "tcp:10.0.2.2:9199", paper: "80mm" as const },
  };
  assert.deepEqual(
    printerHealthReportsOf({ localIds: ["p-kitchen", "p-bar", "p-new", "p-gone"], targets, pool, device: "none", windows: false }, memory),
    [
      { printerId: "p-kitchen", link: "connected", paper: "out" },
      { printerId: "p-bar", link: "disconnected", cover: "open", error: true },
    ],
    "a printer still connecting, or one the app does not list, says nothing",
  );
  assert.deepEqual(printerHealthReportsOf({ localIds: ["p-own"], targets: {}, pool: null, device: "connected", windows: false }, memory), [{ printerId: "p-own", link: "connected" }], "the release APK or a browser: its one printer");
  assert.deepEqual(printerHealthReportsOf({ localIds: ["p-win"], targets: { "p-win": { printerName: "EPSON", paper: "80mm" } }, pool: null, device: "connected", windows: true }, memory), [], "the Windows app reports nothing until 1.12.0 (Session 3E)");
});
