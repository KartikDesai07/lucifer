// Printer UX PX-3 Task 10 (spec §6.6; mockups t-settings / t-host): the settings view as cards. The pure words of each card
// (which state "Print for other devices" is in, the stop question, More's rows, the device card's title and the printer's
// sub, the Faster KOTs row), then source pins over the frame of the view: the cards' order, the focus targets that moved
// with their controls, the handlers the two hooks keep from PrinterSetupCard, and the one pulse reader. Every pin is
// proven to bite by an in-memory mutation of the real file (nothing is written).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { PrintHostState } from "@pos/shared/print-job";
import { stripComments } from "@/lib/source-pin-utils";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import {
  MORE_ROW_WORDS,
  deviceCardTitleOf,
  moreRowsOf,
  printForOthersViewOf,
  printerSubOf,
  stopQuestionOf,
  textKotRowWordsOf,
} from "@/lib/printer/settings-view";

const CAFE = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

const SETTINGS = "components/print/settings/";
const VIEW = `${SETTINGS}PrinterSettingsView.tsx`;
const FOR_OTHERS = `${SETTINGS}PrintForOthersCard.tsx`;
const DEVICE = "components/print/DevicePrinterSection.tsx";
const TEST_PRINT = "hooks/use-test-print.ts";
const SETUP_ACTIONS = "hooks/use-printer-setup-actions.ts";

const host = (over: Partial<PrintHostState> = {}): PrintHostState => ({
  configured: true,
  deviceId: "dev-counter",
  label: "Counter PC",
  lastSeenAt: null,
  offline: false,
  silentMode: true,
  printer: null,
  ...over,
});
const simple = { printersMode: false, isHostDevice: false, host: host({ configured: false, label: null }), hostLabel: null, online: true };

test("print for others: each state's view", () => {
  assert.deepEqual(printForOthersViewOf({ ...simple, printersMode: true }), { kind: "hidden" }, "printers mode on a device that is not the printing device: the card is not drawn");
  assert.deepEqual(printForOthersViewOf({ ...simple, printersMode: true, isHostDevice: true }), { kind: "host", printersMode: true }, "printers mode on a former printing device: it can still stop");
  assert.deepEqual(printForOthersViewOf({ ...simple, isHostDevice: true, host: host(), hostLabel: "Counter PC" }), { kind: "host", printersMode: false }, "this device prints for all devices");
  assert.deepEqual(printForOthersViewOf({ ...simple, host: null }), { kind: "checking", text: "Checking where slips print…" }, "the pulse has not answered yet");
  assert.deepEqual(
    printForOthersViewOf({ ...simple, host: null, online: false }),
    { kind: "checking", text: "This device is offline. Where slips print will show here when it is back online." },
    "offline reads as a status line, never as loading (PR3)",
  );
  assert.deepEqual(printForOthersViewOf({ ...simple, host: host(), hostLabel: "Counter PC" }), { kind: "elsewhere", host: "Counter PC", online: true }, "another device prints all slips and is online");
  assert.deepEqual(printForOthersViewOf({ ...simple, host: host({ offline: true }), hostLabel: "Counter PC" }), { kind: "elsewhere", host: "Counter PC", online: false }, "the printing device is offline: Print here instead designates at once");
  assert.deepEqual(printForOthersViewOf(simple), { kind: "offer" }, "no printing device set: offer this one");
});

test("the stop question says the cancel only in simple mode", () => {
  assert.equal(stopQuestionOf(false), "Removing the printing device cancels every waiting slip. Continue?", "simple mode: today's confirm words");
  assert.equal(stopQuestionOf(true), "Stop printing here? Each printer keeps printing its own slips.", "printers mode: no slip is cancelled, so the question never says so (B10)");
});

const allRows = { native: true, battery: true, printersMode: false, isHostDevice: false, hostSet: true, isAdmin: true, home: "sheet" as const };

test("More draws only the rows that apply", () => {
  assert.deepEqual(moreRowsOf(allRows), ["change-address", "battery", "remove-host", "printer-setup"], "the app with battery steps, a printing device set elsewhere, an admin in the sheet: all four, in order");
  assert.deepEqual(moreRowsOf({ ...allRows, home: "page" }), ["change-address", "battery", "remove-host"], "on /printers, which IS Printer setup, no link to it (X8)");
  assert.deepEqual(moreRowsOf({ ...allRows, isHostDevice: true }), ["change-address", "battery", "printer-setup"], "the printing device stops from its own card, not from More");
  assert.deepEqual(moreRowsOf({ ...allRows, printersMode: true }), ["change-address", "battery", "printer-setup"], "printers mode has no printing device to remove");
  assert.deepEqual(moreRowsOf({ ...allRows, battery: false }), ["change-address", "remove-host", "printer-setup"], "Battery settings only on an app that has the battery steps (X9)");
  assert.deepEqual(moreRowsOf({ ...allRows, hostSet: false }), ["change-address", "battery", "printer-setup"], "nothing to remove when no printing device is set");
  assert.deepEqual(moreRowsOf({ native: false, battery: false, printersMode: false, isHostDevice: false, hostSet: false, isAdmin: false, home: "sheet" }), [], "Chrome staff with no printing device: no row, so no card");
});

test("the words of More's rows", () => {
  assert.deepEqual(
    MORE_ROW_WORDS,
    { "change-address": "Change POS address", battery: "Battery settings", "remove-host": "Remove the printing device", "printer-setup": "Printer setup" },
    "the rows' words, as the spec says them",
  );
});

test("the device card's title and sub", () => {
  assert.equal(deviceCardTitleOf("desktop"), "This PC's printer", "the Windows app");
  for (const lane of ["raster", "none", "system", "pending"] as const) assert.equal(deviceCardTitleOf(lane), "This device's printer", `${lane}: every other lane`);
  const rpp: DevicePrinter = { kind: "native", name: "RPP02N", paper: "80mm", printerId: "bt-classic:A", transport: "bt-classic" };
  assert.equal(printerSubOf(rpp), "Bluetooth · 80 mm paper", "a Bluetooth 80 mm printer");
  assert.equal(printerSubOf({ ...rpp, paper: "58mm" }), "Bluetooth · 58 mm paper", "a 58 mm roll");
  assert.equal(printerSubOf({ ...rpp, transport: "tcp" }), "Network · 80 mm paper", "the type word is today's printerTypeLabel");
});

test("Faster KOTs rows name the printer only when there are two", () => {
  assert.deepEqual(textKotRowWordsOf("Kitchen printer", 1), { label: "Print KOTs as plain text", sub: "English only. Prints in about 1 second." }, "one printer: the card says which");
  assert.deepEqual(textKotRowWordsOf("Kitchen printer", 2), { label: "Print KOTs as plain text", sub: "Kitchen printer · English only. Prints in about 1 second." }, "two or more: each row names its printer");
});

// ── Source pins (comments stripped) ─────────────────────────────────────────
type Pin = (code: string) => string[];
const need = (problems: string[], ok: boolean, message: string): void => {
  if (!ok) problems.push(message);
};

const ORDER = ["<DevicePrinterSection", "<PrintForOthersCard", "<TextKotSection", "<BillPrinterSection", "<MoreCard"];
const orderPin: Pin = (code) => {
  const p: string[] = [];
  const at = ORDER.map((tag) => code.indexOf(tag));
  need(p, at.every((i, n) => i >= 0 && (n === 0 || i > (at[n - 1] ?? 0))), `device < print for others < Faster KOTs < bill printer < More: ${at.join(", ")}`);
  for (const tag of ORDER) need(p, count(code, tag) === 1, `${tag} drawn once`);
  return p;
};

// The status card's fixes focus these (PX-2's SETUP_TARGETS): the device card, and the one designate control of each state
// that has one (the offer: its opener, or once open the form's button; another device prints: Print here instead).
const STATES = ["checking", "offer", "host", "elsewhere"] as const;
const designatePin: Pin = (code) => {
  const p: string[] = [];
  need(p, count(code, 'data-action="designate"') === 1, 'data-action="designate" written once, on the designate button');
  const starts = STATES.map((kind) => code.indexOf(`{view.kind === "${kind}" &&`));
  need(p, starts.every((i, n) => i >= 0 && (n === 0 || i > (starts[n - 1] ?? 0))), `the four states drawn in turn: ${starts.join(", ")}`);
  STATES.forEach((kind, n) => {
    const slice = code.slice(starts[n], n + 1 < STATES.length ? starts[n + 1] : undefined);
    const designates = kind === "offer" || kind === "elsewhere";
    need(p, slice.includes("designateButton(") === designates, `${kind}: ${designates ? "draws" : "never draws"} the designate button`);
  });
  return p;
};
const devicePin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes('data-printer-target="device"') && code.includes("tabIndex={-1}"), 'the device card keeps data-printer-target="device" and tabIndex={-1}');
  return p;
};

const testPrintPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes("await queueTestSlip()"), "the test slip goes through the bridge's queueTestSlip()");
  need(p, code.includes("useBeatPrintHost("), "the attestation is the host beat");
  need(p, code.includes('startDisabled: current !== null || phase !== "idle" || beat.isPending'), "Test print waits for a free bridge, an idle test and the beat");
  return p;
};
const setupActionsPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes("Printing device removed — "), "the clear's toast");
  need(p, /writeDevicePrefs\(\{ \.\.\.prefs, printHost: false \}\);\s*syncHostPref\(\);/.test(code), "dropping the printing device syncs every lane");
  need(p, /writeDevicePrefs\(\{ \.\.\.prefs, printHost: true \}\);\s*syncHostPref\(\);/.test(code), "designating syncs every lane");
  need(p, count(code, "usePosPulseContext(") === 1, "the hook is the settings view's one pulse reader");
  return p;
};

const settingsFiles = (): string[] => readdirSync(path.join(CAFE, SETTINGS)).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts")).map((f) => `${SETTINGS}${f}`);

const CASES: { name: string; file: string; pin: Pin; mutations: [string, string, string][] }[] = [
  { name: "the settings view draws its cards in §6.6's order", file: VIEW, pin: orderPin, mutations: [
    ["More first", "<DevicePrinterSection", "<MoreCard /><DevicePrinterSection"],
    ["a card dropped", "<TextKotSection />", "<span />"],
  ] },
  { name: "the focus targets moved with their controls (PrintForOthersCard)", file: FOR_OTHERS, pin: designatePin, mutations: [
    ["a second designate target", "data-action=\"designate\"", "data-action=\"designate\" data-x data-action=\"designate\""],
    ["the elsewhere state lost its control", 'designateButton(PRINT_HERE_INSTEAD', "noButton(PRINT_HERE_INSTEAD"],
  ] },
  { name: "the focus targets moved with their controls (DevicePrinterSection)", file: DEVICE, pin: devicePin, mutations: [["the target dropped", 'data-printer-target="device"', 'data-x="device"']] },
  { name: "the hooks keep today's handlers (use-test-print)", file: TEST_PRINT, pin: testPrintPin, mutations: [
    ["the gate loosened", 'phase !== "idle" || beat.isPending', 'phase !== "idle"'],
    ["not awaited", "await queueTestSlip()", "queueTestSlip()"],
  ] },
  { name: "the hooks keep today's handlers (use-printer-setup-actions)", file: SETUP_ACTIONS, pin: setupActionsPin, mutations: [
    ["no sync after a designate", "writeDevicePrefs({ ...prefs, printHost: true });", "writeDevicePrefs({ ...prefs, printHost: true }); void 0;"],
    ["the pulse read twice", "usePosPulseContext()", "usePosPulseContext() ?? usePosPulseContext()"],
  ] },
];

for (const c of CASES) {
  test(c.name, () => {
    const code = stripComments(read(c.file));
    assert.ok(code.length > 100, `${c.file} was read`);
    assert.deepEqual(c.pin(code), [], `${c.file}\n  - ${c.pin(code).join("\n  - ")}`);
  });
}

test("no card reads the pulse twice", () => {
  const files = settingsFiles();
  assert.ok(files.includes(VIEW) && files.includes(FOR_OTHERS) && files.includes(`${SETTINGS}MoreCard.tsx`), `the settings cards were found: ${files.join(", ")}`);
  for (const file of files) assert.equal(count(stripComments(read(file)), "usePosPulseContext("), 0, `${file}: the cards read the printing device through the hook`);
  assert.equal(count(stripComments(read(SETUP_ACTIONS)), "usePosPulseContext("), 1, "once, in use-printer-setup-actions.ts");
});

test("every source pin bites: a mutation of the real file is noticed", () => {
  for (const c of CASES) {
    const code = stripComments(read(c.file));
    for (const [name, from, to] of c.mutations) {
      const mutated = code.replace(from, to);
      assert.notEqual(mutated, code, `${c.file} :: ${name}: the mutation changed the source`);
      assert.ok(c.pin(mutated).length >= 1, `${c.file} :: ${name}: the pin did not notice`);
    }
  }
});
