import { test } from "node:test";
import assert from "node:assert/strict";

import type { PosPulseData } from "@pos/shared/self-order-alert";
import type { PrintHostState } from "@pos/shared/print-job";
import {
  HOST_LABEL_FALLBACK,
  PRINTER_BUTTON_NAME_BAD,
  PRINTER_BUTTON_NAME_CHECKING,
  PRINTER_BUTTON_NAME_NONE,
  PRINTER_BUTTON_NAME_OK,
  printHostDotOf,
  printerButtonName,
  printerDotOf,
  printerDotTone,
  printerHeadlineOf,
  type DotLane,
  type PrintHostDot,
  type PrinterDot,
  type PrinterDotInput,
  type PrinterDotReason,
  type PrinterDotTone,
  type PrinterHeadlineInput,
} from "@/lib/printer/printer-dot";
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
  assert.equal(PRINTER_BUTTON_NAME_OK, "Printer connected — open printer setup");
  assert.equal(PRINTER_BUTTON_NAME_BAD, "Printer not connected — open printer setup");
  assert.equal(PRINTER_BUTTON_NAME_NONE, "Open printer setup");
  assert.equal(printerButtonName({ show: false }), "Open printer setup");
  assert.equal(printerButtonName({ show: true, ok: true, reason: "ok" }), "Printer connected — open printer setup");
  assert.equal(printerButtonName({ show: true, ok: false, reason: "no-printer" }), "Printer not connected — open printer setup");
});

// ── R2-W7: a printer that is only being checked is neither connected nor not connected ───────────────
test("R2-W7: reason checking has its own button name and NO dot; every other state keeps its name and colour", () => {
  assert.equal(PRINTER_BUTTON_NAME_CHECKING, "Checking the printer — open printer setup");
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
  "printer-elsewhere", "host-offline", "host-printer-off", "host-print-window",
];

function dotFor(reason: PrinterDotReason): PrinterDot {
  return { show: true, ok: reason === "ok", reason };
}

// Built by concatenation so this file never contains the banned phrases itself.
const BANNED = [["print", " host"].join(""), ["dia", "log"].join(""), ["sil", "ent"].join("")];
const CAFE_NAME = ["luci", "fer"].join("");

test("colour is never the only signal: every dot has a button name and a headline", () => {
  for (const input of allInputs()) {
    const dot = printerDotOf(input);
    assert.notEqual(printerButtonName(dot).trim(), "", `button name for ${JSON.stringify(input)}`);
    assert.notEqual(printerHeadlineOf(dot, { hostLabel: null, printerName: null, isHostDevice: input.isHostDevice, canPrintHere: true, localStatus: "none", desktopNoPrinter: false }).headline.trim(), "");
  }
  assert.notEqual(printerHeadlineOf({ show: false }, { hostLabel: null, printerName: null, isHostDevice: false, canPrintHere: true, localStatus: "none", desktopNoPrinter: false }).headline, "");
});

test("headlines: exact copy for every reason", () => {
  const input = (isHostDevice: boolean, canPrintHere = true): PrinterHeadlineInput => ({ hostLabel: "Counter PC", printerName: "Kitchen printer", isHostDevice, canPrintHere, localStatus: "connected", desktopNoPrinter: false });
  const copy = (reason: PrinterDotReason, isHostDevice = false, canPrintHere = true) => printerHeadlineOf(dotFor(reason), input(isHostDevice, canPrintHere));

  assert.deepEqual(copy("ok"), { headline: "Printing is on", detail: "All slips print at Counter PC.", fix: null });
  assert.deepEqual(copy("ok", true), { headline: "Printing is on", detail: "Kitchen printer is connected.", fix: null });
  assert.deepEqual(printerHeadlineOf(dotFor("ok"), { hostLabel: null, printerName: "Kitchen printer", isHostDevice: false, canPrintHere: true, localStatus: "none", desktopNoPrinter: false }), {
    headline: "Printing is on", detail: "Kitchen printer is connected.", fix: null,
  });
  assert.deepEqual(printerHeadlineOf(dotFor("ok"), { hostLabel: null, printerName: null, isHostDevice: true, canPrintHere: true, localStatus: "none", desktopNoPrinter: false }), {
    headline: "Printing is on", detail: "Slips print on this PC's printer.", fix: null,
  });
  assert.deepEqual(copy("no-printer"), {
    headline: "No printer set up",
    detail: "Connect a printer to this device, or choose one device that prints all slips.",
    fix: "setup",
  });
  assert.deepEqual(copy("printer-off"), {
    headline: "Printer not connected",
    detail: "Kitchen printer is not answering. Check it is on and nearby, then reconnect.",
    fix: "reconnect",
  });
  // W-V: a printer that only needs a tap is not "not answering".
  assert.deepEqual(copy("printer-needs-tap"), {
    headline: "Printer needs a tap",
    detail: "Tap Reconnect to connect Kitchen printer again.",
    fix: "reconnect",
  });
  // W-T: print-here only on a device that can print; otherwise set this one up first.
  const noSaved = (canPrintHere: boolean) => printerHeadlineOf(dotFor("host-offline"), { ...input(false, canPrintHere), printerName: null, localStatus: "none" });
  assert.equal(noSaved(false).fix, "setup");
  assert.equal(copy("host-offline", false, true).fix, "print-here");
  // W-L: the desktop shell with no printer chosen has its own words.
  assert.deepEqual(printerHeadlineOf(dotFor("no-printer"), { ...input(true), desktopNoPrinter: true }), {
    headline: "No printer chosen",
    detail: "Choose this PC's printer below so slips can print.",
    fix: "setup",
  });
  assert.deepEqual(copy("host-offline"), {
    headline: "Counter PC is offline",
    detail: "Slips wait and print when it is back. You can print on this device instead.",
    fix: "print-here",
  });
  assert.equal(copy("host-offline", true).fix, null, "this device cannot move printing to itself");
  // s63 INT: a device that cannot print must not be told it "can print on this device instead"
  assert.deepEqual(noSaved(false), {
    headline: "Counter PC is offline",
    detail: "Slips wait and print when it is back. To print here instead, set up a printer on this device.",
    fix: "setup",
  });
  // R2-W8: a device WITH a saved printer that is not connected is told to reconnect it, not to set one up.
  const saved = (localStatus: PrinterStatus) => printerHeadlineOf(dotFor("host-offline"), { ...input(false, false), localStatus });
  for (const status of ["disconnected", "needs-tap", "connecting"] as const) {
    assert.deepEqual(saved(status), {
      headline: "Counter PC is offline",
      detail: "Slips wait and print when it is back. To print here instead, reconnect Kitchen printer.",
      fix: "reconnect",
    }, status);
  }
  // Another tab holds the printer: no fix can work from here (the banner would only be disabled).
  const elsewhere = saved("elsewhere");
  assert.equal(elsewhere.fix, null);
  assert.equal(elsewhere.headline, "Counter PC is offline");
  assert.match(elsewhere.detail, /^Slips wait and print when it is back\. /);
  assert.ok(/another tab/i.test(elsewhere.detail) && !/set up a printer|reconnect/i.test(elsewhere.detail), elsewhere.detail);
  assert.equal(printerHeadlineOf(dotFor("host-offline"), { ...input(false, false), printerName: null, localStatus: "elsewhere" }).fix, null, "elsewhere with no name of its own still has no fix");
  // A device that CAN print keeps its own button; a device that prints for everyone has no fix.
  assert.equal(printerHeadlineOf(dotFor("host-offline"), { ...input(false, true), localStatus: "connected" }).fix, "print-here");
  assert.equal(printerHeadlineOf(dotFor("host-offline"), { ...input(true, false), localStatus: "disconnected" }).fix, null);
  assert.deepEqual(copy("host-printer-off"), {
    headline: "Printer not connected",
    detail: "Counter PC is on, but its printer is not connected.",
    fix: null,
  });
  assert.deepEqual(copy("device-offline"), {
    headline: "This device is offline",
    detail: "Check the internet connection. Printer status will update when it is back.",
    fix: null,
  });
  assert.equal(copy("checking").headline, "Checking the printer…");
  assert.deepEqual(copy("host-print-window"), {
    headline: "Slips need a tap to print",
    detail: "Counter PC opens a print window for every slip. Set up a printer there so slips print by themselves.",
    fix: null,
  });
  assert.equal(copy("host-print-window", true).fix, "setup");
  assert.deepEqual(copy("printer-elsewhere"), {
    headline: "Printer in another tab",
    detail: "This printer is connected in another tab of this browser. Print from that tab, or close it.",
    fix: null,
  });
  assert.deepEqual(printerHeadlineOf({ show: false }, input(false)), { headline: "Checking the printer…", detail: "", fix: null });
});

test("headlines: a missing or blank host name falls back to a plain phrase, never 'null'", () => {
  for (const hostLabel of [null, "", "   "]) {
    const c = printerHeadlineOf(dotFor("host-offline"), { hostLabel, printerName: null, isHostDevice: false, canPrintHere: true, localStatus: "none", desktopNoPrinter: false });
    assert.equal(c.headline, `${HOST_LABEL_FALLBACK} is offline`);
    assert.ok(!/null|undefined/.test(c.detail));
  }
  const c = printerHeadlineOf(dotFor("printer-off"), { hostLabel: null, printerName: null, isHostDevice: false, canPrintHere: true, localStatus: "none", desktopNoPrinter: false });
  assert.equal(c.detail, "The printer is not answering. Check it is on and nearby, then reconnect.");
});

test("copy is plain English: no banned words and no cafe name in any headline, detail or button name", () => {
  const inputs: PrinterHeadlineInput[] = [
    { hostLabel: "Counter PC", printerName: "Kitchen printer", isHostDevice: false, canPrintHere: true, localStatus: "none", desktopNoPrinter: false },
    { hostLabel: null, printerName: null, isHostDevice: true, canPrintHere: false, localStatus: "none", desktopNoPrinter: true },
    { hostLabel: "Counter PC", printerName: "Kitchen printer", isHostDevice: false, canPrintHere: false, localStatus: "disconnected", desktopNoPrinter: false },
    { hostLabel: "Counter PC", printerName: "Kitchen printer", isHostDevice: false, canPrintHere: false, localStatus: "elsewhere", desktopNoPrinter: false },
  ];
  const texts: string[] = [PRINTER_BUTTON_NAME_OK, PRINTER_BUTTON_NAME_BAD, PRINTER_BUTTON_NAME_NONE, PRINTER_BUTTON_NAME_CHECKING, HOST_LABEL_FALLBACK];
  for (const reason of REASONS) {
    for (const i of inputs) {
      const c = printerHeadlineOf(dotFor(reason), i);
      texts.push(c.headline, c.detail);
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

test("2D: printers mode copy — plain words for the two new states", () => {
  const input: PrinterHeadlineInput = { hostLabel: null, printerName: "Kitchen printer", isHostDevice: false, canPrintHere: true, localStatus: "connected", desktopNoPrinter: false };
  assert.deepEqual(printerHeadlineOf({ show: true, ok: true, reason: "printers-elsewhere" }, input), { headline: "Printing is on", detail: "Each slip prints at its printer (Printer setup).", fix: null });
  assert.deepEqual(printerHeadlineOf({ show: true, ok: false, reason: "printer-not-here" }, input), {
    headline: "A printer is not on this device",
    detail: "This device is set to print a printer that is not its own printer. Check it in Printer setup.",
    fix: "setup",
  });
  assert.equal(printerButtonName({ show: true, ok: true, reason: "printers-elsewhere" }), PRINTER_BUTTON_NAME_OK);
  assert.equal(printerDotTone({ show: true, ok: false, reason: "printer-not-here" }), "red");
});
