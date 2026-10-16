import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterConfig } from "@pos/shared/print-printers";
import {
  LAN_NONE_FOUND_MESSAGE,
  LAN_NO_NETWORK_MESSAGE,
  LAN_SCANNING_MESSAGE,
  alreadyAddedText,
  knownLanPrinters,
  lanFoundRows,
  lanOutcomeOf,
  lanScanAvailable,
  scanNetworkPrinters,
} from "./lan-discovery";

// Printing Phase 4 (spec 2026-10-15 §7.3): "Find network printers" on the page. Shown only where this device's app can
// scan (the POS app that says lanScan, the Windows app 2.0.2); the app's answer as a short list, each row its address and
// port and "Already added: <name>" for one the setup or the app has; nothing is added by itself.

type FakeWindow = Record<string, unknown>;
function installWindow(t: { after(fn: () => void): void }, win: FakeWindow): void {
  (globalThis as unknown as { window: FakeWindow }).window = win;
  t.after(() => delete (globalThis as unknown as { window?: unknown }).window);
}

test("the spec's words", () => {
  assert.equal(LAN_SCANNING_MESSAGE, "Looking for printers on this Wi-Fi…");
  assert.equal(LAN_NONE_FOUND_MESSAGE, "No network printer found on this Wi-Fi. Check that the printer is on and on the same Wi-Fi, or type its address.");
  assert.equal(LAN_NO_NETWORK_MESSAGE, "This device is not on a Wi-Fi or wired network.");
  assert.equal(alreadyAddedText("Kitchen"), "Already added: Kitchen");
});

test("only an app that can scan shows the button: the POS app that says lanScan, the Windows app 2.0.2", (t) => {
  installWindow(t, { PosNative: { version: 1, features: ["battery", "lanScan"], request: () => undefined, on: () => () => undefined } });
  assert.equal(lanScanAvailable(), true, "the POS app 2.0.2");
  installWindow(t, { PosNative: { version: 1, features: ["battery"], request: () => undefined, on: () => () => undefined } });
  assert.equal(lanScanAvailable(), false, "an older POS app is never asked");
  installWindow(t, { posDesktop: { version: "2.0.2", printHtml: async () => undefined, findLanPrinters: async () => ({ found: [] }) } });
  assert.equal(lanScanAvailable(), true, "the Windows app 2.0.2");
  installWindow(t, { posDesktop: { version: "2.0.1", printHtml: async () => undefined } });
  assert.equal(lanScanAvailable(), false, "an older Windows app");
  installWindow(t, {});
  assert.equal(lanScanAvailable(), false, "a browser");
});

test("the answer as a list: sorted by address, each once; none found; not on a network; anything unreadable is none", () => {
  assert.deepEqual(
    lanOutcomeOf({ found: [{ host: "192.168.1.60", port: 9100 }, { host: "192.168.1.9", port: 9100 }, { host: "192.168.1.60", port: 9100 }], subnet: "192.168.1.0/24" }),
    { kind: "found", printers: [{ host: "192.168.1.9", port: 9100 }, { host: "192.168.1.60", port: 9100 }] },
    "by address (9 before 60), each once",
  );
  assert.deepEqual(lanOutcomeOf({ found: [], subnet: "192.168.1.0/24" }), { kind: "none" }, "nothing on the Wi-Fi");
  assert.deepEqual(lanOutcomeOf({ found: [], reason: "no-network" }), { kind: "no-network" }, "not on a Wi-Fi or wired network");
  for (const raw of [null, undefined, "x", {}, { found: "x" }, { found: [{ host: "", port: 9100 }] }, { found: [{ host: "a", port: 0 }] }]) {
    assert.deepEqual(lanOutcomeOf(raw), { kind: "none" }, `unreadable: ${JSON.stringify(raw)}`);
  }
});

test("each row: its address and port, and the printer already added at that address and port", () => {
  const rows = lanFoundRows(
    [{ host: "192.168.1.50", port: 9100 }, { host: "192.168.1.51", port: 9100 }],
    [{ host: "192.168.1.50", port: 9100, name: "Kitchen" }, { host: "192.168.1.51", port: 9101, name: "Bar" }],
  );
  assert.deepEqual(rows, [
    { host: "192.168.1.50", port: 9100, label: "192.168.1.50 · port 9100", alreadyAdded: "Kitchen" },
    { host: "192.168.1.51", port: 9100, label: "192.168.1.51 · port 9100", alreadyAdded: null },
  ], "another port on that address is another printer");
});

test("the printers already added: the setup's network printers and the POS app's network printers, by address and port", () => {
  const lan = { id: "p1", name: "Kitchen", connection: { kind: "lan", host: "192.168.1.50", port: 9100 } } as unknown as PrinterConfig;
  const device = { id: "p2", name: "Counter", connection: { kind: "device", deviceId: "d", transport: "bt-classic", address: "AA" } } as unknown as PrinterConfig;
  const known = knownLanPrinters([lan, device], [{ id: "tcp:192.168.1.70:9100", name: "Network printer 192.168.1.70" }, { id: "bt-classic:AA:BB:CC:DD:EE:FF", name: "RPP02N" }]);
  assert.deepEqual(known, [
    { host: "192.168.1.50", port: 9100, name: "Kitchen" },
    { host: "192.168.1.70", port: 9100, name: "Network printer 192.168.1.70" },
  ], "a Bluetooth printer has no address on the network");
});

test("a scan through the Windows app; a failed scan reads as none found (staff type the address, as today)", async (t) => {
  installWindow(t, { posDesktop: { version: "2.0.2", printHtml: async () => undefined, findLanPrinters: async () => ({ found: [{ host: "192.168.1.50", port: 9100 }], subnet: "192.168.1.0/24" }) } });
  assert.deepEqual(await scanNetworkPrinters(), { kind: "found", printers: [{ host: "192.168.1.50", port: 9100 }] });
  installWindow(t, { posDesktop: { version: "2.0.2", printHtml: async () => undefined, findLanPrinters: async () => { throw new Error("x"); } } });
  assert.deepEqual(await scanNetworkPrinters(), { kind: "none" });
  installWindow(t, {});
  assert.deepEqual(await scanNetworkPrinters(), { kind: "none" }, "no app: never asked, none");
});
