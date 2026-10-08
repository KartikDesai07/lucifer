import { test } from "node:test";
import assert from "node:assert/strict";

import { PRINTER_DOWN_SETTLE_MS } from "@pos/shared/print-failover";
import { printerHealthClock, printerHealthReportsOf, settledLinkOf, type SettledLink } from "@/lib/print-agent-health";
import type { PoolPrinter } from "@/lib/printer/native-pool";

// Phase 3 Session 3B (spec §10, P3-6): the health this page reports on its wake, for the printers it prints here. The
// server keeps a report only from the device that writes the printer now, and only when it changed. Session 3C (the 3B
// review's m-3): a printer reads disconnected only once it stayed down PRINTER_DOWN_SETTLE_MS, so a blip (one failed
// probe the app's 2 s retry answers) never starts a skip; and (m-1) a network printer this device may take over that its
// app does not list reads as down, so the server never picks it for one it cannot print.

const TCP = { kind: "native" as const, transport: "tcp" as const, printerId: "tcp:10.0.2.2:9100", name: "Network printer 10.0.2.2", paper: "80mm" as const };
const T0 = Date.parse("2026-10-08T12:00:00Z");

function poolPrinter(id: string, status: PoolPrinter["status"], over: Partial<PoolPrinter> = {}): PoolPrinter {
  return { id, printer: { ...TCP, printerId: id }, status, message: null, ...over };
}

test("3C (m-3): settledLinkOf: connected settles at once; a printer reads disconnected only once it stayed down 20 s; a probe in between keeps the clock", () => {
  assert.equal(PRINTER_DOWN_SETTLE_MS, 20_000);
  const memory = new Map<string, SettledLink>();
  assert.equal(settledLinkOf(memory, "a", "connecting", T0), null, "nothing settled yet");
  assert.equal(settledLinkOf(memory, "a", "disconnected", T0), null, "down a moment: nothing yet");
  assert.equal(settledLinkOf(memory, "a", "connecting", T0 + 5_000), null, "the app's reconnect probe keeps the clock");
  assert.equal(settledLinkOf(memory, "a", "disconnected", T0 + PRINTER_DOWN_SETTLE_MS - 1), null);
  assert.equal(settledLinkOf(memory, "a", "disconnected", T0 + PRINTER_DOWN_SETTLE_MS), "disconnected", "down 20 s: disconnected");
  assert.equal(settledLinkOf(memory, "a", "connecting", T0 + 30_000), "disconnected", "the app's 30 s probe of a down printer never flickers it");
  assert.equal(settledLinkOf(memory, "a", "connected", T0 + 40_000), "connected", "back: connected at once");
  assert.equal(settledLinkOf(memory, "a", "disconnected", T0 + 50_000), "connected", "a blip: still connected");
  assert.equal(settledLinkOf(memory, "a", "connecting", T0 + 52_000), "connected");
  assert.equal(settledLinkOf(memory, "a", "connected", T0 + 55_000), "connected", "answered within 20 s: never reported down");
  assert.equal(settledLinkOf(memory, "a", "disconnected", T0 + 80_000), "connected", "a new spell starts its own clock");
  assert.equal(settledLinkOf(memory, "a", "disconnected", T0 + 100_000), "disconnected");
  assert.equal(settledLinkOf(memory, "t", "needs-tap", T0), null, "a Bluetooth printer waiting for a tap…");
  assert.equal(settledLinkOf(memory, "t", "needs-tap", T0 + PRINTER_DOWN_SETTLE_MS), "disconnected", "…cannot print: down once it stays so");
  assert.equal(settledLinkOf(memory, "b", "elsewhere", T0), null, "another tab owns it: this tab says nothing");
  assert.equal(settledLinkOf(memory, "b", "none", T0), null);
});

test("printerHealthReportsOf: each of the app's printers by its own state and status; the device's one printer; nothing from the Windows spooler", () => {
  const memory = new Map<string, SettledLink>();
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
  const input = { localIds: ["p-kitchen", "p-bar", "p-new", "p-gone"], targets, pool, device: "none" as const, windows: false, missing: [] };
  assert.deepEqual(printerHealthReportsOf({ ...input, nowMs: T0 }, memory), [{ printerId: "p-kitchen", link: "connected", paper: "out" }], "the bar printer only just went down: nothing for it yet");
  assert.deepEqual(
    printerHealthReportsOf({ ...input, nowMs: T0 + PRINTER_DOWN_SETTLE_MS }, memory),
    [
      { printerId: "p-kitchen", link: "connected", paper: "out" },
      { printerId: "p-bar", link: "disconnected", cover: "open", error: true },
    ],
    "a printer still connecting, or one the app does not list, says nothing",
  );
  assert.deepEqual(printerHealthReportsOf({ localIds: ["p-own"], targets: {}, pool: null, device: "connected", windows: false, missing: [], nowMs: T0 }, memory), [{ printerId: "p-own", link: "connected" }], "the release APK or a browser: its one printer");
  assert.deepEqual(printerHealthReportsOf({ localIds: ["p-win"], targets: { "p-win": { printerName: "EPSON", paper: "80mm" } }, pool: null, device: "connected", windows: true, missing: [], nowMs: T0 }, memory), [], "the Windows app reports nothing until 1.12.0 (Session 3E)");
});

test("3C (m-1): a network printer this device may take over that its app does not list reads down once it stays missing 20 s", () => {
  const memory = new Map<string, SettledLink>();
  const input = { localIds: [], targets: {}, pool: [], device: "none" as const, windows: false, missing: ["p-theirs"] };
  assert.deepEqual(printerHealthReportsOf({ ...input, nowMs: T0 }, memory), [], "just loaded: the page is still adding it to the app");
  assert.deepEqual(printerHealthReportsOf({ ...input, nowMs: T0 + PRINTER_DOWN_SETTLE_MS }, memory), [{ printerId: "p-theirs", link: "disconnected" }], "still missing: this device cannot print it");
  assert.deepEqual(printerHealthReportsOf({ ...input, missing: [], nowMs: T0 + 30_000 }, memory), [], "once the app lists it, its own state speaks for it");
  assert.deepEqual(printerHealthReportsOf({ ...input, nowMs: T0 + 31_000 }, memory), [], "missing again later: a fresh 20 s");
});

test("3C review (I-1): the settle clock runs on every status change, not only when the wake samples it: a printer down 20 s reads disconnected at the next wake", () => {
  let status: PoolPrinter["status"] = "connected";
  let now = T0;
  const listeners = new Set<() => void>();
  const store = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const change = (next: PoolPrinter["status"], at: number) => {
    status = next;
    now = at;
    for (const listener of listeners) listener();
  };
  const clock = printerHealthClock(
    () => ({ localIds: ["p-kitchen"], targets: { "p-kitchen": { nativeId: "tcp:10.0.2.2:9100", paper: "80mm" as const } }, pool: [poolPrinter("tcp:10.0.2.2:9100", status)], device: "none" as const, windows: false, missing: [], nowMs: now }),
    [store],
  );
  assert.equal(listeners.size, 1, "it listens to the status store");
  assert.deepEqual(clock.reports(), [{ printerId: "p-kitchen", link: "connected" }], "a wake while it is up");
  change("disconnected", T0 + 1_000);
  now = T0 + 1_000 + PRINTER_DOWN_SETTLE_MS;
  assert.deepEqual(clock.reports(), [{ printerId: "p-kitchen", link: "disconnected" }], "the first wake 20 s after the app said it is down already says so (the clock started at the change, not at this wake)");
  change("connected", T0 + 40_000);
  change("disconnected", T0 + 50_000);
  change("connected", T0 + 52_000);
  now = T0 + 80_000;
  assert.deepEqual(clock.reports(), [{ printerId: "p-kitchen", link: "connected" }], "a blip between two wakes never reads down");
  clock.stop();
  assert.equal(listeners.size, 0, "stop releases the store");
});
