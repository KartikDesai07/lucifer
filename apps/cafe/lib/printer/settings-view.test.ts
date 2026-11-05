// Printer UX PX-3 Task 10 (spec §6.6; mockups t-settings / t-host): the settings view as cards. The pure words of each card
// (which state "Print for other devices" is in, the stop question, More's rows, the device card's title and the printer's
// sub, the Faster KOTs row), then source pins over the frame of the view: the cards' order, the focus targets that moved
// with their controls, the handlers the two hooks keep from PrinterSetupCard, the one pulse reader, and (Task 10b) printers
// mode's one card. Every pin is proven to bite by an in-memory mutation of the real file (nothing is written).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { PrintHostState } from "@pos/shared/print-job";
import { stripComments } from "@/lib/source-pin-utils";
import type { PrinterHere } from "@/lib/print-agent-here";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import {
  MORE_ROW_WORDS,
  PRINTERS_CARD,
  blockToneOf,
  deviceCardTitleOf,
  moreRowsOf,
  printForOthersViewOf,
  printerSubOf,
  settingsNameOf,
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
const OTHERS = "components/print/OtherDevicePrinters.tsx";
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
  assert.deepEqual(printForOthersViewOf({ ...simple, isHostDevice: true, host: null, hostLabel: null }), { kind: "host", printersMode: false }, "this device is decided before an unresolved pulse: it can stop before the pulse answers");
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

// PX-3 Task 10b (spec §6.5, §6.6 item 2; mockup t-settings-pm): the client's tablet, its own Kitchen printer and the app's Bill one.
const HERE: PrinterHere[] = [
  { id: "p-kitchen", name: "Kitchen printer", appName: "RPP02N", transport: "bluetooth", status: "disconnected" },
  { id: "p-bill", name: "Bill printer", appName: "POS-80", transport: "bluetooth", nativeId: "bt-classic:BB", status: "connected" },
];
test("the setup names a printer of this device", () => {
  assert.equal(settingsNameOf(HERE, null), "Kitchen printer", "this device's own one printer: the entry with no app id");
  assert.equal(settingsNameOf(HERE, "BT-CLASSIC:bb"), "Bill printer", "an app printer by its id, ignoring case (the app spells a MAC upper-case)");
  assert.equal(settingsNameOf(HERE, "bt-classic:CC"), null, "a printer the setup does not name: the app's own name shows");
  assert.equal(settingsNameOf([HERE[1]!], null), null, "no own printer in the setup: null");
  assert.deepEqual(PRINTERS_CARD, { title: "Printers on this device", sub: "Which slips each one prints: set by your manager." }, "the card's words (also simple mode's note)");
  for (const status of ["none", "disconnected", "needs-tap"] as const) assert.equal(blockToneOf(status), "bad", `${status}: it needs a Reconnect`);
  for (const status of ["connecting", "elsewhere"] as const) assert.equal(blockToneOf(status), "quiet", `${status}: nothing to fix from here`);
  assert.equal(blockToneOf("connected"), "ok", "connected: green");
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
    // Stop is the printing device's own: another device's slips are moved, never cleared, from here.
    need(p, slice.includes("stopControl(") === (kind === "host"), `${kind}: ${kind === "host" ? "draws" : "never draws"} Stop printing here`);
  });
  return p;
};
// B10 (spec §6.9): the stop asks the question of its mode and answers in its words: printers mode cancels nothing.
const b10Pin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes("question={stopQuestionOf(printersMode)}"), "the stop question follows the mode");
  need(p, code.includes('yes={printersMode ? "Yes, stop" : "Yes, remove"}'), 'printers mode answers "Yes, stop", simple mode "Yes, remove"');
  need(p, code.includes("{stopControl(view.printersMode)}"), "the host state hands its mode to the stop");
  return p;
};
const devicePin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes('data-printer-target="device"') && code.includes("tabIndex={-1}"), 'the device card keeps data-printer-target="device" and tabIndex={-1}');
  return p;
};
// PX-3 Task 10b (spec §6.6 item 2, X5–X7): printers mode is one card, this device's printer first, the app's others inside it.
const oneCardPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes('const printersCard = lane !== "desktop" && dot.printersMode && dot.isWriter;'), "the card on a printers-mode writer (the Windows app keeps its picker)");
  need(p, code.includes("title={printersCard ? PRINTERS_CARD.title : deviceCardTitleOf(lane)}") && code.includes("sub={printersCard ? PRINTERS_CARD.sub : undefined}"), "titled Printers on this device, with its sub");
  const others = code.indexOf("<OtherDevicePrinters");
  need(p, count(code, "<PanelSection") === 1 && others > code.indexOf("<PanelSection") && others < code.indexOf("</PanelSection>"), "the app's other printers inside the one card");
  need(p, code.includes("card={printersCard}") && code.includes("here={here}"), "they are told they are the card's, with the setup's names");
  return p;
};
const othersCardPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes("const NOTE = PRINTERS_CARD.sub;") && code.includes("{!card && <p className={PRINTER_LABEL_CLASS}>{TITLE}</p>}") && code.includes("{!card && <p className={PRINTER_NOTE_CLASS}>{NOTE}</p>}"), "simple mode's note is the card's sub; in the card no title or note of their own");
  need(p, code.includes('{adding ? "Close the printer list" : "Connect another printer"}') && code.includes("name={named?.name ?? entry.printer.name}"), "Connect another printer (Close the printer list while open); the setup's name, else the app's");
  return p;
};
// X7: a Reconnect only where the printer is not connected (and on this device's own printer only in printers mode).
const downPin = (gate: string): Pin => (code) => {
  const p: string[] = [];
  need(p, count(code, ".reconnect(") === 1, "one Reconnect call");
  const button = code.lastIndexOf("<Button", code.indexOf(".reconnect("));
  need(p, button > 0 && code.slice(button - 80, button).includes(gate), `Reconnect only behind ${gate}`);
  return p;
};
// X5: the setup's own test (POST /api/printers/:id/test) is the admin's, on a printer the setup names for this device.
const adminTestPin: Pin = (code) => {
  const p: string[] = [];
  const at = [...code.matchAll(/<SetupTestPrint\b/g)].map((m) => m.index ?? 0);
  need(p, at.length === 1 && at.every((i) => /isAdmin && \w+ !== undefined (\?|&&) $/.test(code.slice(i - 50, i))), "the setup's Test print only under isAdmin, only for a printer of here");
  need(p, code.includes("const { isAdmin } = useAuth();") && !code.includes("useTestPrinter("), "the setup's hook only in the admin's button");
  return p;
};
const staffTestPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes("const test = useTestPrint();") && code.includes("const testButton = test.testable && ("), "today's device test where it proves something");
  need(p, code.includes("{ownSetupTest ?? testButton}"), "staff (and a printer the setup does not name) keep it on this device's printer");
  return p;
};
const setupTestPin: Pin = (code) => {
  const p: string[] = [];
  need(p, count(code, "useTestPrinter()") === 1 && /await testPrint\.mutateAsync\(printer\.id\);\s*toast\.success\(testPrintSentText\(printer, PRINTS_HERE\)\);\s*\} catch \{\s*\}/.test(code), "one mutateAsync per tap, the setup's toast; an error is the hook's");
  need(p, code.includes("disabled={disabled || testPrint.isPending}"), "one test at a time");
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
    ["Stop offered while another device prints", "<p>{marked(`Slips print at", "{stopControl(false)}<p>{marked(`Slips print at"],
  ] },
  { name: "B10: the stop's question and answer follow the mode (PrintForOthersCard)", file: FOR_OTHERS, pin: b10Pin, mutations: [
    ["the simple question in printers mode", "question={stopQuestionOf(printersMode)}", "question={stopQuestionOf(false)}"],
    ["one answer for both modes", 'yes={printersMode ? "Yes, stop" : "Yes, remove"}', 'yes="Yes, remove"'],
    ["the mode not handed down", "{stopControl(view.printersMode)}", "{stopControl(false)}"],
  ] },
  { name: "the focus targets moved with their controls (DevicePrinterSection)", file: DEVICE, pin: devicePin, mutations: [["the target dropped", 'data-printer-target="device"', 'data-x="device"']] },
  { name: "printers mode is one card (DevicePrinterSection)", file: DEVICE, pin: oneCardPin, mutations: [
    ["the card on a device that prints nothing", "dot.printersMode && dot.isWriter;", "dot.printersMode;"],
    ["the old title", "title={printersCard ? PRINTERS_CARD.title : deviceCardTitleOf(lane)}", "title={deviceCardTitleOf(lane)}"],
    ["the others outside the card", "{caps.native && <OtherDevicePrinters", "{caps.native && false}</PanelSection><PanelSection>{<OtherDevicePrinters"],
  ] },
  { name: "printers mode is one card (OtherDevicePrinters)", file: OTHERS, pin: othersCardPin, mutations: [
    ["a title of their own in the card", "{!card && <p className={PRINTER_LABEL_CLASS}>{TITLE}</p>}", "<p className={PRINTER_LABEL_CLASS}>{TITLE}</p>"],
    ["the old words", '"Connect another printer"', '"Add another printer"'],
    ["the app's name over the setup's", "name={named?.name ?? entry.printer.name}", "name={entry.printer.name}"],
  ] },
  { name: "Reconnect only on a printer that is down (DevicePrinterSection)", file: DEVICE, pin: downPin('{printersCard && status !== "connected" && ('), mutations: [["a Reconnect in simple mode", '{printersCard && status !== "connected" && (', '{status !== "connected" && ('], ["a Reconnect on a connected printer", '{printersCard && status !== "connected" && (', "{printersCard && ("]] },
  { name: "Reconnect only on a printer that is down (OtherDevicePrinters)", file: OTHERS, pin: downPin('{entry.status !== "connected" && ('), mutations: [["a Reconnect on a connected printer", '{entry.status !== "connected" && (', "{true && ("]] },
  { name: "the setup's test is the admin's (DevicePrinterSection)", file: DEVICE, pin: adminTestPin, mutations: [["staff get it", "isAdmin && ownHere !== undefined ?", "ownHere !== undefined ?"]] },
  { name: "the setup's test is the admin's (OtherDevicePrinters)", file: OTHERS, pin: adminTestPin, mutations: [["on a printer the setup does not name", "isAdmin && named !== undefined && <SetupTestPrint printer={named}", "isAdmin && <SetupTestPrint printer={named!}"]] },
  { name: "the setup's test is today's call (settings/PrinterBlock)", file: `${SETTINGS}PrinterBlock.tsx`, pin: setupTestPin, mutations: [["two taps, two tests", "disabled={disabled || testPrint.isPending}", "disabled={disabled}"], ["a toast of its own on an error", "} catch {", "} catch { toast.error(\"Failed\");"]] },
  { name: "staff keep the device test on this device's printer (DevicePrinterSection)", file: DEVICE, pin: staffTestPin, mutations: [["the device test gone for staff", "{ownSetupTest ?? testButton}", "{ownSetupTest}"]] },
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
