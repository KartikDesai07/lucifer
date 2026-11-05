import { test } from "node:test";
import assert from "node:assert/strict";

import type { PosPulseData } from "@pos/shared/self-order-alert";
import type { PrintHostState } from "@pos/shared/print-job";
import {
  PRINTER_BUTTON_NAME_BAD,
  PRINTER_BUTTON_NAME_CHECKING,
  PRINTER_BUTTON_NAME_NONE,
  PRINTER_BUTTON_NAME_OK,
  printHostDotOf,
  printerButtonName,
  printerDotOf,
  printerDotTone,
  type DotLane,
  type PrintHostDot,
  type PrinterDot,
  type PrinterDotInput,
  type PrinterDotReason,
  type PrinterDotTone,
} from "@/lib/printer/printer-dot";
import { printerStatusViewOf, type PrinterStatusViewInput } from "@/lib/printer/printer-status-view";
import type { DesktopChosen } from "@/lib/printer/desktop-printer-state";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// ── Fixtures ─────────────────────────────────────────────────────────────────
function host(overrides: Partial<PrintHostState> = {}): PrintHostState {
  return { configured: true, deviceId: "d1", label: "Counter PC", lastSeenAt: null, offline: false, silentMode: false, printer: null, ...overrides };
}

function pulse(printHost: PrintHostState | null): PosPulseData {
  return {
    openCount: 0,
    openTruncated: false,
    newestOpenId: null,
    newestOpenAt: null,
    openRev: null,
    selfOrders: [],
    selfOrdersTruncated: false,
    printHost,
    printJobs: [],
    printJobsTruncated: false,
    stalePrintJobs: [],
    stalePrintJobsTruncated: false,
    resolvedPrintJobs: [],
    resolvedPrintJobsTruncated: false,
  };
}

// ── printHostDotOf ───────────────────────────────────────────────────────────
test("printHostDotOf: the contract table, row by row", () => {
  assert.equal(printHostDotOf(undefined), "loading");
  assert.equal(printHostDotOf(pulse(null)), "unknown");
  // An unconfigured host reads offline:true on the wire — "none" must win.
  assert.equal(printHostDotOf(pulse(host({ configured: false, offline: true }))), "none");
  assert.equal(printHostDotOf(pulse(host({ offline: true, printer: "connected", silentMode: true }))), "offline", "offline outranks the printer report");
  assert.equal(printHostDotOf(pulse(host({ printer: "disconnected", silentMode: true }))), "printer-off");
  assert.equal(printHostDotOf(pulse(host({ printer: "connected" }))), "ok", "a connected report is green even without the silent attestation");
  assert.equal(printHostDotOf(pulse(host({ printer: null, silentMode: true }))), "ok");
  assert.equal(printHostDotOf(pulse(host({ printer: null, silentMode: false }))), "print-window");
});

// ── printerDotOf: exhaustive truth table against an independent oracle ───────
const REMOTES: PrintHostDot[] = ["loading", "unknown", "none", "offline", "printer-off", "print-window", "ok"];
const LANES: DotLane[] = ["pending", "desktop", "raster", "system", "none"];
const LOCALS: PrinterStatus[] = ["none", "connecting", "connected", "disconnected", "needs-tap", "elsewhere"];
const DESKTOP_STATES: DesktopChosen[] = ["unknown", "none", "chosen"];
const BOOLS = [false, true];
const COMBINATION_COUNT = REMOTES.length * LANES.length * LOCALS.length * DESKTOP_STATES.length * BOOLS.length * BOOLS.length;

type Verdict = PrinterDotReason | "none";

// What a printing device elsewhere (or this tab falling back to it) shows.
const FROM_REMOTE: Record<string, Verdict> = {
  ok: "ok",
  offline: "host-offline",
  "printer-off": "host-printer-off",
  "print-window": "host-print-window",
};

// Written from the contract's numbered order as a first-match rule list; the
// production code is nested helpers, so the two share no structure.
const RULES: { name: string; when: (i: PrinterDotInput) => boolean; then: (i: PrinterDotInput) => Verdict }[] = [
  { name: "1 device offline", when: (i) => i.deviceOffline, then: () => "device-offline" },
  { name: "2 pending or loading", when: (i) => i.lane === "pending" || i.remote === "loading", then: () => "none" },
  { name: "3 unknown", when: (i) => i.remote === "unknown", then: () => "checking" },
  // W-L: a desktop shell with no printer chosen refuses every job - red, never green.
  { name: "4a no host, desktop", when: (i) => i.remote === "none" && i.lane === "desktop", then: (i) => (i.desktopChosen === "none" ? "no-printer" : "ok") },
  { name: "4b no host, system/none", when: (i) => i.remote === "none" && (i.lane === "system" || i.lane === "none"), then: () => "no-printer" },
  {
    name: "4c no host, raster",
    when: (i) => i.remote === "none" && i.lane === "raster",
    then: (i) => (i.local === "connected" ? "ok" : i.local === "connecting" ? "checking" : i.local === "needs-tap" ? "printer-needs-tap" : i.local === "elsewhere" ? "printer-elsewhere" : "printer-off"),
  },
  {
    name: "5a this device, raster",
    when: (i) => i.isHostDevice && i.lane === "raster",
    then: (i) => (i.local === "connected" ? "ok" : i.local === "connecting" ? "checking" : i.local === "needs-tap" ? "printer-needs-tap" : i.local === "elsewhere" ? FROM_REMOTE[i.remote] : "printer-off"),
  },
  {
    name: "5b this device, desktop",
    when: (i) => i.isHostDevice && i.lane === "desktop",
    then: (i) => (i.desktopChosen === "none" ? "no-printer" : i.remote === "offline" ? "host-offline" : "ok"),
  },
  { name: "5c this device, system", when: (i) => i.isHostDevice && i.lane === "system", then: (i) => FROM_REMOTE[i.remote] },
  { name: "5d this device, none", when: (i) => i.isHostDevice && i.lane === "none", then: () => "no-printer" },
  { name: "6 another device", when: () => true, then: (i) => FROM_REMOTE[i.remote] },
];

function oracle(i: PrinterDotInput): Verdict {
  const rule = RULES.find((r) => r.when(i));
  assert.ok(rule, "the rule list ends in a catch-all");
  return rule.then(i);
}

function verdictOf(dot: PrinterDot): Verdict {
  return dot.show ? dot.reason : "none";
}

function* allInputs(): Generator<PrinterDotInput> {
  for (const remote of REMOTES)
    for (const lane of LANES)
      for (const local of LOCALS)
        for (const desktopChosen of DESKTOP_STATES)
          for (const isHostDevice of BOOLS)
            for (const deviceOffline of BOOLS) yield { remote, isHostDevice, lane, local, deviceOffline, desktopChosen };
}

test("printerDotOf: every input combination matches the oracle (and the sweep is not vacuous)", () => {
  let count = 0;
  const seen = new Set<Verdict>();
  for (const input of allInputs()) {
    const expected = oracle(input);
    const dot = printerDotOf(input);
    assert.equal(verdictOf(dot), expected, `input ${JSON.stringify(input)}`);
    if (dot.show) assert.equal(dot.ok, dot.reason === "ok", `ok flag follows the reason for ${JSON.stringify(input)}`);
    seen.add(expected);
    count += 1;
  }
  assert.equal(count, COMBINATION_COUNT, "every combination was visited");
  assert.equal(COMBINATION_COUNT, 2520, "840 combinations x 3 desktop-printer states");
  const everyVerdict: Verdict[] = [
    "none", "ok", "device-offline", "checking", "no-printer", "printer-off", "printer-needs-tap",
    "printer-elsewhere", "host-offline", "host-printer-off", "host-print-window",
  ];
  for (const v of everyVerdict) assert.ok(seen.has(v), `the table reaches ${v}`);
});

test("printerDotOf invariants: device offline always wins; pending lane or loading remote never shows a dot", () => {
  for (const input of allInputs()) {
    const dot = printerDotOf(input);
    if (input.deviceOffline) {
      assert.deepEqual(dot, { show: true, ok: false, reason: "device-offline" }, `offline ${JSON.stringify(input)}`);
      continue;
    }
    if (input.lane === "pending" || input.remote === "loading") assert.deepEqual(dot, { show: false }, `quiet ${JSON.stringify(input)}`);
  }
});

test("printerDotOf: hand-picked rows from the plan's smoke scenarios", () => {
  const base: PrinterDotInput = { remote: "none", isHostDevice: false, lane: "system", local: "none", deviceOffline: false, desktopChosen: "unknown" };
  assert.equal(verdictOf(printerDotOf(base)), "no-printer", "S1 no host, no printer");
  assert.equal(verdictOf(printerDotOf({ ...base, lane: "raster", local: "connected" })), "ok", "S2");
  assert.equal(verdictOf(printerDotOf({ ...base, remote: "ok" })), "ok", "S3");
  assert.equal(verdictOf(printerDotOf({ ...base, remote: "offline" })), "host-offline", "S4");
  assert.equal(verdictOf(printerDotOf({ ...base, remote: "printer-off" })), "host-printer-off", "S5");
  assert.equal(verdictOf(printerDotOf({ ...base, remote: "ok", isHostDevice: true, lane: "raster", local: "disconnected" })), "printer-off", "S6 flip");
  assert.equal(verdictOf(printerDotOf({ ...base, deviceOffline: true })), "device-offline", "S7");
});

test("W-L: a desktop shell with no printer chosen is red no-printer; an older shell (unknown) and a chosen one stay green", () => {
  const desktop: PrinterDotInput = { remote: "none", isHostDevice: false, lane: "desktop", local: "none", deviceOffline: false, desktopChosen: "none" };
  assert.deepEqual(printerDotOf(desktop), { show: true, ok: false, reason: "no-printer" }, "no host, shell with no printer");
  assert.deepEqual(printerDotOf({ ...desktop, desktopChosen: "unknown" }), { show: true, ok: true, reason: "ok" }, "an older shell cannot say: green as before");
  assert.deepEqual(printerDotOf({ ...desktop, desktopChosen: "chosen" }), { show: true, ok: true, reason: "ok" });
  const host: PrinterDotInput = { ...desktop, remote: "ok", isHostDevice: true };
  assert.equal(verdictOf(printerDotOf(host)), "no-printer", "the host PC cannot print though the server says online");
  assert.equal(verdictOf(printerDotOf({ ...host, remote: "offline" })), "no-printer", "fixing the printer outranks host-offline");
  assert.equal(verdictOf(printerDotOf({ ...host, isHostDevice: false })), "ok", "another device prints: this PC missing printer does not matter");
  assert.equal(verdictOf(printerDotOf({ ...host, deviceOffline: true })), "device-offline", "offline still outranks");
});

test("W-N: a printer that is still connecting reads checking, never printer-off", () => {
  const raster: PrinterDotInput = { remote: "none", isHostDevice: false, lane: "raster", local: "connecting", deviceOffline: false, desktopChosen: "unknown" };
  assert.equal(verdictOf(printerDotOf(raster)), "checking");
  assert.equal(verdictOf(printerDotOf({ ...raster, remote: "ok", isHostDevice: true })), "checking");
  assert.equal(verdictOf(printerDotOf({ ...raster, local: "disconnected" })), "printer-off", "a settled failure is still red");
});

// ── Copy: names, headlines, details ──────────────────────────────────────────
test("printerButtonName: exact strings, one per state", () => {
  assert.equal(PRINTER_BUTTON_NAME_OK, "Printer connected — open printer", "connected");
  assert.equal(PRINTER_BUTTON_NAME_BAD, "Printer not connected — open printer", "not connected");
  assert.equal(PRINTER_BUTTON_NAME_NONE, "Open printer", "nothing set up");
  assert.equal(printerButtonName({ show: false }), "Open printer", "no dot: the plain name");
  assert.equal(printerButtonName({ show: true, ok: true, reason: "ok" }), "Printer connected — open printer", "ok: the connected name");
  assert.equal(printerButtonName({ show: true, ok: false, reason: "no-printer" }), "Printer not connected — open printer", "no printer: the not-connected name");
});

// ── R2-W7: a printer that is only being checked is neither connected nor not connected ───────────────
test("R2-W7: reason checking has its own button name and NO dot; every other state keeps its name and colour", () => {
  assert.equal(PRINTER_BUTTON_NAME_CHECKING, "Checking the printer — open printer", "checking");
  assert.equal(printerButtonName({ show: true, ok: false, reason: "checking" }), PRINTER_BUTTON_NAME_CHECKING);
  assert.notEqual(PRINTER_BUTTON_NAME_CHECKING, PRINTER_BUTTON_NAME_BAD, "the header must not say not connected for a printer that is only connecting");
  assert.equal(printerDotTone({ show: true, ok: false, reason: "checking" }), "none");
  assert.equal(printerDotTone({ show: false }), "none");
  assert.equal(printerDotTone({ show: true, ok: true, reason: "ok" }), "green");
  assert.equal(printerDotTone({ show: true, ok: false, reason: "printer-off" }), "red");
});

// Independent of the production helper: the colour is a function of the VERDICT alone.
const toneOf = (verdict: Verdict): PrinterDotTone => (verdict === "none" || verdict === "checking" ? "none" : verdict === "ok" ? "green" : "red");

test("R2-W7: over every input combination the button tone and name follow the oracle (checking is never red, never 'not connected')", () => {
  const names = new Set<string>();
  let checking = 0;
  for (const input of allInputs()) {
    const verdict = oracle(input);
    const dot = printerDotOf(input);
    assert.equal(printerDotTone(dot), toneOf(verdict), JSON.stringify(input));
    const name = printerButtonName(dot);
    names.add(name);
    const expectedName =
      verdict === "none" ? PRINTER_BUTTON_NAME_NONE : verdict === "checking" ? PRINTER_BUTTON_NAME_CHECKING : verdict === "ok" ? PRINTER_BUTTON_NAME_OK : PRINTER_BUTTON_NAME_BAD;
    assert.equal(name, expectedName, JSON.stringify(input));
    if (verdict === "checking") checking += 1;
  }
  assert.ok(checking > 0, "the sweep reaches checking");
  assert.equal(names.size, 4, "ok / bad / none / checking");
});

const REASONS: PrinterDotReason[] = [
  "ok", "device-offline", "checking", "no-printer", "printer-off", "printer-needs-tap",
  "printer-elsewhere", "host-offline", "host-printer-off", "host-print-window", "printer-problem",
];

function dotFor(reason: PrinterDotReason): PrinterDot {
  return { show: true, ok: reason === "ok", reason };
}

// Built by concatenation so this file never contains the banned phrases itself.
const BANNED = [["print", " host"].join(""), ["dia", "log"].join(""), ["sil", "ent"].join("")];
const CAFE_NAME = ["luci", "fer"].join("");

// PX-2 Task 6 (R11, on purpose): printerHeadlineOf and its copy went (the panel was its only reader). Its exact-copy cases
// are printer-status-view.test.ts's, in the new words; the two sweeps below read printerStatusViewOf instead.
const viewInput = (dot: PrinterDot, over: Partial<PrinterStatusViewInput> = {}): PrinterStatusViewInput => ({
  dot, hostLabel: null, printer: null, noun: "this device", isHostDevice: false, canPrintHere: true, desktopNoPrinter: false, localStatus: "none", here: [], waiting: null, notHere: [], isAdmin: false, ...over,
});

test("colour is never the only signal: every dot has a button name and a headline", () => {
  for (const input of allInputs()) {
    const dot = printerDotOf(input);
    assert.notEqual(printerButtonName(dot).trim(), "", `button name for ${JSON.stringify(input)}`);
    assert.notEqual(printerStatusViewOf(viewInput(dot, { isHostDevice: input.isHostDevice })).headline.trim(), "", `headline for ${JSON.stringify(input)}`);
  }
  assert.notEqual(printerStatusViewOf(viewInput({ show: false })).headline, "", "no dot yet: a headline too");
});

test("copy is plain English: no banned words and no cafe name in any headline, detail or button name", () => {
  const inputs: Partial<PrinterStatusViewInput>[] = [
    { hostLabel: "Counter PC", printer: { name: "Kitchen printer", transport: "bluetooth" } },
    { isHostDevice: true, canPrintHere: false, desktopNoPrinter: true, noun: "this PC" },
    { hostLabel: "Counter PC", printer: { name: "Kitchen printer", transport: "usb" }, canPrintHere: false, localStatus: "disconnected" },
    { hostLabel: "Counter PC", printer: { name: "Kitchen printer", transport: "network" }, canPrintHere: false, localStatus: "elsewhere" },
  ];
  const texts: string[] = [PRINTER_BUTTON_NAME_OK, PRINTER_BUTTON_NAME_BAD, PRINTER_BUTTON_NAME_NONE, PRINTER_BUTTON_NAME_CHECKING];
  for (const reason of REASONS) {
    for (const i of inputs) {
      const v = printerStatusViewOf(viewInput(dotFor(reason), i));
      texts.push(v.headline, v.detail, ...v.steps, v.action?.label ?? "", v.link?.label ?? "", v.note ?? "");
    }
  }
  assert.ok(texts.length > 30, "the sweep read real strings");
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const word of BANNED) assert.ok(!lower.includes(word), `"${text}" must not contain "${word}"`);
    assert.ok(!lower.includes(CAFE_NAME), `"${text}" must not name the cafe`);
  }
});

// ── Phase 2 Session 2D (spec §10): the dot in printers mode ─────────────────
// No host plays a part: a device that writes printers shows its own printer, red when a printer it writes is not
// its printer; any other device's slips print at the cafe's printers (the waiting count and the alarm speak).
const PRINTERS_BASE: PrinterDotInput = { remote: "none", isHostDevice: false, lane: "raster", local: "connected", deviceOffline: false, desktopChosen: "unknown" };

test("2D: printers mode — a writer shows its own printer; one writing a printer that is not its own is red; any other device is green", () => {
  const mode = (isWriter: boolean, allLocal: boolean) => ({ printersMode: true, isWriter, allLocal });
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, printers: mode(true, true) }), { show: true, ok: true, reason: "ok" }, "its printer is connected");
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, local: "disconnected", printers: mode(true, true) }), { show: true, ok: false, reason: "printer-off" }, "its printer is off");
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, printers: mode(true, false) }), { show: true, ok: false, reason: "printer-not-here" }, "a printer it writes is not its printer");
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, local: "none", lane: "system", printers: mode(false, true) }), { show: true, ok: true, reason: "printers-elsewhere" }, "an ordering device needs no printer");
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, remote: "offline", isHostDevice: true, printers: mode(false, true) }), { show: true, ok: true, reason: "printers-elsewhere" }, "a former host's record plays no part");
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, lane: "desktop", desktopChosen: "none", printers: mode(true, true) }), { show: true, ok: false, reason: "no-printer" }, "a Windows writer with no printer chosen");
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, deviceOffline: true, printers: mode(true, true) }), { show: true, ok: false, reason: "device-offline" }, "offline still wins");
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, lane: "pending", printers: mode(true, true) }), { show: false }, "no dot before the lane is known");
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, remote: "offline", printers: { printersMode: false, isWriter: false, allLocal: true } }), { show: true, ok: false, reason: "host-offline" }, "simple mode is unchanged");
});

// Phase 2 Session 2F1 (spec §9.2, §10): on the POS app with bridge v2 the dot is the worst state among its printers this
// device prints, not only the device's own.
test("2F1: printers mode on bridge v2 — the dot is the worst state among the app's printers this device prints", () => {
  const mode = { printersMode: true, isWriter: true, allLocal: true };
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, printers: { ...mode, worst: "disconnected" } }), { show: true, ok: false, reason: "printer-off" }, "the bar printer is down, the device's own connected");
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, local: "disconnected", printers: { ...mode, worst: "connected" } }), { show: true, ok: true, reason: "ok" }, "every printer it prints is connected");
  assert.deepEqual(printerDotOf({ ...PRINTERS_BASE, printers: { ...mode, worst: "connecting" } }), { show: true, ok: false, reason: "checking" }, "one still connecting: checking");
});

test("2D: printers mode — the button's name and tone for the two new states (their words: printer-status-view.test.ts)", () => {
  assert.equal(printerButtonName({ show: true, ok: true, reason: "printers-elsewhere" }), PRINTER_BUTTON_NAME_OK, "the cafe's printers print: ok");
  assert.equal(printerDotTone({ show: true, ok: false, reason: "printer-not-here" }), "red", "a printer it writes is not its own");
});

// Phase 3 Session 3B (spec §10): a printer this device prints (writes by the setup, or took over) that its POS app says is
// out of paper, has its cover open or reports an error turns the dot red, in that printer's words. Low paper still
// prints, so it never does; a link that is down says so first (its Reconnect fix).
test("3B: a printer of this device out of paper, its cover open or in error is red with its words; low paper is not; a down link first", () => {
  const base = { remote: "none" as const, isHostDevice: false, lane: "raster" as const, local: "connected" as const, deviceOffline: false, desktopChosen: "unknown" as const };
  const printers = { printersMode: true, isWriter: true, allLocal: true, worst: "connected" as const };
  const out = printerDotOf({ ...base, printers: { ...printers, problem: { name: "Kitchen", problem: "paper-out" } } });
  assert.deepEqual(out, { show: true, ok: false, reason: "printer-problem", problem: "Kitchen is out of paper." });
  assert.equal(printerButtonName(out), "Printer needs attention — open printer", "a printer problem: needs attention");
  assert.equal(printerDotTone(out), "red");
  const down = printerDotOf({ ...base, printers: { ...printers, worst: "disconnected", problem: { name: "Kitchen", problem: "cover-open" } } });
  assert.equal(down.show && down.reason, "printer-off", "a printer that does not answer: reconnect it first");
  assert.deepEqual(printerDotOf({ ...base, printers }), { show: true, ok: true, reason: "ok" }, "nothing known: green as before");
});

// Phase 3 Session 3E (spec §9.6): on the Windows app 1.12.0 a network printer it writes that does not answer turns the dot
// red as it would on the POS app; with every one connected, or none known yet, the Windows rows stay as before.
test("3E: on the Windows app a network printer it writes that does not answer is red; otherwise as before", () => {
  const desktop = { remote: "none" as const, isHostDevice: false, lane: "desktop" as const, local: "none" as const, deviceOffline: false, desktopChosen: "chosen" as const };
  const mode = { printersMode: true, isWriter: true, allLocal: true };
  assert.deepEqual(printerDotOf({ ...desktop, printers: { ...mode, worst: "disconnected" } }), { show: true, ok: false, reason: "printer-off" }, "the kitchen does not answer");
  assert.deepEqual(printerDotOf({ ...desktop, printers: { ...mode, worst: "connecting" } }), { show: true, ok: false, reason: "checking" }, "being checked");
  assert.deepEqual(printerDotOf({ ...desktop, printers: { ...mode, worst: "connected" } }), { show: true, ok: true, reason: "ok" }, "it answers");
  assert.deepEqual(printerDotOf({ ...desktop, desktopChosen: "none", printers: { ...mode, worst: "connected" } }), { show: true, ok: true, reason: "ok" }, "a PC whose only printer is a network printer: no Windows printer needs choosing (the gold's review, m-1)");
  assert.deepEqual(printerDotOf({ ...desktop, printers: mode }), { show: true, ok: true, reason: "ok" }, "Windows printers only: as before");
  assert.deepEqual(printerDotOf({ ...desktop, desktopChosen: "none", printers: mode }), { show: true, ok: false, reason: "no-printer" }, "no printer chosen: as before");
});

// Phase 3 Session 3C (the 3B golden-copy review's m-7): in simple mode the device that prints on its POS app's own printer
// turns its dot red with that printer's words too; a device whose slips print at another device keeps that device's row.
test("3C (m-7): simple mode: this device's own printer out of paper, its cover open or in error is red with its words", () => {
  const base = { lane: "raster" as const, local: "connected" as const, deviceOffline: false, desktopChosen: "unknown" as const };
  const printers = { printersMode: false, isWriter: false, allLocal: true, problem: { name: "RPP02N", problem: "cover-open" as const } };
  assert.deepEqual(printerDotOf({ ...base, remote: "none", isHostDevice: false, printers }), { show: true, ok: false, reason: "printer-problem", problem: "RPP02N has its cover open." }, "no print host: this device prints its own slips");
  assert.deepEqual(printerDotOf({ ...base, remote: "ok", isHostDevice: true, printers }), { show: true, ok: false, reason: "printer-problem", problem: "RPP02N has its cover open." }, "the print host itself");
  assert.deepEqual(printerDotOf({ ...base, remote: "ok", isHostDevice: false, printers }), { show: true, ok: true, reason: "ok" }, "another device prints all slips: its row, as before");
  assert.deepEqual(printerDotOf({ ...base, remote: "none", isHostDevice: false, local: "disconnected", printers }), { show: true, ok: false, reason: "printer-off" }, "a printer that does not answer: reconnect it first");
});
