import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { acquireTabLock } from "@/lib/printer/capabilities";
import { SERIAL_RECORD, makeEnv } from "@/lib/printer/device-printer-env";
import { PortFake, SerialFake, flush } from "@/lib/printer/device-printer-fakes";
import {
  PRINTER_ELSEWHERE_MESSAGE,
  PRINTER_ELSEWHERE_STATUS_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_OWNER_LOCK,
} from "@/lib/printer/device-printer";

// One tab of a browser profile owns the printer. Everything here is a fake
// ownership grant (the Web Locks adapter itself is tested at the bottom with a
// fake navigator.locks).

function elsewhereEnv() {
  const port = new PortFake();
  const serial = new SerialFake();
  serial.granted = [port];
  const env = makeEnv({ stored: SERIAL_RECORD, serial, ownership: "elsewhere" });
  env.printer.init();
  return { env, port, serial };
}

const refused = (e: unknown): boolean => e instanceof Error && e.message === PRINTER_ELSEWHERE_MESSAGE;

test("the lock name and the two sentences are the ruled ones", () => {
  assert.equal(PRINTER_OWNER_LOCK, "pos.device-printer");
  assert.equal(PRINTER_ELSEWHERE_MESSAGE, "The printer is in use in another tab. Print from that tab, or close it.");
  assert.equal(PRINTER_ELSEWHERE_STATUS_MESSAGE, "This printer is connected in another tab of this browser.");
});

test("a non-owner tab reads the saved printer as elsewhere and opens nothing", async () => {
  const { env, port, serial } = elsewhereEnv();
  await flush();
  const snap = env.printer.getSnapshot();
  assert.equal(snap.status, "elsewhere");
  assert.equal(snap.message, PRINTER_ELSEWHERE_STATUS_MESSAGE);
  assert.deepEqual(snap.printer, SERIAL_RECORD);
  assert.equal(serial.getPortsCalls, 0);
  assert.equal(port.opens, 0);
  assert.equal(env.clock.pending(), 0, "no auto-reconnect");
});

test("a non-owner tab with nothing saved still reads elsewhere (its connect buttons must disable)", async () => {
  const env = makeEnv({ ownership: "elsewhere", serial: new SerialFake() });
  env.printer.init();
  await flush();
  assert.deepEqual(env.printer.getSnapshot(), { status: "elsewhere", printer: null, message: PRINTER_ELSEWHERE_STATUS_MESSAGE });
});

test("a non-owner tab refuses every action with the in-use sentence and touches no hardware", async () => {
  const { env, port, serial } = elsewhereEnv();
  await flush();
  serial.chooser = new PortFake();
  await assert.rejects(env.printer.connectNew("serial", "80mm"), refused);
  await assert.rejects(env.printer.connectNew("ble", "80mm"), refused);
  await assert.rejects(env.printer.selectNative({ id: "x" }, "80mm"), refused);
  await assert.rejects(env.printer.reconnect(), refused);
  await assert.rejects(env.printer.forget(), refused);
  await assert.rejects(env.printer.write(new Uint8Array(3)), refused);
  assert.throws(() => env.printer.setPaper("58mm"), refused);
  assert.equal(serial.requestCalls, 0, "the chooser never opened");
  assert.equal(serial.getPortsCalls, 0);
  assert.equal(port.opens + port.writeAttempts + port.closes + port.forgets, 0);
  assert.deepEqual(env.store.value, SERIAL_RECORD, "the saved printer was not touched");
  assert.equal(env.store.writes, 0);
});

test("before the lock is decided nothing can print or connect (unknown role refuses, not-connected)", async () => {
  const serial = new SerialFake();
  serial.granted = [new PortFake()];
  const env = makeEnv({ stored: SERIAL_RECORD, serial, ownership: "manual" });
  env.printer.init();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "connecting");
  assert.equal(serial.getPortsCalls, 0);
  await assert.rejects(env.printer.write(new Uint8Array(1)), (e: unknown) => (e as Error).message === PRINTER_NOT_CONNECTED_MESSAGE);
  await assert.rejects(env.printer.connectNew("serial", "80mm"), (e: unknown) => (e as Error).message === PRINTER_NOT_CONNECTED_MESSAGE);
});

test("a queued tab is promoted when the owner goes away: it opens the printer then", async () => {
  const { env, port } = elsewhereEnv();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "elsewhere");
  env.grant();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "connected");
  assert.equal(port.opens, 1);
  env.grant();
  await flush();
  assert.equal(port.opens, 1, "a second grant changes nothing");
});

test("a non-owner follows the saved printer when another tab changes or clears it", async () => {
  const { env } = elsewhereEnv();
  await flush();
  env.store.value = null;
  env.storeChanged();
  assert.deepEqual(env.printer.getSnapshot(), { status: "elsewhere", printer: null, message: PRINTER_ELSEWHERE_STATUS_MESSAGE });
  env.store.value = { ...SERIAL_RECORD, paper: "58mm" };
  env.storeChanged();
  assert.equal(env.printer.getSnapshot().status, "elsewhere");
  assert.equal(env.printer.getSnapshot().printer?.paper, "58mm");
});

test("an owner ignores storage events from other tabs", async () => {
  const port = new PortFake();
  const serial = new SerialFake();
  serial.granted = [port];
  const env = makeEnv({ stored: SERIAL_RECORD, serial });
  env.printer.init();
  await flush();
  env.store.value = null;
  env.storeChanged();
  assert.equal(env.printer.getSnapshot().status, "connected");
});

// ---- the Web Locks adapter ------------------------------------------------------------

interface LockCall {
  name: string;
  ifAvailable: boolean;
  callback: (lock: unknown) => unknown;
}

function fakeLocks(held: boolean) {
  const calls: LockCall[] = [];
  const locks = {
    request: (name: string, a: unknown, b?: unknown): Promise<unknown> => {
      const ifAvailable = typeof a === "object" && a !== null && (a as { ifAvailable?: boolean }).ifAvailable === true;
      const callback = (typeof a === "function" ? a : b) as (lock: unknown) => unknown;
      calls.push({ name, ifAvailable, callback });
      if (ifAvailable) return Promise.resolve(callback(held ? null : { name }));
      return new Promise<unknown>(() => undefined); // queued behind the holder until the test grants it
    },
  };
  return { locks, calls };
}

function withLocks(t: { after(fn: () => void): void }, locks: object | undefined): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: locks === undefined ? {} : { locks }, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });
}

async function neverSettles(promise: unknown): Promise<boolean> {
  const sentinel = Symbol("sentinel");
  return (await Promise.race([Promise.resolve(promise), flush().then(() => sentinel)])) === sentinel;
}

test("acquireTabLock: without Web Locks the tab is the owner at once", (t) => {
  withLocks(t, undefined);
  const events: string[] = [];
  acquireTabLock("x", () => events.push("owner"), () => events.push("elsewhere"));
  assert.deepEqual(events, ["owner"]);
});

test("acquireTabLock: a free lock makes this tab the owner and the hold never settles", async (t) => {
  const { locks, calls } = fakeLocks(false);
  withLocks(t, locks);
  const events: string[] = [];
  acquireTabLock(PRINTER_OWNER_LOCK, () => events.push("owner"), () => events.push("elsewhere"));
  assert.deepEqual(events, ["owner"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, PRINTER_OWNER_LOCK);
  assert.equal(calls[0].ifAvailable, true);
  assert.equal(await neverSettles(calls[0].callback({ name: "x" })), true, "the held promise never settles (held for the tab's life)");
});

test("acquireTabLock: a held lock says elsewhere at once, queues, and promotes when the holder closes", async (t) => {
  const { locks, calls } = fakeLocks(true);
  withLocks(t, locks);
  const events: string[] = [];
  acquireTabLock(PRINTER_OWNER_LOCK, () => events.push("owner"), () => events.push("elsewhere"));
  await flush();
  assert.deepEqual(events, ["elsewhere"]);
  assert.equal(calls.length, 2, "a second, queued request");
  assert.equal(calls[1].ifAvailable, false);
  const hold = calls[1].callback({ name: PRINTER_OWNER_LOCK });
  assert.deepEqual(events, ["elsewhere", "owner"]);
  assert.equal(await neverSettles(hold), true);
});

test("acquireTabLock: a lock API that throws fails open to owner", async (t) => {
  withLocks(t, { request: () => Promise.reject(new Error("SecurityError")) });
  const events: string[] = [];
  acquireTabLock("x", () => events.push("owner"), () => events.push("elsewhere"));
  await flush();
  assert.deepEqual(events, ["owner"]);
});

test("source pin: the lock is requested in device-printer.ts by name and held with a never-settling promise", () => {
  const printer = stripComments(readFileSync(path.join(__dirname, "device-printer.ts"), "utf8"));
  const caps = stripComments(readFileSync(path.join(__dirname, "capabilities.ts"), "utf8"));
  assert.ok(printer.includes("acquireTabLock(PRINTER_OWNER_LOCK, onOwner, onElsewhere)"));
  assert.ok(caps.includes("ifAvailable: true"));
  assert.ok(caps.includes("new Promise<never>(() => undefined)"), "the documented infinite hold");
  assert.equal(caps.split("hold()").length - 1, 2, "both grant paths hold");
});

// ---- source pins ---------------------------------------------------------------------

const sourceOf = (file: string): string => stripComments(readFileSync(path.join(__dirname, file), "utf8"));

test("source pin: the resend lives in one place — exactly two send calls in the write pipeline (try + the one resend)", () => {
  const code = sourceOf("device-printer-write.ts");
  assert.equal(code.split("host.send(").length - 1, 2);
  assert.ok(code.includes("the ONE resend") === false, "comments are stripped, so the pin reads code only");
  assert.ok(/host\.now\(\) - job\.enqueuedAt >= DEVICE_WRITE_DEADLINE_MS/.test(code), "landmark: the fast-failure gate");
  assert.ok(code.includes('code !== "NOT_CONNECTED"'), "only a pre-write refusal permits a resend");
});

test("source pin: every mutating entry point of the runtime checks ownership first", () => {
  const code = sourceOf("device-printer.ts");
  for (const name of ["connectNew", "selectNative", "reconnect", "setPaper", "forget"]) {
    const match = new RegExp(`${name}\\([^)]*\\)[^{]*\\{\\s*requireOwner\\(\\);`).exec(code);
    assert.ok(match, `${name} starts with requireOwner()`);
  }
  assert.ok(/createWriteQueue\(\{\s*requireOwner,/.test(code), "the write queue gets the owner check");
  assert.ok(sourceOf("device-printer-write.ts").includes("host.requireOwner();"), "and calls it before any send");
});
