import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { DEVICE_WRITE_DEADLINE_MS } from "@/lib/printer/device-printer-write";
import {
  NATIVE_CONNECT_TIMEOUT_MS,
  NATIVE_PRINT_TIMEOUT_MS,
  NATIVE_PROMPT_TIMEOUT_MS,
  NATIVE_READY_EVENT,
  NATIVE_REQUEST_TIMEOUT_MS,
  NATIVE_SCAN_TIMEOUT_MS,
  bytesToBase64,
  nativeBridge,
  nativeClient,
  nativeError,
  nativeErrorCode,
  nativeOn,
  nativeRequest,
} from "@/lib/printer/native-bridge";
import * as protocol from "@/lib/printer/native-bridge-protocol";
import type { NativeMethod } from "@/lib/printer/native-bridge-protocol";

// Fake window per test (restored in t.after); the bridge is a plain object.
type Handler = (method: NativeMethod, params: unknown) => Promise<unknown>;
type Listener = (data: unknown) => void;

function installWindow(t: { after(fn: () => void): void }, win: unknown): void {
  const holder = globalThis as unknown as { window?: unknown };
  const had = Object.prototype.hasOwnProperty.call(holder, "window");
  const before = holder.window;
  holder.window = win;
  t.after(() => {
    if (had) holder.window = before;
    else delete holder.window;
  });
}

function makeBridge(handler: Handler) {
  const listeners = new Map<string, Set<Listener>>();
  const bridge = Object.freeze({
    version: 1,
    platform: "android",
    request: handler,
    on: (event: string, fn: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(fn);
      listeners.set(event, set);
      return () => void set.delete(fn);
    },
  });
  return { bridge, emit: (event: string, data: unknown) => listeners.get(event)?.forEach((fn) => fn(data)), listeners };
}

const PRINTER = { id: "AA:BB", name: "Counter", transport: "bt-classic" };
const STATUS = { state: "connected", printer: PRINTER, bluetooth: "on" };

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ---- nativeBridge: read at call time, never cached ---------------------------

test("nativeBridge is null for no window, no global, another version, or missing functions", (t) => {
  assert.equal(nativeBridge(), null);
  installWindow(t, {});
  assert.equal(nativeBridge(), null);
  const ok = makeBridge(async () => ({}));
  (globalThis as unknown as { window: { PosNative?: unknown } }).window.PosNative = { ...ok.bridge, version: 2 };
  assert.equal(nativeBridge(), null);
  (globalThis as unknown as { window: { PosNative?: unknown } }).window.PosNative = { ...ok.bridge, request: "nope" };
  assert.equal(nativeBridge(), null);
  (globalThis as unknown as { window: { PosNative?: unknown } }).window.PosNative = { ...ok.bridge, on: undefined };
  assert.equal(nativeBridge(), null);
  (globalThis as unknown as { window: { PosNative?: unknown } }).window.PosNative = ok.bridge;
  assert.equal(nativeBridge(), ok.bridge);
});

test("a late bridge is seen on the next call (nothing is cached), and a removed one is gone", (t) => {
  const win: { PosNative?: unknown } = {};
  installWindow(t, win);
  assert.equal(nativeClient(), null);
  win.PosNative = makeBridge(async () => ({})).bridge;
  assert.notEqual(nativeBridge(), null);
  assert.notEqual(nativeClient(), null);
  delete win.PosNative;
  assert.equal(nativeBridge(), null);
});

test("source pin: window.PosNative is read in exactly one place (inside nativeBridge), never held in a variable elsewhere", () => {
  const dirs = [path.join(__dirname), path.join(__dirname, "..", "..", "hooks")];
  let reads = 0;
  let where = "";
  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      if (dir === dirs[1] && file !== "use-device-printer.ts") continue;
      const code = stripComments(readFileSync(path.join(dir, file), "utf8"));
      const count = code.split("window.PosNative").length - 1;
      reads += count;
      if (count > 0) where += file;
    }
  }
  assert.equal(reads, 1);
  assert.equal(where, "native-bridge.ts");
  const code = stripComments(readFileSync(path.join(__dirname, "native-bridge.ts"), "utf8"));
  const fn = code.slice(code.indexOf("export function nativeBridge()"));
  assert.ok(fn.slice(0, fn.indexOf("\n}")).includes("window.PosNative"), "the read is inside the nativeBridge function body");
  assert.ok(code.includes('export const NATIVE_READY_EVENT = "posnative:ready";'));
  assert.equal(NATIVE_READY_EVENT, "posnative:ready");
});

// ---- timeouts ------------------------------------------------------------------

test("timeout constants honour the rulings and nest under the write deadline", () => {
  assert.equal(NATIVE_REQUEST_TIMEOUT_MS, 10_000);
  assert.equal(NATIVE_CONNECT_TIMEOUT_MS, 75_000);
  assert.equal(NATIVE_PROMPT_TIMEOUT_MS, 60_000);
  assert.equal(NATIVE_SCAN_TIMEOUT_MS, protocol.PRINTER_SCAN_MS + NATIVE_REQUEST_TIMEOUT_MS);
  assert.ok(NATIVE_PRINT_TIMEOUT_MS > 60_000, "above the app's own print limit");
  assert.ok(NATIVE_PRINT_TIMEOUT_MS < DEVICE_WRITE_DEADLINE_MS, "below the whole-write deadline");
});

test("a request that never answers rejects with code TIMEOUT at that method's limit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  installWindow(t, { PosNative: makeBridge(() => new Promise<never>(() => undefined)).bridge });
  const table: [NativeMethod, unknown, number][] = [
    ["app.info", undefined, NATIVE_REQUEST_TIMEOUT_MS],
    ["printer.status", undefined, NATIVE_REQUEST_TIMEOUT_MS],
    ["host.background", { active: true, label: "x" }, NATIVE_REQUEST_TIMEOUT_MS],
    ["printer.list", { scan: false }, NATIVE_REQUEST_TIMEOUT_MS],
    ["printer.list", { scan: true }, NATIVE_SCAN_TIMEOUT_MS],
    ["printer.select", { id: "x" }, NATIVE_CONNECT_TIMEOUT_MS],
    ["printer.reconnect", undefined, NATIVE_CONNECT_TIMEOUT_MS],
    ["printer.forget", undefined, NATIVE_CONNECT_TIMEOUT_MS],
    ["permissions.request", { kind: "bluetooth" }, NATIVE_PROMPT_TIMEOUT_MS],
    ["bluetooth.enable", undefined, NATIVE_PROMPT_TIMEOUT_MS],
    ["printer.print", { data: "AA==" }, NATIVE_PRINT_TIMEOUT_MS],
  ];
  for (const [method, params, limit] of table) {
    let outcome: unknown = "pending";
    const settled = nativeRequest(method, params).then(
      () => (outcome = "resolved"),
      (error: unknown) => (outcome = error),
    );
    t.mock.timers.tick(limit - 1);
    await flush();
    assert.equal(outcome, "pending", `${method} ${limit - 1}ms`);
    t.mock.timers.tick(1);
    await settled;
    assert.equal(nativeErrorCode(outcome), "TIMEOUT", `${method} ${limit}ms`);
  }
});

// ---- request results and errors -------------------------------------------------

test("every method's well-formed answer passes; a mismatched one is BAD_REQUEST", async (t) => {
  const answers: Record<NativeMethod, unknown> = {
    "app.info": { app: "pos-mobile", appVersion: "1.0.0", platform: "android", transports: ["ble", "tcp"] },
    "printer.status": STATUS,
    "printer.list": { printers: [PRINTER, { ...PRINTER, id: "tcp", transport: "tcp", address: "10.0.0.5", paired: false }] },
    "printer.select": STATUS,
    "printer.reconnect": STATUS,
    "printer.forget": { state: "none", printer: null, bluetooth: "off" },
    "printer.print": { bytes: 12 },
    "permissions.request": { granted: true },
    "bluetooth.enable": { on: false },
    "host.background": { active: true },
    "app.changeUrl": undefined,
    "app.battery": undefined,
  };
  installWindow(t, { PosNative: makeBridge(async (method) => answers[method]).bridge });
  for (const method of protocol.NATIVE_METHODS) {
    await assert.doesNotReject(nativeRequest(method, {}), method);
  }
  const wrong: Record<Exclude<NativeMethod, "app.changeUrl" | "app.battery">, unknown> = {
    "app.info": { app: "other-app", appVersion: "1", platform: "android", transports: [] },
    "printer.status": { state: "weird", printer: null, bluetooth: "on" },
    "printer.list": { printers: [{ id: 1 }] },
    "printer.select": null,
    "printer.reconnect": "connected",
    "printer.forget": {},
    "printer.print": { bytes: -1 },
    "permissions.request": { granted: "yes" },
    "bluetooth.enable": {},
    "host.background": { active: 1 },
  };
  for (const [method, answer] of Object.entries(wrong) as [NativeMethod, unknown][]) {
    installWindow(t, { PosNative: makeBridge(async () => answer).bridge });
    await assert.rejects(nativeRequest(method), (e: unknown) => nativeErrorCode(e) === "BAD_REQUEST", method);
  }
});

test("null address/paired from the app become absent, not a type error", async (t) => {
  installWindow(t, { PosNative: makeBridge(async () => ({ printers: [{ ...PRINTER, address: null, paired: null }] })).bridge });
  const { printers } = await nativeRequest("printer.list", { scan: false });
  assert.equal(printers[0].address, undefined);
  assert.equal(printers[0].paired, undefined);
});

test("a coded rejection passes through as the same error; uncoded ones get the method's default code", async (t) => {
  const coded = nativeError("BLUETOOTH_OFF", "Bluetooth is off");
  installWindow(t, { PosNative: makeBridge(async () => Promise.reject(coded)).bridge });
  await assert.rejects(nativeRequest("printer.reconnect"), (e: unknown) => e === coded && nativeErrorCode(e) === "BLUETOOTH_OFF");

  installWindow(t, { PosNative: makeBridge(async () => Promise.reject(new Error("raw internal text 0xDEAD"))).bridge });
  await assert.rejects(nativeRequest("printer.print", { data: "AA==" }), (e: unknown) => {
    return nativeErrorCode(e) === "WRITE_FAILED" && !(e as Error).message.includes("0xDEAD");
  });
  await assert.rejects(nativeRequest("printer.list", { scan: false }), (e: unknown) => nativeErrorCode(e) === "UNSUPPORTED");

  installWindow(t, { PosNative: makeBridge(async () => Promise.reject(Object.assign(new Error("x"), { code: "MADE_UP" }))).bridge });
  await assert.rejects(nativeRequest("app.info"), (e: unknown) => nativeErrorCode(e) === "UNSUPPORTED", "an unknown code is not trusted");
});

test("with no bridge a request rejects UNSUPPORTED instead of throwing synchronously", async () => {
  await assert.rejects(nativeRequest("printer.status"), (e: unknown) => nativeErrorCode(e) === "UNSUPPORTED");
});

test("nativeError carries its code and nativeErrorCode reads only listed codes", () => {
  for (const code of protocol.NATIVE_ERROR_CODES) assert.equal(nativeErrorCode(nativeError(code, "m")), code);
  assert.equal(nativeErrorCode(new Error("plain")), null);
  assert.equal(nativeErrorCode(null), null);
  assert.equal(nativeErrorCode("TIMEOUT"), null);
  assert.equal(nativeErrorCode(Object.assign(new Error("x"), { code: 7 })), null);
});

// ---- events ---------------------------------------------------------------------

test("nativeOn delivers valid payloads, ignores invalid ones, and the remover detaches", (t) => {
  const fake = makeBridge(async () => ({}));
  installWindow(t, { PosNative: fake.bridge });
  const statuses: unknown[] = [];
  const off = nativeOn("printer.status", (s) => statuses.push(s));
  fake.emit("printer.status", STATUS);
  fake.emit("printer.status", { state: "bogus" });
  fake.emit("printer.status", null);
  assert.equal(statuses.length, 1);
  off();
  fake.emit("printer.status", STATUS);
  assert.equal(statuses.length, 1);
});

test("app.wake carries an empty object", (t) => {
  const fake = makeBridge(async () => ({}));
  installWindow(t, { PosNative: fake.bridge });
  let wakes = 0;
  nativeOn("app.wake", () => (wakes += 1));
  fake.emit("app.wake", {});
  fake.emit("app.wake", "not an object");
  assert.equal(wakes, 1);
});

test("nativeOn without a bridge returns a harmless remover", () => {
  const off = nativeOn("app.wake", () => assert.fail("never"));
  assert.doesNotThrow(off);
});

// ---- base64 ---------------------------------------------------------------------

test("bytesToBase64 matches the platform encoder across the slice boundary", () => {
  for (const length of [0, 1, 2, 3, 100, 0x8000 - 1, 0x8000, 0x8000 + 1, 70_000]) {
    const bytes = Uint8Array.from({ length }, (_v, i) => (i * 31 + 7) & 0xff);
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString("base64"), String(length));
  }
});
