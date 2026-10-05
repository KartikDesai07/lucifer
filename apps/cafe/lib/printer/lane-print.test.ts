import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { UseReactToPrintOptions } from "react-to-print";

import { DESKTOP_PRINT_EMPTY_MESSAGE, slipPrintOptions } from "@/lib/desktop-shell";
import { rasterCapable } from "@/lib/printer/capabilities";
import { setDevicePrinterInstance, type DevicePrinterRuntime } from "@/lib/printer/device-printer";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import { CUT_PARTIAL_WITH_FEED, ESC_INIT, GS_RASTER_HEADER, RASTER_MAX_ROWS, escposJob, rasterizeRgba } from "@/lib/printer/escpos";
import { LANE_PRINT_FAILED_MESSAGE, LANE_RASTER_DEADLINE_MS, NO_PRINTER_MESSAGE, SYSTEM_PRINT_SETTLE_MS, laneFailureMessage, laneSlipPrintOptions, setLaneRasterizer, setLaneSleep, setLaneToast } from "@/lib/printer/lane-print";
import { nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_ERROR_CODES } from "@/lib/printer/native-bridge-protocol";
import { RASTER_FAILED_MESSAGE, RASTER_TOO_LARGE_MESSAGE } from "@/lib/printer/raster";
import { setNativePoolInstance, type NativePool } from "@/lib/printer/native-pool";
import { nativeErrorMessage } from "@/lib/printer/transport-native";
import { PRINTER_ELSEWHERE_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE, type PrinterSnapshot } from "@/lib/printer/web-printer-types";

// The lane half of the print seam, driven through the real seam
// (slipPrintOptions) with a fake window/navigator, a fake device printer
// runtime and a fake slip drawing. Everything global is restored in t.after.

const PRINTER: DevicePrinter = { kind: "serial", name: "Bluetooth printer", paper: "80mm" };
const PRINTER_58: DevicePrinter = { kind: "serial", name: "Bluetooth printer", paper: "58mm" };
const BRIDGE = Object.freeze({ version: 1, platform: "android", request: async () => ({}), on: () => () => undefined });
const SERIAL = { getPorts: async () => [], requestPort: async () => ({}) };
const SHELL_MARKER = "SHELL-SLIP-MARKER";

type After = { after(fn: () => void): void };

function installWindow(t: After, win: object): void {
  const holder = globalThis as unknown as { window?: unknown };
  const had = Object.prototype.hasOwnProperty.call(holder, "window");
  const before = holder.window;
  holder.window = win;
  t.after(() => {
    if (had) holder.window = before;
    else delete holder.window;
  });
}

function withNavigator(t: After, fake: object): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: fake, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });
}

interface RuntimeState {
  snapshot: PrinterSnapshot;
  writes: Uint8Array[];
  writeError: Error | null;
}

function installRuntime(t: After, printer: DevicePrinter | null, status: PrinterSnapshot["status"] = printer ? "connected" : "none"): RuntimeState {
  const state: RuntimeState = { snapshot: { status, printer, message: null }, writes: [], writeError: null };
  setDevicePrinterInstance({
    getSnapshot: () => state.snapshot,
    write: async (bytes: Uint8Array) => {
      if (state.writeError) throw state.writeError;
      state.writes.push(bytes);
    },
  } as unknown as DevicePrinterRuntime);
  t.after(() => setDevicePrinterInstance(null));
  return state;
}

// A fake print iframe that logs every title change and the print call, in order.
function loggedIframe(events: string[], extra: object = {}): HTMLIFrameElement {
  const titled = (label: string, initial: string) => {
    let value = initial;
    return {
      get title() {
        return value;
      },
      set title(next: string) {
        events.push(`${label}:${next}`);
        value = next;
      },
    };
  };
  return {
    contentWindow: { print: () => void events.push("print") },
    contentDocument: titled("frame-title", ""),
    ownerDocument: titled("page-title", "Page"),
    ...extra,
  } as unknown as HTMLIFrameElement;
}

// RGBA, opaque white, with the listed rows solid black.
function slipPixels(width: number, height: number, inkRows: number[]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const y of inkRows) {
    for (let x = 0; x < width; x++) pixels.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  return pixels;
}

// A browser with Web Serial and a device printer runtime in the given state.
function serialScene(t: After, printer: DevicePrinter | null, status?: PrinterSnapshot["status"]): RuntimeState {
  installWindow(t, {});
  withNavigator(t, { serial: SERIAL });
  return installRuntime(t, printer, status);
}

function installFakeSlip(t: After, drawn: { pixels: Uint8ClampedArray; width: number; height: number }): number[] {
  const asked: number[] = [];
  setLaneRasterizer(async (_iframe, dots) => {
    asked.push(dots);
    return drawn;
  });
  t.after(() => setLaneRasterizer(null));
  return asked;
}

test("a native bridge with no printer: slipPrintOptions wraps the options, and print() rejects with the no-printer sentence without ever opening the print window", async (t) => {
  installWindow(t, { PosNative: BRIDGE });
  installRuntime(t, null);
  const events: string[] = [];
  const options: UseReactToPrintOptions = { documentTitle: "Slip" };
  const wrapped = slipPrintOptions(options);

  assert.notStrictEqual(wrapped, options, "the app bridge makes the runtime raster-capable, so the options must be wrapped");
  assert.equal(typeof wrapped.print, "function", "the wrapped options must carry a print override");
  await assert.rejects(() => wrapped.print!(loggedIframe(events)), { message: NO_PRINTER_MESSAGE });
  assert.equal(NO_PRINTER_MESSAGE, "No printer is set up on this device. Tap the printer icon to set one up.");
  assert.deepEqual(events, [], "the print window must never be opened (and no title touched) inside the app");
});

test("no printer capability at all: the SAME options reference comes back", (t) => {
  installWindow(t, {});
  withNavigator(t, {});
  installRuntime(t, null);
  const options = { documentTitle: "Slip", pageStyle: "x" };
  assert.strictEqual(slipPrintOptions(options), options);
  assert.strictEqual(laneSlipPrintOptions(options), options);
});

test("serial capability and no printer: the system lane runs the library's own sequence (title swap, print once, restore, settle 500 ms)", async (t) => {
  serialScene(t, null);
  const events: string[] = [];
  setLaneSleep(async (ms) => void events.push(`sleep:${ms}`));
  const wrapped = slipPrintOptions<UseReactToPrintOptions>({ documentTitle: () => "Slip" });

  assert.equal(typeof wrapped.print, "function");
  await wrapped.print!(loggedIframe(events));
  assert.deepEqual(events, ["page-title:Slip", "frame-title:Slip", "print", "page-title:Page", "frame-title:", `sleep:${SYSTEM_PRINT_SETTLE_MS}`]);
  assert.equal(SYSTEM_PRINT_SETTLE_MS, 500);
});

test("the system lane without a document title never touches the titles", async (t) => {
  serialScene(t, null);
  const events: string[] = [];
  setLaneSleep(async (ms) => void events.push(`sleep:${ms}`));
  await slipPrintOptions<UseReactToPrintOptions>({}).print!(loggedIframe(events));
  assert.deepEqual(events, ["print", "sleep:500"]);
});

test("call time: a printer configured AFTER the options were wrapped is used by the next job (and one removed after is not)", async (t) => {
  const state = serialScene(t, null);
  const asked = installFakeSlip(t, { pixels: slipPixels(576, 4, [0, 1]), width: 576, height: 4 });
  const events: string[] = [];
  setLaneSleep(async (ms) => void events.push(`sleep:${ms}`));
  const wrapped = slipPrintOptions<UseReactToPrintOptions>({ documentTitle: "Slip" });

  state.snapshot = { status: "connected", printer: PRINTER, message: null };
  await wrapped.print!(loggedIframe(events));
  // length, not deepEqual(events, []): the assertion signature would narrow `events` to never[] for the rest of the test
  assert.equal(events.length, 0, "a configured printer never opens the print window");
  assert.deepEqual(asked, [576], "80mm paper draws 576 dots wide");
  assert.equal(state.writes.length, 1);
  const job = state.writes[0] as Uint8Array;
  assert.deepEqual([...job.subarray(0, 2)], [...ESC_INIT]);
  assert.deepEqual([...job.subarray(2, 6)], [...GS_RASTER_HEADER]);
  assert.equal(job[6], 72, "xL = 576 / 8 bytes per row");
  assert.deepEqual([...job.subarray(job.length - 4)], [...CUT_PARTIAL_WITH_FEED]);
  const bitmap = rasterizeRgba(slipPixels(576, 4, [0, 1]), 576, 4, 576);
  assert.deepEqual([...job], [...escposJob(bitmap)], "the bytes are exactly the encoded raster of what was drawn");

  state.snapshot = { status: "none", printer: null, message: null };
  await wrapped.print!(loggedIframe(events));
  assert.ok(events.includes("print"), "with the printer gone the same wrapped options fall back to the print window");
});

test("58 mm paper draws 384 dots wide", async (t) => {
  serialScene(t, PRINTER_58);
  const asked = installFakeSlip(t, { pixels: slipPixels(384, 2, [0]), width: 384, height: 2 });
  await slipPrintOptions<UseReactToPrintOptions>({}).print!(loggedIframe([]));
  assert.deepEqual(asked, [384]);
});

// Phase 2 Session 2F1 (spec §9.2): a printer job for one of the POS app's printers names it by the app's id: it is drawn
// at that printer's paper and written to it through the app's list on bridge v2, the device's own printer included (the
// 2E gate's review, I-2). A slip with no target goes to the device's own printer (devicePrinter(), v1), as before.
test("2F1: a slip with a raster target is drawn at its paper and written to that printer of the app by its id; one with no target to the device's own", async (t) => {
  installWindow(t, { PosNative: BRIDGE });
  const own = installRuntime(t, { kind: "native", name: "Counter", paper: "80mm", printerId: "tcp:10.0.2.2:9100", transport: "tcp" });
  const pool: Array<{ id: string; bytes: number }> = [];
  setNativePoolInstance({ write: async (id: string, bytes: Uint8Array) => void pool.push({ id, bytes: bytes.length }), printerOf: () => null } as unknown as NativePool);
  t.after(() => setNativePoolInstance(null));
  const asked = installFakeSlip(t, { pixels: slipPixels(384, 2, [0]), width: 384, height: 2 });
  await slipPrintOptions<UseReactToPrintOptions>({}, undefined, { nativeId: "tcp:10.0.2.2:9101", paper: "58mm" }).print!(loggedIframe([]));
  assert.deepEqual(asked, [384], "drawn at the bar printer's 58 mm, not the device printer's 80 mm");
  assert.deepEqual([pool.map((p) => p.id), own.writes.length], [["tcp:10.0.2.2:9101"], 0], "written to the bar printer of the app only");
  await slipPrintOptions<UseReactToPrintOptions>({}, undefined, { nativeId: "tcp:10.0.2.2:9100", paper: "80mm" }).print!(loggedIframe([]));
  assert.deepEqual([pool.map((p) => p.id), own.writes.length], [["tcp:10.0.2.2:9101", "tcp:10.0.2.2:9100"], 0], "the device's own printer too, by its id (never the app's default of the moment)");
  await slipPrintOptions<UseReactToPrintOptions>({}).print!(loggedIframe([]));
  assert.deepEqual([pool.length, own.writes.length], [2, 1], "no target: the device's own printer, as before");
});

test("a printer in another tab (status elsewhere): print() rejects with the elsewhere sentence and writes nothing", async (t) => {
  const state = serialScene(t, PRINTER, "elsewhere");
  const asked = installFakeSlip(t, { pixels: slipPixels(576, 2, [0]), width: 576, height: 2 });
  const events: string[] = [];
  await assert.rejects(() => slipPrintOptions<UseReactToPrintOptions>({}).print!(loggedIframe(events)), { message: PRINTER_ELSEWHERE_MESSAGE });
  assert.equal(state.writes.length, 0);
  assert.deepEqual(asked, [], "the slip is not even drawn");
  assert.deepEqual(events, []);
});

test("refusals reach the caller as their own sentence and nothing is written: blank drawing, drawing past RASTER_MAX_ROWS, device write failure", async (t) => {
  const tall = RASTER_MAX_ROWS + 1;
  const scenes: [string, DevicePrinter, { pixels: Uint8ClampedArray; width: number; height: number }, string, Error | null][] = [
    ["blank", PRINTER, { pixels: slipPixels(576, 3, []), width: 576, height: 3 }, DESKTOP_PRINT_EMPTY_MESSAGE, null],
    ["too long", PRINTER_58, { pixels: slipPixels(384, tall, [tall - 1]), width: 384, height: tall }, RASTER_TOO_LARGE_MESSAGE, null],
    ["write failed", PRINTER, { pixels: slipPixels(576, 2, [0]), width: 576, height: 2 }, PRINTER_WRITE_FAILED_MESSAGE, new Error(PRINTER_WRITE_FAILED_MESSAGE)],
  ];
  const state = serialScene(t, null);
  for (const [label, printer, drawn, message, writeError] of scenes) {
    state.snapshot = { status: "connected", printer, message: null };
    state.writeError = writeError;
    installFakeSlip(t, drawn);
    await assert.rejects(() => slipPrintOptions<UseReactToPrintOptions>({}).print!(loggedIframe([])), { message }, label);
    assert.equal(state.writes.length, 0, label);
  }
});

test("raster deadline: a drawing that never finishes fails with the prepare sentence at LANE_RASTER_DEADLINE_MS, not before, and writes nothing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const state = serialScene(t, PRINTER);
  setLaneRasterizer(() => new Promise(() => undefined));
  t.after(() => setLaneRasterizer(null));

  let outcome: unknown = "pending";
  const job = slipPrintOptions<UseReactToPrintOptions>({}).print!(loggedIframe([])).catch((error: unknown) => {
    outcome = error;
  });
  t.mock.timers.tick(LANE_RASTER_DEADLINE_MS - 1);
  await Promise.resolve();
  // `as unknown` keeps the assertion from narrowing `outcome` to the "pending" literal (it changes in the catch)
  assert.equal(outcome as unknown, "pending", "one ms early it is still drawing");
  t.mock.timers.tick(1);
  await job;
  assert.ok(outcome instanceof Error && outcome.message === RASTER_FAILED_MESSAGE, "the deadline fails with the prepare sentence");
  assert.equal(state.writes.length, 0);
  assert.equal(LANE_RASTER_DEADLINE_MS, 12_000);
});

test("a desktop shell beats the printer lanes: print goes through the shell, nothing is drawn or written", async (t) => {
  const sent: string[] = [];
  installWindow(t, { posDesktop: { version: "1.0.0", printHtml: async (html: string) => void sent.push(html) } });
  withNavigator(t, { serial: SERIAL });
  const state = installRuntime(t, PRINTER);
  const asked = installFakeSlip(t, { pixels: slipPixels(576, 2, [0]), width: 576, height: 2 });
  const iframe = { contentDocument: { title: "", documentElement: { outerHTML: `<html><head></head><body>${SHELL_MARKER}</body></html>` } } } as unknown as HTMLIFrameElement;

  await slipPrintOptions<UseReactToPrintOptions>({ documentTitle: "Slip" }).print!(iframe);
  assert.equal(sent.length, 1);
  assert.ok((sent[0] as string).includes(SHELL_MARKER));
  assert.deepEqual(asked, []);
  assert.equal(state.writes.length, 0);
});

test("the default onPrintError toasts the lane sentence (or the generic one) and then calls onAfterPrint", (t) => {
  installWindow(t, { PosNative: BRIDGE });
  installRuntime(t, null);
  const toasts: string[] = [];
  setLaneToast((message) => void toasts.push(message));
  let after = 0;
  const wrapped = slipPrintOptions<UseReactToPrintOptions>({ onAfterPrint: () => void (after += 1) });

  wrapped.onPrintError!("print", new Error(NO_PRINTER_MESSAGE));
  wrapped.onPrintError!("print", new Error("TypeError: x is not a function at internal.js:1"));
  assert.deepEqual(toasts, [NO_PRINTER_MESSAGE, LANE_PRINT_FAILED_MESSAGE], "an internal error text is never shown");
  assert.equal(after, 2, "onAfterPrint runs after every failure so the caller's bookkeeping settles");
  assert.doesNotThrow(() => slipPrintOptions<UseReactToPrintOptions>({}).onPrintError!("print", new Error("x")), "no onAfterPrint is fine");
});

test("a caller's own onPrintError is kept by identity and nothing is toasted", (t) => {
  installWindow(t, { PosNative: BRIDGE });
  installRuntime(t, null);
  let toasted = false;
  setLaneToast(() => void (toasted = true));
  const own = (_where: "onBeforePrint" | "print", _error: Error): void => undefined;
  const options: UseReactToPrintOptions = { onPrintError: own, pageStyle: "p" };
  const wrapped = slipPrintOptions(options);

  assert.notStrictEqual(wrapped, options);
  assert.strictEqual(wrapped.onPrintError, own);
  assert.equal(wrapped.pageStyle, "p", "other keys are carried over");
  wrapped.onPrintError!("print", new Error("whatever"));
  assert.equal(toasted, false);
});

test("laneFailureMessage: lane sentences pass, every app-bridge error sentence passes, anything else is null", () => {
  for (const message of [NO_PRINTER_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE, PRINTER_ELSEWHERE_MESSAGE, RASTER_FAILED_MESSAGE, RASTER_TOO_LARGE_MESSAGE, DESKTOP_PRINT_EMPTY_MESSAGE]) {
    assert.equal(laneFailureMessage(new Error(message)), message);
  }
  for (const code of NATIVE_ERROR_CODES) {
    const sentence = nativeErrorMessage(nativeError(code, "raw"));
    assert.equal(laneFailureMessage(new Error(sentence)), sentence, code);
  }
  assert.equal(laneFailureMessage(new Error("boom")), null);
  assert.equal(laneFailureMessage(NO_PRINTER_MESSAGE), null, "only Error instances count");
  assert.equal(laneFailureMessage(null), null);
});

// ---- s63 fix round FX-A: W-A (a) the settle wait, W-K the app's WebView ------------------------

// A fake clock for the lane: print() "takes" `blockedMs` of it, like a print dialog that stays open.
function fakeClock(t: TestContext): { advance(ms: number): void } {
  let now = 1_000;
  t.mock.method(performance, "now", () => now);
  return { advance: (ms) => void (now += ms) };
}

function iframeWhosePrintTakes(events: string[], clock: { advance(ms: number): void }, ms: number): HTMLIFrameElement {
  return loggedIframe(events, { contentWindow: { print: () => void (events.push("print"), clock.advance(ms)) } });
}

test("W-A: a print() that BLOCKED (the dialog stayed open) is followed by NO settle wait - onAfterPrint must not trail the dialog by 500 ms", async (t) => {
  serialScene(t, null);
  const clock = fakeClock(t);
  const events: string[] = [];
  setLaneSleep(async (ms) => void events.push(`sleep:${ms}`));
  await slipPrintOptions<UseReactToPrintOptions>({}).print!(iframeWhosePrintTakes(events, clock, SYSTEM_PRINT_SETTLE_MS));
  assert.deepEqual(events, ["print"], "a blocking print has already waited; the extra settle sleep is the regression");
});

test("W-A: a print() that returned at once (non-blocking) still gets the full settle wait; one ms under the threshold counts as fast", async (t) => {
  serialScene(t, null);
  const clock = fakeClock(t);
  const events: string[] = [];
  setLaneSleep(async (ms) => void events.push(`sleep:${ms}`));
  const wrapped = slipPrintOptions<UseReactToPrintOptions>({});
  await wrapped.print!(iframeWhosePrintTakes(events, clock, 0));
  await wrapped.print!(iframeWhosePrintTakes(events, clock, SYSTEM_PRINT_SETTLE_MS - 1));
  assert.deepEqual(events, ["print", `sleep:${SYSTEM_PRINT_SETTLE_MS}`, "print", `sleep:${SYSTEM_PRINT_SETTLE_MS}`]);
});

test("W-A: print() runs in the SAME task as the call - nothing is awaited before it (react-to-print dispatches from a timer)", (t) => {
  serialScene(t, null);
  const events: string[] = [];
  setLaneSleep(async () => undefined);
  void slipPrintOptions<UseReactToPrintOptions>({ documentTitle: "Slip" }).print!(loggedIframe(events));
  assert.ok(events.includes("print"), "print() must already have run when the call returns its promise");
});

test("W-K: inside the POS app's WebView (the injected ReactNativeWebView object, bridge not yet arrived) the runtime is raster-capable and a printerless print fails loud", async (t) => {
  installWindow(t, { ReactNativeWebView: { postMessage: () => undefined } });
  withNavigator(t, {});
  installRuntime(t, null);
  const events: string[] = [];
  const options: UseReactToPrintOptions = { documentTitle: "Slip" };
  const wrapped = slipPrintOptions(options);
  assert.equal(rasterCapable(), true, "the capability object alone decides - never the browser identity");
  assert.notStrictEqual(wrapped, options, "options are wrapped so print() can refuse");
  await assert.rejects(() => wrapped.print!(loggedIframe(events)), { message: NO_PRINTER_MESSAGE });
  assert.deepEqual(events, [], "window.print is a no-op in the app's WebView; the print window must not be opened");
});

test("W-K: a plain browser with neither the bridge nor ReactNativeWebView keeps the print window", async (t) => {
  serialScene(t, null);
  setLaneSleep(async () => undefined);
  const events: string[] = [];
  await slipPrintOptions<UseReactToPrintOptions>({}).print!(loggedIframe(events));
  assert.ok(events.includes("print"));
});
