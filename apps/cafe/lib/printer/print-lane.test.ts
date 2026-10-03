import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { rasterCapable } from "@/lib/printer/capabilities";
import {
  desktopChosen,
  publishDesktopPrinterSelection,
  refreshDesktopPrinterChosen,
  resetDesktopPrinterChosen,
  subscribeDesktopPrinterChosen,
} from "@/lib/printer/desktop-printer-state";
import {
  PRINTER_ELSEWHERE_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  setDevicePrinterInstance,
  type DevicePrinterRuntime,
} from "@/lib/printer/device-printer";
import { NO_PRINTER_MESSAGE } from "@/lib/printer/lane-print";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import {
  DESKTOP_NO_PRINTER_MESSAGE,
  DEVICE_LABEL_PC,
  DEVICE_LABEL_TABLET,
  beatPrinterReport,
  beatSilentMode,
  canPrintNow,
  currentLane,
  defaultDeviceLabel,
  printBlockedMessage,
  printCapabilities,
  type PrintLane,
} from "@/lib/printer/print-lane";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// The lane is resolved at call time from three capability signals (the desktop
// shell, a saved device printer, the app bridge). Everything is faked on
// globalThis and restored in t.after.

const PRINTER: DevicePrinter = { kind: "serial", name: "Bluetooth printer", paper: "80mm", bluetoothServiceClassId: "00001101-0000-1000-8000-00805f9b34fb" };
const BRIDGE = Object.freeze({ version: 1, platform: "android", request: async () => ({}), on: () => () => undefined });
const SHELL = { version: "1", printHtml: async () => undefined };

interface Scene {
  shell?: boolean;
  bridge?: boolean;
  printer?: PrinterStatus; // a saved printer in this status; omitted = none saved
  coarse?: boolean;
  matchMedia?: boolean;
  webview?: boolean; // the app's WebView host object (present before PosNative is injected)
}

function install(t: { after(fn: () => void): void }, scene: Scene): void {
  const holder = globalThis as unknown as { window?: unknown };
  const had = Object.prototype.hasOwnProperty.call(holder, "window");
  const before = holder.window;
  holder.window = {
    ...(scene.shell ? { posDesktop: SHELL } : {}),
    ...(scene.bridge ? { PosNative: BRIDGE } : {}),
    ...(scene.webview ? { ReactNativeWebView: {} } : {}),
    ...(scene.matchMedia === false ? {} : { matchMedia: (q: string) => ({ matches: scene.coarse === true && q === "(pointer: coarse)" }) }),
  };
  const runtime = {
    getSnapshot: () => ({ status: scene.printer ?? "none", printer: scene.printer ? PRINTER : null, message: null }),
  } as unknown as DevicePrinterRuntime;
  setDevicePrinterInstance(runtime);
  t.after(() => {
    setDevicePrinterInstance(null);
    if (had) holder.window = before;
    else delete holder.window;
  });
}

// A desktop shell whose picker answers: selected = the chosen printer's name, or null for none.
// Awaits the store's read so the call-time lane functions see the answer.
async function installShellWithPicker(t: { after(fn: () => void): void }, selected: string | null): Promise<void> {
  const holder = globalThis as unknown as { window?: unknown };
  const had = Object.prototype.hasOwnProperty.call(holder, "window");
  const before = holder.window;
  const shell = { ...SHELL, listPrinters: async () => ({ selected, printers: [] }), savePrinter: async () => ({ selected }) };
  holder.window = { posDesktop: shell, matchMedia: () => ({ matches: false }) };
  setDevicePrinterInstance({ getSnapshot: () => ({ status: "none", printer: null, message: null }) } as unknown as DevicePrinterRuntime);
  resetDesktopPrinterChosen();
  t.after(() => {
    resetDesktopPrinterChosen();
    setDevicePrinterInstance(null);
    if (had) holder.window = before;
    else delete holder.window;
  });
  await refreshDesktopPrinterChosen();
}

function withNavigator(t: { after(fn: () => void): void }, fake: object): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: fake, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });
}

// ---- lane truth table ---------------------------------------------------------------

test("lane: shell wins over everything, then a saved printer, then the app bridge alone, then the browser print window", (t) => {
  const table: [Scene, PrintLane][] = [
    [{ shell: true }, "desktop"],
    [{ shell: true, printer: "connected", bridge: true }, "desktop"],
    [{ printer: "connected" }, "raster"],
    [{ printer: "disconnected", bridge: true }, "raster"],
    [{ printer: "elsewhere" }, "raster"],
    [{ bridge: true }, "none"],
    // s63 INT: inside the app's WebView before PosNative arrives the print window is still a no-op → none, never system
    [{ webview: true }, "none"],
    [{ webview: true, printer: "connected" }, "raster"],
    [{}, "system"],
  ];
  for (const [scene, expected] of table) {
    install(t, scene);
    assert.equal(currentLane(), expected, JSON.stringify(scene));
  }
});

test("lane is read at call time: a printer configured later moves the lane without any re-wrap", (t) => {
  install(t, { bridge: true });
  assert.equal(currentLane(), "none");
  install(t, { bridge: true, printer: "connected" });
  assert.equal(currentLane(), "raster");
});

test("canPrintNow: desktop and system always; raster only when connected HERE; none never", (t) => {
  const table: [Scene, boolean][] = [
    [{ shell: true }, true],
    [{}, true],
    [{ printer: "connected" }, true],
    [{ printer: "connecting" }, false],
    [{ printer: "disconnected" }, false],
    [{ printer: "needs-tap" }, false],
    [{ printer: "elsewhere" }, false],
    [{ bridge: true }, false],
    [{ shell: true, printer: "disconnected" }, true],
  ];
  for (const [scene, expected] of table) {
    install(t, scene);
    assert.equal(canPrintNow(), expected, JSON.stringify(scene));
  }
});

test("printBlockedMessage: the app with no printer says set one up; another tab says so; anything else says reconnect", (t) => {
  const table: [Scene, string][] = [
    [{ bridge: true }, NO_PRINTER_MESSAGE],
    [{ printer: "elsewhere" }, PRINTER_ELSEWHERE_MESSAGE],
    [{ printer: "elsewhere", bridge: true }, PRINTER_ELSEWHERE_MESSAGE],
    [{ printer: "disconnected" }, PRINTER_NOT_CONNECTED_MESSAGE],
    [{ printer: "needs-tap", bridge: true }, PRINTER_NOT_CONNECTED_MESSAGE],
    [{ printer: "connecting" }, PRINTER_NOT_CONNECTED_MESSAGE],
  ];
  for (const [scene, expected] of table) {
    install(t, scene);
    assert.equal(printBlockedMessage(), expected, JSON.stringify(scene));
  }
  assert.notEqual(NO_PRINTER_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, "the two sentences must stay distinct");
});

test("beatPrinterReport: desktop connected, raster owner connected/disconnected, system unknown, none disconnected, raster non-owner OMITTED", (t) => {
  const table: [Scene, ReturnType<typeof beatPrinterReport>][] = [
    [{ shell: true }, "connected"],
    [{ shell: true, printer: "disconnected" }, "connected"],
    [{ printer: "connected" }, "connected"],
    [{ printer: "connecting" }, "disconnected"],
    [{ printer: "disconnected" }, "disconnected"],
    [{ printer: "needs-tap" }, "disconnected"],
    [{ printer: "elsewhere" }, undefined],
    [{}, "unknown"],
    [{ bridge: true }, "disconnected"],
  ];
  for (const [scene, expected] of table) {
    install(t, scene);
    assert.equal(beatPrinterReport(), expected, JSON.stringify(scene));
  }
});

test("beatSilentMode: the Windows app and a printer on this device never open a print window (silent); the browser's window keeps the staff question", (t) => {
  // The owner's release check (2026-10-03): the dashboard said "Print host shows a dialog for every slip." for
  // an Android app host, which never shows one, until staff answered the setup card's yes/no question.
  const table: [Scene, ReturnType<typeof beatSilentMode>][] = [
    [{ shell: true }, true],
    [{ printer: "connected" }, true],
    [{ printer: "disconnected" }, true],
    [{ printer: "elsewhere" }, true],
    [{}, undefined],
    [{ bridge: true }, undefined],
  ];
  for (const [scene, expected] of table) {
    install(t, scene);
    assert.equal(beatSilentMode(), expected, JSON.stringify(scene));
  }
});

// ---- W-L: a desktop shell with NO printer chosen ------------------------------------------

test("W-L: a shell with no printer chosen cannot print: canPrintNow false, beat disconnected, blocked sentence names the fix", async (t) => {
  await installShellWithPicker(t, null);
  assert.equal(currentLane(), "desktop");
  assert.equal(canPrintNow(), false, "no claim may burn while the shell would refuse the job");
  assert.equal(beatPrinterReport(), "disconnected");
  assert.equal(printBlockedMessage(), DESKTOP_NO_PRINTER_MESSAGE);
});

test("W-L: a shell with a printer chosen prints and reports connected", async (t) => {
  await installShellWithPicker(t, "Thermal 80");
  assert.equal(canPrintNow(), true);
  assert.equal(beatPrinterReport(), "connected");
});

test("W-L: an older shell without listPrinters stays connected (cannot tell) - exactly today's behaviour", (t) => {
  install(t, { shell: true });
  resetDesktopPrinterChosen();
  assert.equal(canPrintNow(), true);
  assert.equal(beatPrinterReport(), "connected");
});

test("W-L: the store follows the picker - a later save flips the answer, a failed read keeps the last one", async (t) => {
  await installShellWithPicker(t, null);
  assert.equal(canPrintNow(), false);
  const holder = globalThis as unknown as { window: { posDesktop: { listPrinters: () => Promise<unknown> } } };
  holder.window.posDesktop.listPrinters = async () => ({ selected: "Thermal 80", printers: [] });
  assert.equal(await refreshDesktopPrinterChosen(), "chosen");
  assert.equal(canPrintNow(), true);
  holder.window.posDesktop.listPrinters = async () => {
    throw new Error("shell busy");
  };
  assert.equal(await refreshDesktopPrinterChosen(), "chosen", "an unreadable shell keeps the last known choice");
});

// ---- R2-W6: the store follows savePrinter's own answer, even when the follow-up read fails ----

test("R2-W6: publishDesktopPrinterSelection maps null / '' to none and a name to chosen, and tells subscribers once per change", async (t) => {
  await installShellWithPicker(t, "Thermal 80");
  assert.equal(desktopChosen(), "chosen");
  let heard = 0;
  const off = subscribeDesktopPrinterChosen(() => void (heard += 1));
  publishDesktopPrinterSelection(null);
  assert.equal(desktopChosen(), "none");
  assert.equal(canPrintNow(), false);
  publishDesktopPrinterSelection("");
  assert.equal(desktopChosen(), "none", "an empty name is no choice either");
  publishDesktopPrinterSelection("Thermal 80");
  assert.equal(desktopChosen(), "chosen");
  assert.equal(canPrintNow(), true);
  publishDesktopPrinterSelection("Thermal 80");
  assert.equal(heard, 2, "none, then chosen -- a repeat is not a change");
  off();
});

test("R2-W6: a save followed by a FAILING re-read leaves the store on the shell's answer, not the old choice", async (t) => {
  await installShellWithPicker(t, null);
  assert.equal(canPrintNow(), false);
  const holder = globalThis as unknown as { window: { posDesktop: { listPrinters: () => Promise<unknown>; savePrinter: (n: string | null) => Promise<{ selected: string | null }> } } };
  const shell = holder.window.posDesktop;
  shell.savePrinter = async (name) => ({ selected: name });
  shell.listPrinters = async () => {
    throw new Error("shell busy");
  };
  // What DesktopPrinterPicker.choose does after the operator picks a printer.
  const result = await shell.savePrinter("Thermal 80");
  publishDesktopPrinterSelection(result.selected);
  assert.equal(await refreshDesktopPrinterChosen(), "chosen", "the unreadable follow-up keeps the published choice");
  assert.equal(canPrintNow(), true, "slips can print on the printer the shell just confirmed");
  const cleared = await shell.savePrinter(null);
  publishDesktopPrinterSelection(cleared.selected);
  assert.equal(await refreshDesktopPrinterChosen(), "none");
  assert.equal(canPrintNow(), false);
});

test("R2-W6: a slower read that started BEFORE the save cannot overwrite the published choice", async (t) => {
  await installShellWithPicker(t, null);
  const holder = globalThis as unknown as { window: { posDesktop: { listPrinters: () => Promise<unknown> } } };
  let release: (value: unknown) => void = () => undefined;
  holder.window.posDesktop.listPrinters = () => new Promise((resolve) => (release = resolve));
  const slow = refreshDesktopPrinterChosen();
  publishDesktopPrinterSelection("Thermal 80");
  release({ selected: null, printers: [] });
  assert.equal(await slow, "chosen", "the stale read is dropped");
  assert.equal(desktopChosen(), "chosen");
});

test("defaultDeviceLabel: tablet for the app or a coarse pointer, PC otherwise and always on the desktop shell", (t) => {
  install(t, { bridge: true });
  assert.equal(defaultDeviceLabel("none"), DEVICE_LABEL_TABLET);
  assert.equal(defaultDeviceLabel("raster"), DEVICE_LABEL_TABLET, "a bridge present still means the app");
  install(t, { printer: "connected", coarse: true });
  assert.equal(defaultDeviceLabel("raster"), DEVICE_LABEL_TABLET);
  install(t, { printer: "connected", coarse: false });
  assert.equal(defaultDeviceLabel("raster"), DEVICE_LABEL_PC);
  install(t, { coarse: true, shell: true });
  assert.equal(defaultDeviceLabel("desktop"), DEVICE_LABEL_PC);
  install(t, { matchMedia: false });
  assert.equal(defaultDeviceLabel("system"), DEVICE_LABEL_PC, "no matchMedia is not an error");
  assert.equal(DEVICE_LABEL_TABLET, "Counter tablet");
  assert.equal(DEVICE_LABEL_PC, "Counter PC");
});

// ---- capabilities ---------------------------------------------------------------------

test("capabilities are read from API objects at call time, and rasterCapable is their union", (t) => {
  install(t, {});
  withNavigator(t, {});
  assert.deepEqual(printCapabilities(), { serial: false, bluetooth: false, native: false });
  assert.equal(rasterCapable(), false);
  withNavigator(t, { serial: { getPorts: async () => [], requestPort: async () => ({}) } });
  assert.deepEqual(printCapabilities(), { serial: true, bluetooth: false, native: false });
  assert.equal(rasterCapable(), true);
  withNavigator(t, { bluetooth: { requestDevice: async () => ({}) } });
  assert.deepEqual(printCapabilities(), { serial: false, bluetooth: true, native: false });
  assert.equal(rasterCapable(), true);
  withNavigator(t, { serial: {}, bluetooth: {} });
  assert.equal(rasterCapable(), false, "an object without the methods is not a capability");
  withNavigator(t, {});
  install(t, { bridge: true });
  assert.deepEqual(printCapabilities(), { serial: false, bluetooth: false, native: true });
  assert.equal(rasterCapable(), true);
});

// ---- source pins ------------------------------------------------------------------------

const PRINTER_DIR = __dirname;
const HOOK_FILE = path.join(__dirname, "..", "..", "hooks", "use-device-printer.ts");

function runtimeSources(): { name: string; text: string }[] {
  const files = readdirSync(PRINTER_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ name: f, text: readFileSync(path.join(PRINTER_DIR, f), "utf8") }));
  return [...files, { name: "use-device-printer.ts", text: readFileSync(HOOK_FILE, "utf8") }];
}

// Needles are built by concatenation so this file never contains them itself.
const UA_NEEDLE = "user" + "agent";
const IDENTITY_READ = /navigator\s*\.\s*(platform|vendor|appVersion|product|brave)/;
const CONSOLE_CALL = /\bconsole\s*\./;
const CAFE_NAME = "luci" + "fer";
const SHELL_IMPORT = /from\s+["']@\/lib\/desktop-shell["']/;
const PRINT_LANE_IMPORT = /from\s+["']@\/lib\/printer\/print-lane["']/;

// Raw bytes, comments included: a banned word quoted in a comment is a failure too.
function violationsOf(files: { name: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { name, text } of files) {
    const lower = text.toLowerCase();
    if (lower.includes(UA_NEEDLE)) out.push(`${name}: reads/mentions the browser identity string`);
    if (IDENTITY_READ.test(text)) out.push(`${name}: reads a navigator identity field`);
    if (CONSOLE_CALL.test(text)) out.push(`${name}: console call`);
    if (lower.includes(CAFE_NAME)) out.push(`${name}: hard-coded cafe name`);
    if (name !== "print-lane.ts" && SHELL_IMPORT.test(text)) out.push(`${name}: imports the desktop-shell seam (only print-lane.ts may)`);
    if (name !== "print-lane.ts" && name !== "use-device-printer.ts" && PRINT_LANE_IMPORT.test(text)) out.push(`${name}: imports print-lane (one-way: print-lane imports the seam)`);
  }
  return out;
}

const EXPECTED_FILES = [
  "web-printer-types.ts",
  "capabilities.ts",
  "native-bridge-protocol.ts",
  "native-bridge.ts",
  "device-printer-store.ts",
  "device-printer.ts",
  "device-printer-link.ts",
  "device-printer-write.ts",
  "transport-serial.ts",
  "transport-ble.ts",
  "transport-native.ts",
  "print-lane.ts",
  "desktop-printer-state.ts",
  "report-debounce.ts",
  "use-device-printer.ts",
];

test("the scan sees every runtime file (positive landmark) and finds no banned read, console call or cafe name", () => {
  const files = runtimeSources();
  const names = files.map((f) => f.name);
  for (const expected of EXPECTED_FILES) assert.ok(names.includes(expected), `scanned ${expected}`);
  const byName = new Map(files.map((f) => [f.name, f.text]));
  assert.ok(byName.get("device-printer.ts")?.includes('PRINTER_OWNER_LOCK = "pos.device-printer"'), "landmark: the scan really read device-printer.ts");
  assert.ok(byName.get("print-lane.ts")?.includes("@/lib/desktop-shell"), "landmark: print-lane.ts is the one seam importer");
  assert.deepEqual(violationsOf(files), []);
});

test("the scan can bite: each banned shape in a copy of a clean file is reported", () => {
  const clean = { name: "capabilities.ts", text: "export const x = 1;\n" };
  const dirty: [string, string][] = [
    ["identity string", `const ua = navigator.${"user" + "Agent"};`],
    ["identity string, lower case", `// ${UA_NEEDLE} sniffing`],
    ["navigator field", "const p = navigator.platform;"],
    ["console", "console.log(1);"],
    ["cafe name", `const n = "${"Luci" + "fer"} cafe";`],
    ["seam import", 'import { desktopShell } from "@/lib/desktop-shell";'],
    ["print-lane import", 'import { currentLane } from "@/lib/printer/print-lane";'],
  ];
  for (const [label, line] of dirty) {
    assert.notDeepEqual(violationsOf([{ ...clean, text: clean.text + line }]), [], label);
  }
  assert.deepEqual(violationsOf([{ name: "print-lane.ts", text: 'import { desktopShell } from "@/lib/desktop-shell";' }]), []);
  assert.deepEqual(violationsOf([clean, { name: "lane-print.ts", text: 'import { x } from "@/lib/desktop-shell-document";' }]), [], "the document sibling is a different module");
});
