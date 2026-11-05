import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterHere, WaitingPrinter } from "@/lib/print-agent-here";
import type { PrinterDot, PrinterDotReason } from "@/lib/printer/printer-dot";
import { deviceNounOf, printerStatusViewOf, type PrinterStatusView, type PrinterStatusViewInput } from "@/lib/printer/printer-status-view";

// PX-2 (spec §6.4): every state of the status card → its headline, detail, steps, button and link or note, word for
// word. Steps carry **word** for the bold word; the card draws the marks (Task 6).

const BASE: PrinterStatusViewInput = {
  dot: { show: true, ok: true, reason: "ok" },
  hostLabel: null,
  printer: { name: "RPP02N", transport: "bluetooth" },
  noun: "this tablet",
  isHostDevice: false,
  canPrintHere: false,
  desktopNoPrinter: false,
  localStatus: "connected",
  here: [],
  waiting: null,
  notHere: [],
  isAdmin: false,
};
const view = (over: Partial<PrinterStatusViewInput>): PrinterStatusView => printerStatusViewOf({ ...BASE, ...over });
const bad = (reason: PrinterDotReason, problem?: string): PrinterDot => ({ show: true, ok: false, reason, ...(problem !== undefined ? { problem } : {}) });
const want = (v: Partial<PrinterStatusView> & Pick<PrinterStatusView, "tone" | "headline" | "detail">): PrinterStatusView => ({ steps: [], action: null, link: null, note: null, subject: [], ...v });

const RECONNECT = { kind: "reconnect" as const, label: "Reconnect" };
const BT_STEPS = ["Turn the printer on.", "Keep it close to this tablet.", "Tap **Reconnect**."];
const NOTE_PRINTS_AFTER = "Waiting slips print by themselves after that.";
const here = (id: string, name: string, over: Partial<PrinterHere> = {}): PrinterHere => ({ id, name, appName: "RPP02N", transport: "bluetooth", nativeId: `bt-classic:${id}`, status: "connected", ...over });
const KITCHEN_DOWN = here("kitchen", "Kitchen printer", { status: "disconnected" });
const BILL_UP = here("bill", "Bill printer");
const kitchenWaits = (over: Partial<WaitingPrinter> = {}): WaitingPrinter => ({ printerId: "kitchen", name: "Kitchen printer", count: 3, stuck: true, ...over });

test("checking: no dot yet, or a printer being checked", () => {
  const checking = want({ tone: "checking", headline: "Checking the printer…", detail: "" });
  assert.deepEqual(view({ dot: { show: false } }), checking, "no dot (lane pending / pulse loading)");
  assert.deepEqual(view({ dot: { show: true, ok: false, reason: "checking" } }), checking, "checking");
});

test("ok: this device's own printer, another device prints all, the Windows app's chosen printer, the cafe's printers", () => {
  assert.deepEqual(view({}), want({ tone: "ok", headline: "Printer ready", detail: "RPP02N · Bluetooth" }), "its own printer");
  assert.deepEqual(view({ hostLabel: "Counter tablet" }), want({ tone: "ok", headline: "Printing is on", detail: "Slips print at **Counter tablet**." }), "another device prints all");
  assert.deepEqual(view({ hostLabel: "Counter tablet", isHostDevice: true }), want({ tone: "ok", headline: "Printer ready", detail: "RPP02N · Bluetooth" }), "it is the printing device");
  assert.deepEqual(view({ noun: "this PC", printer: { name: "EPSON TM-T82", transport: "windows" } }), want({ tone: "ok", headline: "Printer ready", detail: "EPSON TM-T82" }), "the Windows app: the chosen printer's name");
  assert.deepEqual(view({ dot: { show: true, ok: true, reason: "printers-elsewhere" } }), want({ tone: "ok", headline: "Printing is on", detail: "Slips print at the cafe's printers." }), "printers mode, it writes nothing");
  assert.deepEqual(view({ here: [BILL_UP] }), want({ tone: "ok", headline: "Printer ready", detail: "RPP02N · Bluetooth" }), "printers mode, its one printer");
});

test("printer-waiting (F-I2): stuck with a problem, stuck by age, merely busy", () => {
  const steps = ["Check it is on and has paper.", "On the device it is connected to, open Printer and tap **Reconnect**."];
  assert.deepEqual(view({ dot: bad("printer-waiting"), waiting: kitchenWaits({ problem: "paper-out" }) }), want({ tone: "bad", headline: "Kitchen printer is not printing", detail: "Kitchen printer is out of paper.", steps }), "the row's problem text");
  assert.deepEqual(view({ dot: bad("printer-waiting"), waiting: kitchenWaits() }), want({ tone: "bad", headline: "Kitchen printer is not printing", detail: "3 slips waiting for it.", steps }), "waited over a minute");
  assert.equal(view({ dot: bad("printer-waiting"), waiting: kitchenWaits({ count: 1 }) }).detail, "1 slip waiting for it.", "one slip");
  const busy = want({ tone: "bad", headline: "Slips are waiting for Kitchen printer", detail: "3 slips waiting.", note: "If they do not print soon, check it is on and has paper." });
  assert.deepEqual(view({ dot: bad("printer-waiting"), waiting: kitchenWaits({ stuck: false }) }), busy, "a busy printer in a rush: no steps");
  assert.equal(view({ dot: bad("printer-waiting"), waiting: kitchenWaits({ stuck: false, count: 1 }) }).detail, "1 slip waiting.", "one slip");
});

test("device-offline", () => {
  assert.deepEqual(view({ dot: bad("device-offline") }), want({ tone: "bad", headline: "This device is offline", detail: "Printer status updates when the internet is back." }), "no network on this device: nothing to tap");
});

test("no-printer: the app or a browser, and the Windows app", () => {
  assert.deepEqual(
    view({ dot: bad("no-printer"), printer: null }),
    want({ tone: "bad", headline: "No printer on this tablet", detail: "Connect one to print slips here.", action: { kind: "connect", label: "Connect a printer" }, link: { kind: "one-device", label: "Or print everything on one device" } }),
    "the device noun",
  );
  assert.equal(view({ dot: bad("no-printer"), printer: null, noun: "this phone" }).headline, "No printer on this phone", "a phone");
  assert.deepEqual(
    view({ dot: bad("no-printer"), printer: null, noun: "this PC", desktopNoPrinter: true }),
    want({ tone: "bad", headline: "No printer chosen on this PC", detail: "Choose this PC's printer so slips can print.", action: { kind: "choose", label: "Choose a printer" } }),
    "the Windows app",
  );
});

test("printer-off, simple mode: the steps by transport, Reconnect, and the way to connect it again", () => {
  const link = { kind: "connect-again" as const, label: "Still not working? Connect it again" };
  assert.deepEqual(view({ dot: bad("printer-off") }), want({ tone: "bad", headline: "Printer not connected", detail: "RPP02N · Bluetooth", steps: BT_STEPS, action: RECONNECT, link }), "Bluetooth");
  assert.deepEqual(view({ dot: bad("printer-off"), noun: "this phone" }).steps[1], "Keep it close to this phone.", "the device noun");
  assert.deepEqual(view({ dot: bad("printer-off"), printer: { name: "POS-80", transport: "usb" } }), want({ tone: "bad", headline: "Printer not connected", detail: "POS-80 · USB", steps: ["Turn the printer on.", "Check the USB cable.", "Tap **Reconnect**."], action: RECONNECT, link }), "USB");
  assert.deepEqual(
    view({ dot: bad("printer-off"), printer: { name: "192.168.1.60", transport: "network" } }),
    want({ tone: "bad", headline: "Printer not connected", detail: "192.168.1.60 · Wi-Fi or network", steps: ["Turn the printer on.", "Check it is on the cafe's network.", "Tap **Reconnect**."], action: RECONNECT, link }),
    "the app's network printer",
  );
});

test("printer-off, printers mode: one down names it, two down count them; Reconnect's subject is every one down", () => {
  assert.deepEqual(
    view({ dot: bad("printer-off"), here: [KITCHEN_DOWN, BILL_UP] }),
    want({ tone: "bad", headline: "Kitchen printer is not connected", detail: "RPP02N · Bluetooth", steps: BT_STEPS, action: RECONNECT, subject: [KITCHEN_DOWN] }),
    "the client's case: the RIGHT printer",
  );
  const billDown = { ...BILL_UP, status: "disconnected" as const };
  assert.deepEqual(
    view({ dot: bad("printer-off"), here: [KITCHEN_DOWN, billDown] }),
    want({ tone: "bad", headline: "2 printers are not connected", detail: "Kitchen printer, Bill printer", steps: BT_STEPS, action: RECONNECT, subject: [KITCHEN_DOWN, billDown] }),
    "both, in the setup's order",
  );
});

test("printer-off on the Windows app (F-I3): its network printer gets no Reconnect, and nothing is in the subject", () => {
  const kitchen = here("kitchen", "Kitchen printer", { appName: "192.168.1.60", transport: "network", nativeId: undefined, status: "disconnected" });
  const epson = here("epson", "Bill printer", { appName: "EPSON TM-T82", transport: "windows", nativeId: undefined, status: "none" });
  assert.deepEqual(
    view({ dot: bad("printer-off"), noun: "this PC", printer: null, here: [epson, kitchen] }),
    want({ tone: "bad", headline: "Kitchen printer is not connected", detail: "192.168.1.60 · network", steps: ["Turn the printer on.", "Check it is on the cafe's network."], note: "This PC checks it again every minute." }),
    "the app checks it again by itself",
  );
});

test("printer-needs-tap and printer-elsewhere", () => {
  assert.deepEqual(view({ dot: bad("printer-needs-tap"), printer: { name: "MTP-II", transport: "bluetooth" } }), want({ tone: "bad", headline: "Printer needs a tap", detail: "MTP-II · Bluetooth", action: RECONNECT }), "a browser's printer: Reconnect, this device's own");
  const tap = here("web", "Kitchen printer", { appName: "MTP-II", nativeId: undefined, status: "needs-tap" });
  assert.deepEqual(view({ dot: bad("printer-needs-tap"), printer: null, here: [tap] }), want({ tone: "bad", headline: "Printer needs a tap", detail: "MTP-II · Bluetooth", action: RECONNECT }), "printers mode: the same, with an empty subject (M-3)");
  assert.deepEqual(view({ dot: bad("printer-elsewhere") }), want({ tone: "bad", headline: "Printer in another tab", detail: "Print from that tab, or close it." }), "another tab owns it: nothing to tap");
});

test("printer-problem: out of paper, cover open, an error; nothing to tap, a note", () => {
  const out = here("kitchen", "Kitchen printer", { problem: "paper-out" });
  assert.deepEqual(
    view({ dot: bad("printer-problem", "Kitchen printer is out of paper."), here: [BILL_UP, out] }),
    want({ tone: "bad", headline: "Kitchen printer is out of paper", detail: "RPP02N · Bluetooth", steps: ["Put in a new paper roll.", "Close the cover."], note: NOTE_PRINTS_AFTER }),
    "printers mode: the printer with the problem, named; no subject (nothing to reconnect, M-3)",
  );
  const cover = here("kitchen", "Kitchen printer", { problem: "cover-open" });
  assert.deepEqual(view({ dot: bad("printer-problem", "x"), here: [cover] }), want({ tone: "bad", headline: "Kitchen printer has its cover open", detail: "RPP02N · Bluetooth", steps: ["Close the printer's cover."], note: NOTE_PRINTS_AFTER }), "cover open: one step, the note");
  const error = here("kitchen", "Kitchen printer", { problem: "error" });
  assert.deepEqual(view({ dot: bad("printer-problem", "x"), here: [error] }), want({ tone: "bad", headline: "Kitchen printer reports an error", detail: "RPP02N · Bluetooth", steps: ["Switch the printer off and on.", "Check the paper is not stuck."], note: NOTE_PRINTS_AFTER }), "an error: two steps, the note");
  assert.deepEqual(
    view({ dot: bad("printer-problem", "RPP02N has its cover open.") }),
    want({ tone: "bad", headline: "RPP02N has its cover open", detail: "RPP02N · Bluetooth", steps: ["Close the printer's cover."], note: NOTE_PRINTS_AFTER }),
    "simple mode (3C m-7): the app's own printer, read from the dot's words",
  );
});

test("the printing device's rows: offline (each case), its printer off, a print window", () => {
  const host = { hostLabel: "Counter tablet" };
  assert.deepEqual(view({ ...host, dot: bad("host-offline"), isHostDevice: true }), want({ tone: "bad", headline: "Counter tablet is offline", detail: "Slips wait and print when this device is back online." }), "this device is it");
  const back = "Slips wait and print when it is back.";
  assert.deepEqual(view({ ...host, dot: bad("host-offline"), canPrintHere: true }), want({ tone: "bad", headline: "Counter tablet is offline", detail: back, action: { kind: "print-here", label: "Print on this device" } }), "it can print here");
  assert.deepEqual(view({ ...host, dot: bad("host-offline"), localStatus: "disconnected" }), want({ tone: "bad", headline: "Counter tablet is offline", detail: back, action: RECONNECT }), "its own printer is off: Reconnect");
  assert.deepEqual(view({ ...host, dot: bad("host-offline"), printer: null, localStatus: "none" }).action, { kind: "connect", label: "Connect a printer" }, "no printer: Connect a printer");
  assert.equal(view({ ...host, dot: bad("host-offline"), localStatus: "elsewhere" }).action, null, "another tab has it: nothing to tap");
  assert.equal(view({ dot: bad("host-offline"), isHostDevice: true }).headline, "The printing device is offline", "no name: the fallback");
  assert.deepEqual(view({ ...host, dot: bad("host-printer-off") }), want({ tone: "bad", headline: "Counter tablet's printer is not connected", detail: back, steps: ["On Counter tablet, open Printer and tap **Reconnect**."] }), "the fix is on the printing device");
  const window = want({ tone: "bad", headline: "Slips need a tap to print", detail: "Counter tablet opens a print window for every slip." });
  assert.deepEqual(view({ ...host, dot: bad("host-print-window") }), window, "elsewhere: nothing to tap");
  assert.deepEqual(view({ ...host, dot: bad("host-print-window"), isHostDevice: true }), { ...window, action: { kind: "set-up-host", label: "Set up the printer" } }, "on the printing device itself");
});

test("printer-not-here: staff get no link, an admin gets Printer setup", () => {
  const staff = want({ tone: "bad", headline: "Kitchen printer is not on this phone", detail: "Connect it here, or ask your manager to change Printer setup.", action: { kind: "connect", label: "Connect a printer" } });
  assert.deepEqual(view({ dot: bad("printer-not-here"), noun: "this phone", notHere: ["Kitchen printer"] }), staff, "staff");
  assert.deepEqual(view({ dot: bad("printer-not-here"), noun: "this phone", notHere: ["Kitchen printer"], isAdmin: true }), { ...staff, link: { kind: "printer-setup", label: "Open Printer setup" } }, "an admin");
});

test("deviceNounOf (R13): the Windows app is this PC; inside the Android app by the screen's shorter side; else this device", () => {
  assert.equal(deviceNounOf("desktop", false, null), "this PC", "the Windows app");
  assert.equal(deviceNounOf("raster", true, 390), "this phone", "a 390 px phone");
  assert.equal(deviceNounOf("raster", true, 599), "this phone", "under 600");
  assert.equal(deviceNounOf("raster", true, 600), "this tablet", "600 and over");
  assert.equal(deviceNounOf("none", true, 820), "this tablet", "the client's tablet, no printer yet");
  assert.equal(deviceNounOf("raster", true, null), "this device", "before mount");
  assert.equal(deviceNounOf("raster", false, 390), "this device", "a browser on a phone");
  assert.equal(deviceNounOf("system", false, null), "this device", "a browser");
});

test("subject is exactly what Reconnect reconnects (M-3): only on a Reconnect row, empty on every other", () => {
  const paperOut = here("kitchen", "Kitchen printer", { problem: "paper-out" });
  const winDown = here("kitchen", "Kitchen printer", { appName: "192.168.1.60", transport: "network", nativeId: undefined, status: "disconnected" });
  const reasons: PrinterDotReason[] = ["ok", "device-offline", "no-printer", "printer-off", "printer-needs-tap", "printer-elsewhere", "host-offline", "host-printer-off", "host-print-window", "printer-not-here", "printers-elsewhere", "printer-problem", "printer-waiting"];
  const inputs: Partial<PrinterStatusViewInput>[] = [{}, { here: [KITCHEN_DOWN, BILL_UP] }, { here: [paperOut], waiting: kitchenWaits() }, { noun: "this PC", here: [winDown] }, { hostLabel: "Counter tablet" }];
  let reconnectRows = 0;
  for (const reason of reasons) {
    for (const over of inputs) {
      const v = view({ ...over, dot: { show: true, ok: reason === "ok" || reason === "printers-elsewhere", reason } });
      if (v.subject.length > 0) reconnectRows += 1;
      assert.ok(v.subject.length === 0 || v.action?.kind === "reconnect", `${reason} ${JSON.stringify(over)}: a subject only where Reconnect is the button`);
    }
  }
  assert.ok(reconnectRows > 0, "the sweep reached a Reconnect row with a subject");
  assert.deepEqual(view({ dot: bad("printer-problem", "x"), here: [paperOut] }).subject, [], "out of paper: nothing to reconnect");
  assert.deepEqual(view({ dot: bad("printer-off"), noun: "this PC", here: [winDown] }).subject, [], "the Windows app: never reconnected (F-I3)");
  assert.deepEqual(view({ dot: bad("printer-off"), here: [KITCHEN_DOWN, BILL_UP] }).subject, [KITCHEN_DOWN], "printers mode: the printer that is down, and only it");
});

test("a low-paper printer in a rush is only waiting; out of paper is stuck (Ruling O)", () => {
  const busy = view({ dot: bad("printer-waiting"), waiting: { printerId: "kitchen", name: "Kitchen printer", count: 2, stuck: false } });
  assert.deepEqual(busy, want({ tone: "bad", headline: "Slips are waiting for Kitchen printer", detail: "2 slips waiting.", note: "If they do not print soon, check it is on and has paper." }), "low paper never reads as stopped");
  const out = view({ dot: bad("printer-waiting"), waiting: kitchenWaits({ count: 1, problem: "paper-out" }) });
  assert.equal(out.headline, "Kitchen printer is not printing", "out of paper stops it");
  assert.equal(out.detail, "Kitchen printer is out of paper.", "in the printer's own words");
});

// PX-2 Task 6 (R11): moved from printer-dot.test.ts's printerHeadlineOf cases, in the new words.
test("a missing or blank name falls back to a plain phrase, never 'null'", () => {
  for (const hostLabel of [null, "", "   "]) {
    const offline = view({ dot: bad("host-offline"), hostLabel, canPrintHere: true });
    assert.equal(offline.headline, "The printing device is offline", `${JSON.stringify(hostLabel)}: the host's fallback`);
    assert.equal(view({ dot: bad("host-printer-off"), hostLabel }).headline, "The printing device's printer is not connected", `${JSON.stringify(hostLabel)}: in the possessive too`);
    assert.equal(view({ dot: bad("host-print-window"), hostLabel }).detail, "The printing device opens a print window for every slip.", `${JSON.stringify(hostLabel)}: in the detail`);
    assert.ok(!/null|undefined/.test(offline.detail), "no 'null' in the detail");
  }
  const noName = view({ dot: bad("printer-off"), printer: null });
  assert.deepEqual([noName.headline, noName.detail], ["Printer not connected", ""], "no saved printer: no name, no 'The printer · '");
  assert.equal(view({ dot: bad("printer-problem"), printer: null }).headline, "The printer reports an error", "a problem with no name says The printer");
});

test("no jargon and no colour words in any string the card shows", () => {
  const reasons: PrinterDotReason[] = ["ok", "device-offline", "checking", "no-printer", "printer-off", "printer-needs-tap", "printer-elsewhere", "host-offline", "host-printer-off", "host-print-window", "printer-not-here", "printers-elsewhere", "printer-problem", "printer-waiting"];
  const texts: string[] = [];
  for (const reason of reasons) {
    for (const over of [{}, { hostLabel: "Counter tablet", isHostDevice: true }, { here: [KITCHEN_DOWN], waiting: kitchenWaits() }]) {
      const v = view({ ...over, dot: { show: true, ok: reason === "ok" || reason === "printers-elsewhere", reason } });
      texts.push(v.headline, v.detail, ...v.steps, v.action?.label ?? "", v.link?.label ?? "", v.note ?? "");
    }
  }
  assert.ok(texts.filter((t) => t !== "").length > 60, "the sweep read real strings");
  for (const text of texts) assert.ok(!/lease|epoch|queue|agent|bridge|pulse|\bred\b|\bgreen\b|undefined|null/i.test(text), `"${text}" must not use jargon`);
});
