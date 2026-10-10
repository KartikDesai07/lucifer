import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DESKTOP_LAN_DOWN_CHECK_MS,
  DESKTOP_LAN_MAX_PRINTERS,
  DESKTOP_LAN_PRINT_TIMEOUT_MS,
  DESKTOP_LAN_PROBLEM_CHECK_MS,
  DESKTOP_LAN_RECHECK_MS,
  connectedLanKey,
  createDesktopLan,
  desktopLanApi,
  desktopLanCannotPrint,
  desktopLanId,
  desktopPrintersState,
  setDesktopLanInstance,
  type DesktopLanApi,
  type DesktopLanTarget,
} from "@/lib/printer/desktop-lan";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing redesign, Phase 3 Session 3E (spec §9.6): the page's store of the network printers the Windows app 1.12.0
// writes over raw TCP, driven through a fake app (printRaw, lanStatus) and fake timers.

const KITCHEN: DesktopLanTarget = { host: "192.168.1.60", port: 9100 };
const BAR: DesktopLanTarget = { host: "192.168.1.61", port: 9100 };

interface FakeApp {
  api: DesktopLanApi;
  checks: DesktopLanTarget[][];
  prints: Array<{ printer: DesktopLanTarget; bytes: number }>;
  status: unknown;
  printAnswer: () => Promise<unknown>;
}

function fakeApp(): FakeApp {
  const app: FakeApp = {
    checks: [],
    prints: [],
    status: [],
    printAnswer: async () => ({ ok: true, health: null }),
    api: {
      lanStatus: async (printers) => {
        app.checks.push(printers);
        return app.status;
      },
      printRaw: async (printer, data) => {
        app.prints.push({ printer, bytes: data.length });
        return app.printAnswer();
      },
    },
  };
  return app;
}

function fakeTimers() {
  const pending: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  return {
    pending,
    setTimer: (fn: () => void, ms: number): unknown => {
      const handle = { fn, ms, live: true };
      pending.push(handle);
      return handle;
    },
    clearTimer: (handle: unknown): void => {
      (handle as { live: boolean }).live = false;
    },
    fire(ms: number): void {
      for (const timer of pending.filter((t) => t.live && t.ms === ms)) {
        timer.live = false;
        timer.fn();
      }
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("3E: only a Windows app that has printRaw and lanStatus (1.12.0) writes network printers", () => {
  const holder = globalThis as unknown as { window?: unknown };
  const before = holder.window;
  try {
    holder.window = {};
    assert.equal(desktopLanApi(), null, "no Windows app");
    holder.window = { posDesktop: { version: "1.11.0", printHtml: async () => undefined, printHtmlOn: async () => undefined } };
    assert.equal(desktopLanApi(), null, "1.11.0 prints no network printer (as before)");
    holder.window = { posDesktop: { version: "1.12.0", printHtml: async () => undefined, printRaw: async () => ({ ok: true }), lanStatus: async () => [] } };
    assert.notEqual(desktopLanApi(), null, "1.12.0 does");
  } finally {
    holder.window = before;
  }
  assert.equal(desktopLanId({ host: "Kitchen-Printer.LAN", port: 9100 }), "tcp:kitchen-printer.lan:9100", "the POS app's id for the same printer, lower-case");
});

test("3E: a printer the page starts to print is checked at once; its link and paper come from the app; one it stops naming is forgotten", async () => {
  const app = fakeApp();
  const timers = fakeTimers();
  const lan = createDesktopLan({ api: () => app.api, ...timers });
  let changes = 0;
  lan.subscribe(() => void (changes += 1));
  app.status = [{ host: KITCHEN.host, port: 9100, link: "connected", health: { paper: "low", cover: "closed" } }];
  lan.watch([KITCHEN]);
  assert.deepEqual(lan.getSnapshot().printers.map((p) => [p.id, p.status]), [["tcp:192.168.1.60:9100", "connecting"]], "connecting until the app says");
  await flush();
  assert.deepEqual(app.checks, [[KITCHEN]], "checked at once");
  assert.deepEqual(lan.printerOf("tcp:192.168.1.60:9100"), { id: "tcp:192.168.1.60:9100", host: "192.168.1.60", port: 9100, status: "connected", paper: "low", cover: "closed" }, "what the printer says of itself");
  assert.equal(lan.getSnapshot().active, true, "the app writes network printers");
  lan.watch([KITCHEN]);
  await flush();
  assert.equal(app.checks.length, 1, "the same list again asks nothing");
  app.status = [
    { host: KITCHEN.host, port: 9100, link: "disconnected", health: null },
    { host: BAR.host, port: 9100, link: null, health: null },
  ];
  lan.watch([KITCHEN, BAR]);
  await flush();
  assert.deepEqual(app.checks[1], [KITCHEN, BAR], "a new printer: every watched one is checked");
  assert.deepEqual(lan.getSnapshot().printers.map((p) => [p.id, p.status, p.paper ?? "-"]), [["tcp:192.168.1.60:9100", "disconnected", "-"], ["tcp:192.168.1.61:9100", "connecting", "-"]], "down drops what it said before; a printer a job holds keeps its state");
  lan.watch([BAR]);
  assert.deepEqual(lan.getSnapshot().printers.map((p) => p.id), ["tcp:192.168.1.61:9100"], "the kitchen is no longer named: forgotten");
  assert.ok(changes >= 3, "each change is published");
  const before = lan.getSnapshot();
  app.status = "not a list";
  await lan.check();
  assert.strictEqual(lan.getSnapshot(), before, "an odd answer changes nothing");
});

test("3E: a slip: printed (connected, what it said); nothing sent is 'not connected' and asked again soon; 'maybe' is a write that failed", async () => {
  const app = fakeApp();
  const timers = fakeTimers();
  const lan = createDesktopLan({ api: () => app.api, ...timers });
  app.status = [{ host: KITCHEN.host, port: 9100, link: "connected", health: null }];
  lan.watch([KITCHEN]);
  await flush();

  app.printAnswer = async () => ({ ok: true, health: { paper: "ok", cover: "closed" } });
  await lan.write(KITCHEN, new Uint8Array(40));
  assert.deepEqual(app.prints, [{ printer: KITCHEN, bytes: 40 }], "the bytes to the printer's address");
  assert.deepEqual([lan.printerOf("tcp:192.168.1.60:9100")?.status, lan.printerOf("tcp:192.168.1.60:9100")?.paper], ["connected", "ok"]);

  app.printAnswer = async () => ({ ok: false, sent: "no", failure: "not-connected", message: "The printer did not answer.", health: null });
  await assert.rejects(lan.write(KITCHEN, new Uint8Array(40)), { message: PRINTER_NOT_CONNECTED_MESSAGE }, "nothing sent: the agent acks it unreachable");
  assert.equal(lan.printerOf("tcp:192.168.1.60:9100")?.status, "disconnected");
  assert.equal(timers.pending.filter((t) => t.live && t.ms === DESKTOP_LAN_RECHECK_MS).length, 1, "asked again soon");
  app.status = [{ host: KITCHEN.host, port: 9100, link: "connected", health: null }];
  timers.fire(DESKTOP_LAN_RECHECK_MS);
  await flush();
  assert.equal(lan.printerOf("tcp:192.168.1.60:9100")?.status, "connected", "back by the re-check");

  app.printAnswer = async () => ({ ok: false, sent: "maybe", failure: "cannot-print", message: "The printer cannot print now.", health: { paper: "out", cover: "closed" } });
  await assert.rejects(lan.write(KITCHEN, new Uint8Array(40)), { message: PRINTER_WRITE_FAILED_MESSAGE }, "it took bytes: 'maybe'");
  const out = lan.printerOf("tcp:192.168.1.60:9100");
  assert.deepEqual([out?.status, out?.paper, out !== null && desktopLanCannotPrint(out)], ["connected", "out", true], "its link is fine; it cannot print");
  assert.equal(connectedLanKey(lan.getSnapshot()), "", "not ready for the agent while out of paper");

  app.printAnswer = async () => ({ ok: false, sent: "maybe", failure: "write-failed", message: "The printer stopped answering while the slip was sent.", health: null });
  await assert.rejects(lan.write(KITCHEN, new Uint8Array(40)), { message: PRINTER_WRITE_FAILED_MESSAGE });
  assert.equal(lan.printerOf("tcp:192.168.1.60:9100")?.status, "connecting", "the link broke mid-slip: asked again");

  app.printAnswer = () => new Promise(() => undefined);
  const hanging = lan.write(KITCHEN, new Uint8Array(40));
  timers.fire(DESKTOP_LAN_PRINT_TIMEOUT_MS);
  await assert.rejects(hanging, { message: PRINTER_WRITE_FAILED_MESSAGE }, "no answer from the app in time: it may be on paper");

  const none = createDesktopLan({ api: () => null, ...fakeTimers() });
  await assert.rejects(none.write(KITCHEN, new Uint8Array(40)), { message: PRINTER_NOT_CONNECTED_MESSAGE }, "an app from before 1.12.0 sends nothing");
});

test("3E: a printer out of paper is asked again every 10 s, one that does not answer every 30 s; a check that began before a slip's answer never overwrites it", async () => {
  const app = fakeApp();
  const timers = fakeTimers();
  const lan = createDesktopLan({ api: () => app.api, ...timers });
  app.status = [{ host: KITCHEN.host, port: 9100, link: "connected", health: { paper: "out" } }];
  lan.watch([KITCHEN]);
  await flush();
  assert.equal(timers.pending.filter((t) => t.live && t.ms === DESKTOP_LAN_PROBLEM_CHECK_MS).length, 1, "out of paper: asked again in 10 s");
  app.status = [{ host: KITCHEN.host, port: 9100, link: "disconnected", health: null }];
  timers.fire(DESKTOP_LAN_PROBLEM_CHECK_MS);
  await flush();
  assert.equal(lan.printerOf("tcp:192.168.1.60:9100")?.status, "disconnected");
  assert.equal(timers.pending.filter((t) => t.live && t.ms === DESKTOP_LAN_DOWN_CHECK_MS).length, 1, "down: asked again in 30 s");
  app.status = [{ host: KITCHEN.host, port: 9100, link: "connected", health: { paper: "ok" } }];
  timers.fire(DESKTOP_LAN_DOWN_CHECK_MS);
  await flush();
  assert.equal(timers.pending.filter((t) => t.live && (t.ms === DESKTOP_LAN_PROBLEM_CHECK_MS || t.ms === DESKTOP_LAN_DOWN_CHECK_MS)).length, 0, "fine again: the minute's check only");

  // A slow check (another printer that is off) answers after a slip that failed "no": the slip's answer stands.
  let release: (rows: unknown) => void = () => undefined;
  app.api.lanStatus = () => new Promise((resolve) => void (release = resolve));
  const slow = lan.check();
  app.printAnswer = async () => ({ ok: false, sent: "no", failure: "not-connected", message: "The printer did not answer.", health: null });
  await assert.rejects(lan.write(KITCHEN, new Uint8Array(40)), { message: PRINTER_NOT_CONNECTED_MESSAGE });
  release([{ host: KITCHEN.host, port: 9100, link: "connected", health: null }]);
  await slow;
  assert.equal(lan.printerOf("tcp:192.168.1.60:9100")?.status, "disconnected", "the check began before the slip's answer: never a stale connected");
});

test("the 3E review gate (m-4, m-5): every watched printer is checked, at most sixteen to a call; one not answered yet is asked again in 30 s even when the app refused the check", async () => {
  const app = fakeApp();
  const timers = fakeTimers();
  const lan = createDesktopLan({ api: () => app.api, ...timers });
  const many = Array.from({ length: 17 }, (_, i): DesktopLanTarget => ({ host: `192.168.1.${100 + i}`, port: 9100 }));
  app.api.lanStatus = async (printers) => {
    app.checks.push(printers);
    return printers.map((printer) => ({ host: printer.host, port: printer.port, link: "connected", health: null }));
  };
  lan.watch(many);
  await flush();
  assert.deepEqual(app.checks.map((asked) => asked.length), [DESKTOP_LAN_MAX_PRINTERS, 1], "two calls: the app takes sixteen at a time");
  assert.equal(lan.printerOf("tcp:192.168.1.116:9100")?.status, "connected", "the seventeenth is checked too");
  app.api.lanStatus = async () => {
    throw new Error("refused");
  };
  lan.watch([KITCHEN]);
  await flush();
  assert.equal(lan.printerOf("tcp:192.168.1.60:9100")?.status, "connecting", "the app refused: nothing known yet");
  assert.equal(timers.pending.filter((t) => t.live && t.ms === DESKTOP_LAN_DOWN_CHECK_MS).length, 1, "asked again in 30 s, not only at the minute's check");
});

test("3E: the agent's key counts only connected printers that can print, and the hold's state changes with either list", () => {
  assert.equal(
    connectedLanKey({
      active: true,
      printers: [
        { id: "tcp:a:9100", host: "a", port: 9100, status: "connected" },
        { id: "tcp:b:9100", host: "b", port: 9100, status: "connected", cover: "open" },
        { id: "tcp:c:9100", host: "c", port: 9100, status: "disconnected" },
        { id: "tcp:d:9100", host: "d", port: 9100, status: "connected", paper: "low" },
      ],
    }),
    "tcp:a:9100,tcp:d:9100",
    "low paper still prints",
  );
  const app = fakeApp();
  setDesktopLanInstance(createDesktopLan({ api: () => app.api, ...fakeTimers() }));
  try {
    const windows = { names: ["EPSON"] };
    const first = desktopPrintersState(windows);
    assert.strictEqual(desktopPrintersState(windows), first, "nothing changed: the same value");
    assert.notStrictEqual(desktopPrintersState({ names: [] }), first, "a Windows printer list read again");
  } finally {
    setDesktopLanInstance(null);
  }
});
