import { test } from "node:test";
import assert from "node:assert/strict";

import { flush, makeClock } from "@/lib/printer/device-printer-fakes";
import { NATIVE_REQUEST_TIMEOUT_MS, nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_BRIDGE_V2, nativeV2Bridge, nativeV2Client, nativeV2Request, type NativePoolStatus, type NativeV2Client } from "@/lib/printer/native-bridge-v2";
import { EMPTY_POOL, connectedPoolKey, createNativePool, poolDefaultCannotPrint, poolSnapshotOf } from "@/lib/printer/native-pool";
import { readFileSync } from "node:fs";
import { PRINTER_CONNECT_FAILED_MESSAGE } from "@/lib/printer/device-printer-link";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Phase 2 Session 2F1 (spec §9.2, plan decision 12): the page half of bridge v2 and the app's printers mirrored on the
// page, driven by a fake app that speaks v2. The app half is Session 2F2's.

const KITCHEN = { id: "tcp:10.0.2.2:9100", name: "Network printer 10.0.2.2", transport: "tcp" as const, address: "10.0.2.2:9100" };
const BAR = { id: "tcp:10.0.2.2:9101", name: "Network printer 10.0.2.2", transport: "tcp" as const, address: "10.0.2.2:9101" };
const BT = { id: "bt-classic:00:11:22:33:44:55", name: "RPP02N", transport: "bt-classic" as const, address: "00:11:22:33:44:55", paired: true };

type Entry = { state: "connecting" | "connected" | "disconnected"; printer: typeof KITCHEN | typeof BT };

/** A fake app on bridge v2: its printers, every v2 request it was sent, and its status event. */
function fakeApp(initial: Entry[], defaultId: string | null) {
  const app = {
    printers: [...initial],
    defaultId,
    requests: [] as Array<{ method: string; params: unknown }>,
    printed: [] as Array<{ printerId: string; bytes: number }>,
    hold: new Map<string, Array<() => void>>(),
    refuse: new Set<string>(),
    listener: null as ((status: NativePoolStatus) => void) | null,
  };
  const status = (): NativePoolStatus => ({ printers: app.printers.map((p) => ({ ...p })), defaultId: app.defaultId, bluetooth: "on" });
  const client: NativeV2Client = {
    request: (async (method: string, params?: unknown) => {
      app.requests.push({ method, params });
      const p = (params ?? {}) as { printerId?: string; data?: string; id?: string; tcp?: { host: string; port: number } };
      if (method === "printer.print") {
        const id = p.printerId ?? "";
        if (app.refuse.has(id)) throw nativeError("NOT_CONNECTED", "The printer is not connected.");
        const gate = app.hold.get(id);
        if (gate !== undefined) await new Promise<void>((resolve) => gate.push(resolve));
        const bytes = Buffer.from(p.data ?? "", "base64").length;
        app.printed.push({ printerId: id, bytes });
        return { bytes };
      }
      if (method === "printer.select") {
        const id = p.id ?? `tcp:${p.tcp?.host}:${p.tcp?.port}`;
        if (!app.printers.some((e) => e.printer.id === id)) app.printers.push({ state: "connected", printer: { ...KITCHEN, id, address: id.slice(4) } });
        app.defaultId ??= id;
      }
      if (method === "printer.forget") {
        app.printers = app.printers.filter((e) => e.printer.id !== p.printerId);
        if (app.defaultId === p.printerId) app.defaultId = app.printers[0]?.printer.id ?? null;
      }
      return status();
    }) as NativeV2Client["request"],
    onStatus: (fn) => {
      app.listener = fn;
      return () => void (app.listener = null);
    },
  };
  const emit = (): void => app.listener?.(status());
  return { app, client, emit };
}

function poolWith(client: NativeV2Client | null) {
  const clock = makeClock();
  const pool = createNativePool({ v2: () => client, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onNativeReady: () => () => undefined });
  return { pool, clock };
}

test("2F1: an app that speaks only v1 (the release APK) leaves the pool empty and inactive", async () => {
  const { pool } = poolWith(null);
  pool.init();
  await flush();
  assert.equal(pool.getSnapshot(), EMPTY_POOL, "nothing to mirror: the device prints its one printer as before");
  await assert.rejects(pool.add({ tcp: { host: "10.0.2.2", port: 9101 } }), new RegExp(PRINTER_NOT_CONNECTED_MESSAGE.slice(0, 20)));
});

test("2F1: the app's printers are read at start and followed; an unchanged list keeps the snapshot as it was", async () => {
  const { app, client, emit } = fakeApp([{ state: "connected", printer: KITCHEN }, { state: "connecting", printer: BT }], KITCHEN.id);
  const { pool } = poolWith(client);
  let changes = 0;
  pool.subscribe(() => (changes += 1));
  pool.init();
  await flush();
  const first = pool.getSnapshot();
  assert.deepEqual([first.active, first.defaultId, first.printers.map((p) => [p.id, p.status, p.printer.kind, p.printer.transport])], [true, KITCHEN.id, [[KITCHEN.id, "connected", "native", "tcp"], [BT.id, "connecting", "native", "bt-classic"]]], "every printer of the app, the default named");
  assert.deepEqual(app.requests.map((r) => r.method), ["printer.status"], "one read of the list");
  emit();
  assert.equal(pool.getSnapshot(), first, "the same list again: the very same snapshot, no change for readers");
  app.printers[1] = { state: "connected", printer: BT };
  emit();
  assert.equal(pool.printerOf(BT.id)?.status, "connected", "a change of one printer is seen");
  assert.equal(changes, 2, "two changes: the first read and the reconnect");
});

test("2F1: adding a printer selects it in the app (v2) and says whether it connected; removing it forgets it there", async () => {
  const { app, client } = fakeApp([{ state: "connected", printer: KITCHEN }], KITCHEN.id);
  const { pool } = poolWith(client);
  pool.init();
  await flush();
  assert.equal(await pool.add({ tcp: { host: "10.0.2.2", port: 9101 } }), "connected");
  assert.deepEqual(app.requests[1], { method: "printer.select", params: { tcp: { host: "10.0.2.2", port: 9101 } } }, "the target as v1 sends it, in a v2 envelope");
  assert.deepEqual(pool.getSnapshot().printers.map((p) => p.id), [KITCHEN.id, BAR.id], "the new printer beside the device's own");
  assert.equal(pool.getSnapshot().defaultId, KITCHEN.id, "the default unchanged");
  await pool.remove(BAR.id);
  assert.deepEqual(app.requests[2], { method: "printer.forget", params: { printerId: BAR.id } });
  assert.deepEqual(pool.getSnapshot().printers.map((p) => p.id), [KITCHEN.id]);
  app.printers.push({ state: "disconnected", printer: { ...BAR } });
  assert.equal(await pool.reconnect(BAR.id), "failed", "the app's answer says it is still down");
  assert.deepEqual(app.requests[3], { method: "printer.reconnect", params: { printerId: BAR.id } });
});

test("2F1: a v2 request the app could not answer rejects with the sentence to show; a timed-out connect says to try again", async () => {
  const failing: NativeV2Client = {
    request: (async (method: string) => {
      if (method === "printer.status") return { printers: [], defaultId: null, bluetooth: "on" };
      throw nativeError(method === "printer.select" ? "TIMEOUT" : "BLUETOOTH_OFF", "x");
    }) as NativeV2Client["request"],
    onStatus: () => () => undefined,
  };
  const { pool } = poolWith(failing);
  pool.init();
  await flush();
  await assert.rejects(pool.add({ id: BT.id }), (error: Error) => error.message === PRINTER_CONNECT_FAILED_MESSAGE, "a slow connect may still finish in the app");
  await assert.rejects(pool.reconnect(BT.id), /Bluetooth is off/, "the app's code in words");
});

// The 2E gate's review of the 2F1 gold (M-5): an app slow to answer at boot is asked again; until a list arrives the page
// acts as on v1 (inactive), never as a v2 app with no printers.
test("2F1: a first read the app could not answer leaves the pool inactive and is asked again after the request timeout", async () => {
  let fail = true;
  const reads: number[] = [];
  const client: NativeV2Client = {
    request: (async (method: string) => {
      if (method !== "printer.status") throw nativeError("BAD_REQUEST", "x");
      reads.push(reads.length + 1);
      if (fail) throw nativeError("TIMEOUT", "x");
      return { printers: [{ state: "connected", printer: KITCHEN }], defaultId: KITCHEN.id, bluetooth: "on" };
    }) as NativeV2Client["request"],
    onStatus: () => () => undefined,
  };
  const { pool, clock } = poolWith(client);
  pool.init();
  await flush();
  assert.deepEqual([pool.getSnapshot().active, reads.length], [false, 1], "inactive after a failed first read");
  fail = false;
  await clock.advance(NATIVE_REQUEST_TIMEOUT_MS);
  assert.deepEqual([pool.getSnapshot().active, pool.getSnapshot().printers.map((p) => p.id), reads.length], [true, [KITCHEN.id], 2], "read again, and active with the app's list");
});

// The 2F1 review gate (M-5): however many times the pool starts (init, a late bridge), an app that never answers is
// asked once per request timeout.
test("2F1 gate (M-5): init and a late bridge keep one retry of the first read, not two", async () => {
  const reads: number[] = [];
  const client: NativeV2Client = {
    request: (async (method: string) => {
      if (method === "printer.status") reads.push(1);
      throw nativeError("TIMEOUT", "x");
    }) as NativeV2Client["request"],
    onStatus: () => () => undefined,
  };
  const clock = makeClock();
  const late: { ready: (() => void) | null } = { ready: null };
  const pool = createNativePool({ v2: () => client, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onNativeReady: (fn) => ((late.ready = fn), () => undefined) });
  pool.init();
  await flush();
  late.ready?.();
  await flush();
  assert.equal(reads.length, 2, "a read at init and one when the bridge announces itself");
  await clock.advance(NATIVE_REQUEST_TIMEOUT_MS);
  await clock.advance(NATIVE_REQUEST_TIMEOUT_MS);
  await clock.advance(NATIVE_REQUEST_TIMEOUT_MS);
  assert.equal(reads.length, 5, "then one read per request timeout");
  assert.equal(pool.getSnapshot().active, false, "inactive meanwhile");
});

// The 2F1 review gate (N-1): the agent is nudged by what can print now, never by a down printer's own probes.
test("2F1 gate (N-1): a down printer's connecting <-> disconnected flip keeps the connected key; a printer connecting changes it", () => {
  const key = (bar: "connecting" | "connected" | "disconnected") =>
    connectedPoolKey(poolSnapshotOf({ printers: [{ state: "connected", printer: KITCHEN }, { state: bar, printer: BAR }], defaultId: KITCHEN.id, bluetooth: "on" }));
  assert.equal(key("disconnected"), KITCHEN.id, "the kitchen printer alone");
  assert.equal(key("connecting"), key("disconnected"), "a probe of the bar printer changes nothing that prints");
  assert.equal(key("connected"), `${KITCHEN.id},${BAR.id}`, "the bar printer back: a new key, a nudge");
  assert.equal(connectedPoolKey(EMPTY_POOL), "", "no app printers");
});

// The 2F1 review gate (M-3): the contract Session 2F2's app is written against says how a network printer reads
// between jobs and what an empty list looks like.
test("2F1 gate (M-3): the contract header states the network printer between jobs, the empty list, the v1 status and BUSY", () => {
  const header = readFileSync(new URL("./native-bridge-v2.ts", import.meta.url), "utf8");
  assert.ok(header.includes("A network (tcp) printer has no standing link: the app connects per job"), "a tcp printer between jobs");
  assert.ok(header.includes("`{ printers: [], defaultId: null, bluetooth }`: all three keys are always there"), "the empty list");
  assert.ok(header.includes("whenever that status changes: its state, Bluetooth,"), "the v1 status on every change of the default printer");
  assert.ok(header.includes("a print agent's job refused BUSY is sent again after"), "BUSY, said for both callers");
});

test("2F1: a job for one of the app's printers is written to that printer in a v2 print; a printer not in the list is refused before any byte", async () => {
  const { app, client } = fakeApp([{ state: "connected", printer: KITCHEN }, { state: "connected", printer: BAR }], KITCHEN.id);
  const { pool } = poolWith(client);
  pool.init();
  await flush();
  await pool.write(BAR.id, new Uint8Array(300));
  assert.deepEqual(app.printed, [{ printerId: BAR.id, bytes: 300 }], "every byte, to the bar printer");
  const print = app.requests.find((r) => r.method === "printer.print");
  assert.deepEqual(Object.keys(print?.params as object).sort(), ["data", "printerId"], "the printer and the job, nothing else");
  await assert.rejects(pool.write("tcp:10.0.2.2:9999", new Uint8Array(10)), (error: Error) => error.message === PRINTER_NOT_CONNECTED_MESSAGE, "not the app's printer: nothing sent");
});

test("2F1: each printer has its own queue: a job waiting on one printer never holds another printer's job", async () => {
  const { app, client } = fakeApp([{ state: "connected", printer: KITCHEN }, { state: "connected", printer: BAR }], KITCHEN.id);
  const { pool } = poolWith(client);
  pool.init();
  await flush();
  const gate: Array<() => void> = [];
  app.hold.set(KITCHEN.id, gate);
  const kitchen1 = pool.write(KITCHEN.id, new Uint8Array(10));
  const kitchen2 = pool.write(KITCHEN.id, new Uint8Array(20));
  const bar = pool.write(BAR.id, new Uint8Array(30));
  await bar;
  assert.deepEqual(app.printed, [{ printerId: BAR.id, bytes: 30 }], "the bar job printed while the kitchen printer was busy");
  app.hold.delete(KITCHEN.id);
  gate.shift()?.();
  await kitchen1;
  await kitchen2;
  assert.deepEqual(app.printed.map((p) => p.bytes), [30, 10, 20], "the kitchen's two jobs one after the other, in order");
});

test("2F1: a refusal made before writing on one printer reconnects that printer once and sends once more; a second refusal is not connected", async () => {
  const { app, client } = fakeApp([{ state: "connected", printer: KITCHEN }, { state: "connected", printer: BAR }], KITCHEN.id);
  const { pool } = poolWith(client);
  pool.init();
  await flush();
  app.refuse.add(BAR.id);
  await assert.rejects(pool.write(BAR.id, new Uint8Array(10)), (error: Error) => error.message === PRINTER_NOT_CONNECTED_MESSAGE);
  assert.deepEqual(app.requests.filter((r) => r.method !== "printer.status").map((r) => r.method), ["printer.print", "printer.reconnect", "printer.print"], "one reconnect, one resend, nothing more");
  const short: NativeV2Client = { ...client, request: (async (method: string, params?: unknown) => (method === "printer.print" ? { bytes: 1 } : client.request(method as "printer.status", params))) as NativeV2Client["request"] };
  const second = poolWith(short).pool;
  second.init();
  await flush();
  await assert.rejects(second.write(KITCHEN.id, new Uint8Array(10)), (error: Error) => error.message === PRINTER_WRITE_FAILED_MESSAGE, "a short count may already be on paper");
});

test("2F1: the app's list as the page's snapshot: a repeated id once, a listed printer's 'none' as down, an unknown default dropped", () => {
  const snapshot = poolSnapshotOf({
    printers: [
      { state: "connected", printer: KITCHEN },
      { state: "none", printer: BT },
      { state: "connected", printer: KITCHEN },
    ],
    defaultId: "usb:04b8:0e15",
    bluetooth: "off",
  });
  assert.deepEqual(snapshot.printers.map((p) => [p.id, p.status]), [[KITCHEN.id, "connected"], [BT.id, "disconnected"]]);
  assert.equal(snapshot.defaultId, null, "a default the list does not hold is no default");
  assert.match(snapshot.printers[1]?.message ?? "", /Bluetooth is off/, "a Bluetooth printer's words, as for the device's own printer");
});

test("2F1: the bridge speaks v2 only when the app says so; a v2 request carries the version, and a reply this page cannot read is refused", async () => {
  const calls: unknown[][] = [];
  const g = globalThis as unknown as { window?: unknown };
  const before = g.window;
  try {
    const request = async (...args: unknown[]) => {
      calls.push(args);
      return args[0] === "printer.status" ? { printers: [], defaultId: null, bluetooth: "on" } : { nope: true };
    };
    g.window = { PosNative: { version: 1, platform: "android", request, on: () => () => undefined } };
    assert.equal(nativeV2Bridge(), null, "the release APK: v1 only");
    assert.equal(nativeV2Client(), null);
    g.window = { PosNative: { version: 1, versions: [1], platform: "android", request, on: () => () => undefined } };
    assert.equal(nativeV2Bridge(), null, "versions without 2");
    g.window = { PosNative: { version: 1, versions: [1, 2], platform: "android", request, on: () => () => undefined } };
    assert.notEqual(nativeV2Bridge(), null, "an app that speaks v2");
    assert.deepEqual(await nativeV2Request("printer.status"), { printers: [], defaultId: null, bluetooth: "on" });
    assert.deepEqual(calls[0], ["printer.status", undefined, NATIVE_BRIDGE_V2], "the version rides as the last argument");
    await assert.rejects(nativeV2Request("printer.forget", { printerId: KITCHEN.id }), (error: { code?: string }) => error.code === "BAD_REQUEST", "an answer that is not the list");
  } finally {
    g.window = before;
  }
});

test("3C: a printer the app says cannot print is not in the ready key, so paper put back nudges the agent", () => {
  const ready = poolSnapshotOf({ printers: [{ state: "connected", printer: KITCHEN }, { state: "connected", printer: BAR }], defaultId: KITCHEN.id, bluetooth: "on" });
  const empty = poolSnapshotOf({ printers: [{ state: "connected", printer: KITCHEN, paper: "out" }, { state: "connected", printer: BAR, cover: "closed", paper: "low" }], defaultId: KITCHEN.id, bluetooth: "on" } as NativePoolStatus);
  assert.equal(connectedPoolKey(ready), `${KITCHEN.id},${BAR.id}`);
  assert.equal(connectedPoolKey(empty), BAR.id, "out of paper: not ready; low paper still prints");
});

test("3C review gate (m-4): the app's default printer that says it cannot print makes a device with no printer of its own not ready", () => {
  const out = poolSnapshotOf({ printers: [{ state: "connected", printer: KITCHEN, paper: "out" }, { state: "connected", printer: BAR }], defaultId: KITCHEN.id, bluetooth: "on" } as NativePoolStatus);
  assert.equal(poolDefaultCannotPrint(out), true, "simple mode prints on the default: out of paper, so not ready");
  assert.equal(poolDefaultCannotPrint({ ...out, defaultId: BAR.id }), false, "another printer out of paper says nothing of the default");
  assert.equal(poolDefaultCannotPrint(EMPTY_POOL), false, "no app list (bridge v1, the Windows app, a browser): as before");
});

test("3B: the app's v2 list may say each printer's paper, cover and error (Session 3C's app); the page keeps them, and a change of them is a change", () => {
  const plain = poolSnapshotOf({ printers: [{ state: "connected", printer: KITCHEN }], defaultId: KITCHEN.id, bluetooth: "on" });
  assert.equal(plain.printers[0]?.paper, undefined, "an app that says nothing (2F2's): nothing");
  const out = poolSnapshotOf({ printers: [{ state: "connected", printer: KITCHEN, paper: "out", cover: "open", error: true }], defaultId: KITCHEN.id, bluetooth: "on" } as NativePoolStatus);
  assert.deepEqual([out.printers[0]?.paper, out.printers[0]?.cover, out.printers[0]?.error], ["out", "open", true]);
});

test("3C (the 3B review's m-4): a paper, cover or error value this page does not know says nothing, and the rest of the app's list still reads", async () => {
  const g = globalThis as unknown as { window?: unknown };
  const before = g.window;
  try {
    const later = { printers: [{ state: "connected", printer: KITCHEN, paper: "near-end", cover: "ajar", error: "yes" }, { state: "connected", printer: BAR, paper: "out" }], defaultId: KITCHEN.id, bluetooth: "on" };
    g.window = { PosNative: { version: 1, versions: [1, 2], platform: "android", request: async () => later, on: () => () => undefined } };
    const read = await nativeV2Request("printer.status");
    assert.deepEqual(
      read.printers.map((entry) => [entry.printer.id, entry.paper, entry.cover, entry.error]),
      [
        [KITCHEN.id, undefined, undefined, undefined],
        [BAR.id, "out", undefined, undefined],
      ],
      "a later app's unknown value is dropped; the list and every value this page knows are kept",
    );
  } finally {
    g.window = before;
  }
});
