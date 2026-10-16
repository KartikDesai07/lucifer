import "@/lib/hook-harness"; // installs the react / react-to-print / sonner stubs: MUST stay the first import
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PrinterConfig, PrinterSlips } from "@pos/shared/print-printers";
import { mountHook, stubModule } from "@/lib/hook-harness";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { TextKotEnv } from "@/lib/printer/kot-text/text-kot-print";
import { textKotKeyForDevice, textKotKeyForPrinter } from "@/lib/printer/kot-text/text-kot-store";
import type { PrinterSnapshot } from "@/lib/printer/web-printer-types";
import { stripComments } from "@/lib/source-pin-utils";

// Printing Phase 4, the 4B gate's m-1 (the owner's decision, 2026-10-16): the "Fast text KOTs" section lists nothing
// until this device's printers read has answered. Before it, an empty read looks like simple mode, so a printers-mode
// cafe would list this device's own printer under a `device:` key that none of its printer jobs uses. Driven through the
// REAL hook body (lib/hook-harness.ts) with its reads stubbed.

const APP: DevicePrinter = { kind: "native", name: "Counter BT", paper: "58mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" };
const NONE: PrinterSlips = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };
const KITCHEN = {
  id: "p-kitchen",
  name: "Kitchen",
  connection: { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB:CC:DD:EE:FF" },
  order: 0,
  paper: 58,
  slips: { ...NONE, kotStations: ["s1"] },
  copies: { kot: 1, bill: 1 },
  enabled: true,
  primaryDeviceId: "dev-a",
} as unknown as PrinterConfig;

const snapshot: PrinterSnapshot = { status: "connected", printer: APP, message: null };
const env: TextKotEnv = {
  devicePrinter: () => snapshot,
  desktop: () => null,
  desktopPrintsRaw: () => false,
  rasterCapable: () => true,
  readTextKot: () => null,
  slipCodeStatus: () => "idle",
  writeDevice: async () => undefined,
  writeNative: async () => undefined,
  writeLan: async () => undefined,
  writeRawOn: async () => undefined,
};

const world: { deviceId: string; printers: PrinterConfig[]; answered: boolean } = { deviceId: "dev-a", printers: [], answered: false };
stubModule("@/components/layout/PrintHostProvider", { usePrintHostContext: () => ({ deviceId: world.deviceId }) });
stubModule("@/hooks/use-agent-printers", {
  usePrintersRead: () => ({ printers: world.printers, loaded: world.answered, failed: false, answered: world.answered }),
  useDesktopPrinters: () => null,
  usePoolView: () => null,
});
stubModule("@/hooks/use-device-printer", { useDevicePrinter: () => snapshot });
stubModule("@/lib/printer/kot-text/text-kot-print", { textKotEnv: () => env }); // the hook's import only; the list's own route stays real
const load = createRequire(__filename);
const { useTextKotPrinters } = load("@/hooks/use-text-kot-printers") as typeof import("@/hooks/use-text-kot-printers");

const keysOf = (deviceId: string, printers: PrinterConfig[], answered: boolean): string[] => {
  Object.assign(world, { deviceId, printers, answered });
  const hook = mountHook(() => useTextKotPrinters());
  const keys = hook.result().map((printer) => printer.key);
  hook.unmount();
  return keys;
};

test("m-1: before this device's printers read answers, the section lists nothing", () => {
  assert.deepEqual(keysOf("dev-a", [], false), [], "unanswered: never this device's own printer under a device: key");
  assert.deepEqual(keysOf("dev-a", [KITCHEN], false), [], "unanswered, even with printers somehow in hand");
});

test("m-1: once it answers, the section lists the printers as before", () => {
  assert.deepEqual(keysOf("dev-a", [], true), [textKotKeyForDevice(APP)], "answered with no printers: simple mode, this device's own printer");
  assert.deepEqual(keysOf("dev-a", [KITCHEN], true), [textKotKeyForPrinter("p-kitchen", APP)], "answered in printers mode: the setup's printer, by its route here");
});

test("m-1: a device with no identity never reads the printers, so its own printer is listed at once", () => {
  assert.deepEqual(keysOf("", [], false), [textKotKeyForDevice(APP)], "no identity: simple mode, as before");
});

test("PIN (m-1): the section's printers wait for the printers read's answer", () => {
  const hook = stripComments(readFileSync(path.join(process.cwd(), "hooks/use-text-kot-printers.ts"), "utf8"));
  assert.ok(hook.includes('const { printers, answered } = usePrintersRead(deviceId !== "");'), "the read's answered flag");
  assert.ok(hook.includes('deviceId !== "" && !answered ? NO_TEXT_KOT_PRINTERS'), "nothing until it answers");
});
