// Printer UX PX-3 Task 11 (spec §6.7; mockups g1–g6; Ruling S3): the guided connect's steps, props only, rendered on the
// server (what a person sees and what a screen reader hears), every word exactly the brief's. Then the source pins: a
// replace keeps a setup printer in the app (the 2F2 M-4 rule, moved), the list's logic is today's (moved, never forked),
// the sheet's views are the button's (Ruling Q), and no part of the connect asks the server again (F-I4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectListView, NetworkFormView, type ConnectListViewProps } from "@/components/print/connect/ConnectList";
import { ConnectProgress } from "@/components/print/connect/ConnectProgress";
import { ConnectTestView, type ConnectTestViewProps } from "@/components/print/connect/ConnectTest";
import { ConnectType } from "@/components/print/connect/ConnectType";
import { connectRowsOf } from "@/lib/printer/connect-flow";
import { stripComments } from "@/lib/source-pin-utils";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/floor-dialogs.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
const noop = (): void => undefined;
const buttons = (html: string): string[] => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
const buttonOf = (html: string, words: string): string => buttons(html).find((b) => b.includes(words)) ?? "";
// The attribute, not the kit's disabled: classes every button carries.
const DISABLED = 'disabled=""';

const PRINTERS = connectRowsOf([
  { id: "c1", name: "RPP02N", transport: "bt-classic", paired: true },
  { id: "b1", name: "POS-58", transport: "ble" },
], "bluetooth");
const listProps = (over: Partial<ConnectListViewProps> = {}): ConnectListViewProps => ({
  transport: "bluetooth", error: null, rows: PRINTERS, bluetooth: "on", scanning: false, scanError: null, refreshing: false, locked: false,
  onConnect: noop, onScan: noop, onRefresh: noop, onTurnOn: noop, onAllow: noop, onAllowLocation: noop, ...over,
});
const list = (over: Partial<ConnectListViewProps> = {}): string => renderToStaticMarkup(createElement(ConnectListView, listProps(over)));
const testProps = (over: Partial<ConnectTestViewProps> = {}): ConnectTestViewProps => ({
  step: "connected", mode: "replace", name: "RPP02N", paper: "80mm", paperDisabled: false, testable: true, printing: false, startDisabled: false, answering: false,
  onPaper: noop, onTest: noop, onSkip: noop, onYes: noop, onNo: noop, onOther: noop, ...over,
});
const tested = (over: Partial<ConnectTestViewProps> = {}): string => renderToStaticMarkup(createElement(ConnectTestView, testProps(over)));

test("step 1: what kind of printer, three 72px rows, USB plugged into the device (X10)", () => {
  const html = renderToStaticMarkup(createElement(ConnectType, { noun: "this tablet", onChoose: noop }));
  assert.ok(html.includes(">What kind of printer?<"), "the question");
  const rows = buttons(html);
  assert.equal(rows.length, 3, "three choices, each one button");
  for (const [n, words] of [["Bluetooth", "Most receipt printers"], ["USB cable", "Plugged into this tablet"], ["Wi-Fi or network", "On the cafe&#x27;s network"]].entries()) {
    assert.ok(rows[n]?.includes(`>${words[0]}<`) && rows[n]?.includes(`>${words[1]}<`), `row ${n + 1}: ${words.join(" / ")}`);
    assert.ok(rows[n]?.includes('type="button"') && rows[n]?.includes("min-h-[72px]"), `row ${n + 1}: a 72px button`);
  }
  assert.ok(!/<div/.test(rows.join("")), "phrasing content only inside a button");
});

test("step 2, Bluetooth: the rows, the first paired Connect is the primary, the scan, Not in the list?", () => {
  const html = list({ scanning: true });
  assert.ok(html.includes(">RPP02N<") && html.includes(">Paired<") && html.includes(">POS-58<") && html.includes(">Nearby<"), "each row: the name over Paired / Nearby");
  const paired = buttonOf(html, 'aria-label="Connect RPP02N"');
  const nearby = buttonOf(html, 'aria-label="Connect POS-58"');
  assert.ok(paired.includes(">Connect<") && paired.includes("bg-primary"), "the first paired row's Connect is the primary");
  assert.ok(nearby.includes(">Connect<") && !nearby.includes("bg-primary") && nearby.includes("border-border"), "the other rows' Connect is outline");
  assert.ok(paired.includes("h-9") && paired.includes("before:-inset-1"), "36px, 44px to a finger");
  assert.ok(html.includes("Looking for more printers…") && html.includes("animate-spin"), "the scan says it looks, with a spinner");
  assert.ok(html.includes(">Not in the list?<") && html.includes(">Turn the printer on.<") && html.includes(">Pair it in Android&#x27;s Bluetooth settings (PIN is often 0000 or 1234).<"), "Not in the list? steps 1 and 2");
  assert.ok(html.includes("Then tap <strong>Search again</strong>."), "step 3, Search again in bold");
  assert.ok(buttonOf(html, ">Search again<").includes(DISABLED), "Search again waits while the scan runs");
  assert.ok(!list().includes("Looking for more printers…") && !buttonOf(list(), ">Search again<").includes(DISABLED), "no scan: no line, Search again ready");
  assert.ok(list({ scanError: "Turn on Location so this tablet can find nearby printers." }).includes("Turn on Location so this tablet can find nearby printers."), "a scan that failed says why in the list, no toast");
  assert.ok(list({ rows: null }).includes("Reading the printer list…"), "while the list is read");
});

// The review's Ruling T11-A: the app's BLE connect (BleTransport.open) does not stop the scan before connectGatt; its
// Classic connect cancels discovery itself. So only a nearby BLE printer waits for the scan; Classic, USB and network rows
// stay live, as mockup g2 shows.
test("step 2: a BLE row's Connect waits for the scan; a Classic one does not", () => {
  const scanning = list({ scanning: true });
  assert.ok(buttonOf(scanning, 'aria-label="Connect POS-58"').includes(DISABLED), "the BLE row waits while the app scans");
  assert.ok(!buttonOf(scanning, 'aria-label="Connect RPP02N"').includes(DISABLED), "the Classic row stays live");
  assert.ok(!buttonOf(list(), 'aria-label="Connect POS-58"').includes(DISABLED), "the scan over: the BLE row is live");
  const usb = list({ transport: "usb", scanning: true, rows: connectRowsOf([{ id: "u1", name: "USB-80", transport: "usb" }], "usb") });
  assert.ok(!buttonOf(usb, 'aria-label="Connect USB-80"').includes(DISABLED), "a USB row stays live");
  assert.ok(buttonOf(list({ locked: true }), 'aria-label="Connect RPP02N"').includes(DISABLED), "every row waits for Turn on / Allow Bluetooth and Refresh");
});

test("step 2: a failed connect says it above the rows", () => {
  const words = "Could not connect to RPP02N. Check it is on, then try again.";
  const html = list({ error: words });
  const alert = html.indexOf('role="alert"');
  assert.ok(alert >= 0 && html.indexOf(words) > alert && html.indexOf(words) < html.indexOf(">RPP02N<"), "role=alert, above the rows");
  assert.ok(html.includes("text-[13px] text-status-bad-ink"), "13px --status-bad-ink");
});

test("step 2, Bluetooth notices: off, not allowed, none", () => {
  const off = list({ bluetooth: "off" });
  assert.ok(off.includes("Bluetooth is off on this device.") && buttonOf(off, ">Turn on Bluetooth<").length > 0, "off: Turn on Bluetooth");
  assert.ok(buttonOf(off, ">Search again<").includes(DISABLED), "no scan while Bluetooth is off");
  const blocked = list({ bluetooth: "unauthorized" });
  assert.ok(blocked.includes("The POS app needs permission to use Bluetooth.") && buttonOf(blocked, ">Allow Bluetooth<").length > 0, "not allowed: Allow Bluetooth");
  const none = list({ bluetooth: "unsupported", rows: [] });
  assert.ok(none.includes("This device has no Bluetooth. You can still use a USB or network printer.") && !none.includes(">Search again<"), "no Bluetooth: the line, no search");
});

test("step 2, USB: its rows and Refresh; none says how", () => {
  const rows = connectRowsOf([{ id: "u1", name: "USB-80", transport: "usb" }], "usb");
  const html = list({ transport: "usb", rows });
  assert.ok(html.includes(">USB-80<") && html.includes(">USB<") && buttonOf(html, 'aria-label="Connect USB-80"').includes(">Connect<"), "a USB row: the name over USB, Connect");
  assert.ok(buttonOf(html, ">Refresh<").length > 0 && !html.includes("Not in the list?"), "Refresh, no Bluetooth help");
  const none = list({ transport: "usb", rows: [] });
  assert.ok(none.includes(">No USB printer found. Connect a powered printer with a USB OTG adapter, then tap Refresh.<"), "none: what to do");
  assert.ok(none.includes("USB connects directly to this phone or tablet using OTG. A printer cabled to a PC must be selected in the POS desktop app on that PC."), "today's OTG note");
  assert.ok(list({ transport: "usb", refreshing: true }).includes("Refreshing printers…"), "today's words while it refreshes");
});

test("step 2, Wi-Fi or network: today's form, a 44px address with 16px text below 720px, Connect", () => {
  const html = renderToStaticMarkup(createElement(NetworkFormView, { error: null, address: "", port: "9100", formError: null, onAddress: noop, onPort: noop, onPaste: noop, onSubmit: noop }));
  assert.ok(html.includes(">Network printer (Wi-Fi or Ethernet)<") && html.includes(">Printer address<") && html.includes(">Port<"), "the label, Printer address, Port");
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];
  assert.equal(inputs.length, 2, "the address and the port");
  for (const input of inputs) assert.ok(input.includes("h-11") && input.includes("max-tab:text-base"), `44px, 16px text below 720px: ${input}`);
  assert.ok(inputs[1]?.includes('inputMode="numeric"') && inputs[0]?.includes('inputMode="url"'), "the keyboards");
  const submit = buttonOf(html, ">Connect<");
  assert.ok(submit.includes('type="submit"') && submit.includes("h-10") && submit.includes("bg-primary"), "Connect: the 40px primary that submits");
  const failed = renderToStaticMarkup(createElement(NetworkFormView, { error: "x", address: "a", port: "0", formError: "The port is a number from 1 to 65535. Most printers use 9100.", onAddress: noop, onPort: noop, onPaste: noop, onSubmit: noop }));
  assert.equal(count(failed, 'role="alert"'), 2, "the flow's line and the form's own check");
});

test("step 3: connecting, a 48px spinner and the words", () => {
  const html = renderToStaticMarkup(createElement(ConnectProgress, { name: "RPP02N" }));
  assert.ok(html.includes(">Connecting to RPP02N…<"), "Connecting to {name}…");
  assert.ok(html.includes("This can take up to 30 seconds. If Android asks to pair, tap <strong>Pair</strong>."), "the wait, Pair in bold");
  assert.ok(html.includes("size-12") && html.includes("animate-spin") && html.includes('role="status"'), "a 48px spinner; a screen reader hears it");
  assert.ok(html.includes("text-[18px] font-semibold") && html.includes("text-[14px]"), "18px / 600 over 14px");
});

test("connected (replace): the green check, Paper width, Print a test slip, Skip", () => {
  const html = tested();
  assert.ok(html.includes(">RPP02N is connected<") && html.includes("size-16") && html.includes("bg-status-ok"), "a 64px green check, {name} is connected");
  assert.ok(html.includes(">Paper width<") && html.includes(">58 mm<") && html.includes(">80 mm<"), "today's paper toggle");
  const print = buttonOf(html, ">Print a test slip<");
  assert.ok(print.includes("h-11") && print.includes("bg-primary"), "Print a test slip: 44px primary");
  assert.ok(buttonOf(html, ">Skip<").length > 0, "Skip");
  assert.ok(!tested({ testable: false }).includes("Print a test slip"), "only where a test proves something");
  assert.ok(tested({ printing: true }).includes(">Printing…<"), "today's words while it prints");
});

test("connected (add): no test slip, the manager names its slips (X4)", () => {
  const html = tested({ mode: "add" });
  assert.ok(html.includes(">RPP02N is connected<") && html.includes(">Your manager chooses which slips it prints, in Printer setup.<"), "the line");
  assert.ok(!html.includes("Print a test slip") && !html.includes("Paper width") && !html.includes(">Skip<"), "nothing to test here");
});

test("the question: did the test slip come out, Yes / No 48px", () => {
  const html = tested({ step: "question" });
  assert.ok(html.includes(">Did the test slip come out?<") && html.includes("size-16") && html.includes("bg-surface-3"), "a 64px neutral circle, the question");
  const yes = buttonOf(html, ">Yes<");
  const no = buttonOf(html, ">No<");
  assert.ok(yes.includes("h-12") && yes.includes("bg-primary") && no.includes("h-12") && no.includes("border-border"), "Yes primary, No outline, 48px each");
  assert.ok(buttonOf(tested({ step: "question", answering: true }), ">Yes<").includes(DISABLED), "one answer at a time");
});

test("No: let's fix it, three tips with the toggle, again, choose another printer", () => {
  const html = tested({ step: "tips" });
  assert.ok(html.includes(">Let&#x27;s fix it<"), "the heading");
  const tips = ["Paper roll: the shiny side faces the print head.", "Switch the printer off and on.", "Try the other paper width."].map((tip) => html.indexOf(`>${tip}<`));
  assert.ok(tips.every((i, n) => i >= 0 && (n === 0 || i > (tips[n - 1] ?? 0))), `the three tips in order: ${tips.join(", ")}`);
  assert.ok(html.indexOf(">Paper width<") > (tips[2] ?? 0), "the toggle with the third");
  assert.ok(buttonOf(html, ">Print the test slip again<").includes("h-11"), "Print the test slip again: 44px");
  assert.ok(buttonOf(html, "Choose another printer").length > 0, "Choose another printer ›");
});

// ── Source pins (comments stripped) ─────────────────────────────────────────
const ATTEMPT = "hooks/use-connect-attempt.ts";
const LIST = "hooks/use-native-printer-list.ts";
const BUTTON = "components/print/PrinterStatusButton.tsx";
const KEEP = "if (!listed(target)) await nativePool().add(target);\n    return devicePrinter().selectNative(target, paperDefault);";
const REPLACE = "replace: (target) => (keepInApp !== undefined ? keepInApp(target) : devicePrinter().selectNative(target, paperDefault)),";

function attemptProblems(code: string): string[] {
  const p: string[] = [];
  if (!code.includes("const keepInApp = pool.active && (inSetup || !known) ?")) p.push("kept in the app while the setup names it here, or is not known yet");
  if (!code.includes(KEEP)) p.push("a new printer is added first; a listed one is only chosen");
  if (!code.includes(REPLACE)) p.push("replace = keepInApp ?? selectNative");
  if (!code.includes("add: (target) => nativePool().add(target),")) p.push("add joins the app's printers");
  return p;
}
function listProblems(code: string): string[] {
  return ["loadPicker(", "createStatusOrder()", "window.addEventListener(NATIVE_READY_EVENT, onReady)", "listNative(true)", "listNative(false)", "statusOrder.fresh(startedAt)", "target: { tcp: { host, port: portNumber } }"].filter((n) => !code.includes(n)).map((n) => `today's ${n}`);
}
// The review's minor 4: one connect at a time, its outcome heard only by a flow still on screen (X3: never aborted), a
// thrown attempt in its own words (T11-B); each tap connects the printer it names (a row by the app's id, the form's address).
const FLOW = "components/print/connect/ConnectFlow.tsx";
const STEP = "components/print/connect/ConnectList.tsx";
function flowProblems(code: string): string[] {
  const p: string[] = [];
  const pick = code.slice(code.indexOf("const pick = "), code.indexOf("const { step, transport } = state;"));
  const [guard, set, picked] = ["if (inFlight.current) return;", "inFlight.current = true;", 'send({ type: "pick"'].map((n) => pick.indexOf(n));
  if (!(guard >= 0 && set > guard && picked > set)) p.push("one connect at a time: the guard, the flag, then the pick");
  if (!/inFlight\.current = false;\s*if \(live\.current\) send\(event\);/.test(pick)) p.push("the flag clears as it settles; only a flow on screen hears it");
  if (!/return \(\) => \{\s*live\.current = false;\s*\};/.test(code)) p.push("leaving the view silences a late outcome");
  if (!pick.includes('(error: unknown): ConnectEvent => ({ type: "failed", message: attemptErrorWordsOf(error) })')) p.push("a thrown attempt says its own words");
  return p;
}
function targetProblems(code: string): string[] {
  const p: string[] = [];
  if (!code.includes("onConnect={(row) => onPick({ id: row.id }, row.name)}")) p.push("a row connects the printer the app listed, by its id");
  if (!code.includes("if (checked.target !== null) onPick(checked.target, `${checked.target.tcp.host}:${checked.target.tcp.port}`);")) p.push("the form connects only the address it checked");
  if (!code.includes('disabled={locked || (scanning && row.transport === "ble")}')) p.push("T11-A: a BLE row waits for the scan");
  return p;
}
function viewsProblems(code: string): string[] {
  const p: string[] = [];
  if (count(code, "usePrinterViews()") !== 1) p.push("the button owns the views");
  if (count(code, 'show("status")') !== 2 || !/if \(next\) show\("status"\);\s*setOpen\(next\);/.test(code)) p.push("the two opens show the status view");
  if (/useState<PrinterPanelView>|if \(!next\)|setOpen\(false\);\s*show/.test(code)) p.push("nothing on close");
  return p;
}

test("replace keeps a setup printer in the app", () => {
  assert.deepEqual(attemptProblems(stripComments(read(ATTEMPT))), [], "use-connect-attempt.ts holds today's keepInApp");
  for (const file of ["components/print/DevicePrinterSection.tsx", "components/print/OtherDevicePrinters.tsx"]) {
    const code = stripComments(read(file));
    assert.ok(!code.includes("selectNative(") && !code.includes("keepInApp") && !code.includes("nativePool().add("), `${file}: no connect call of its own`);
    assert.ok(!code.includes("NativePrinterPicker"), `${file}: no inline picker`);
  }
  assert.ok(!existsSync(path.join(CAFE, "components/print/NativePrinterPicker.tsx")), "the inline picker is gone");
  const flow = stripComments(read("components/print/connect/ConnectFlow.tsx"));
  assert.ok(flow.includes('const run = state.mode === "add" ? attempt.add(target) : attempt.replace(target);'), "the flow's tap: add or replace, by the mode");
});

test("the list's logic is today's", () => {
  assert.deepEqual(listProblems(stripComments(read(LIST))), [], "use-native-printer-list.ts");
  assert.ok(count(stripComments(read(LIST)), "toast.error(nativeErrorMessage(error))") === 3, "a list load, Turn on and Allow toast as today; the scan says it inline");
});

test("one connect at a time, heard only while on screen; each tap connects the printer it names", () => {
  assert.deepEqual(flowProblems(stripComments(read(FLOW))), [], "ConnectFlow's guards");
  assert.deepEqual(targetProblems(stripComments(read(STEP))), [], "the rows' and the form's targets");
});

test("the sheet's views", () => {
  assert.deepEqual(viewsProblems(stripComments(read(BUTTON))), [], "the button");
  assert.ok(stripComments(read("hooks/use-printer-views.ts")).includes('export type PrinterPanelView = "status" | "settings" | "connect";'), "three views");
});

test("every source pin bites: a mutation of the real file is noticed", () => {
  const attempt = stripComments(read(ATTEMPT));
  for (const mutated of [attempt.replace("(inSetup || !known)", "inSetup"), attempt.replace("if (!listed(target)) ", ""), attempt.replace("keepInApp !== undefined ? keepInApp(target) : ", "")]) {
    assert.notEqual(mutated, attempt, "the mutation changed the source");
    assert.ok(attemptProblems(mutated).length > 0, "the attempt pin noticed");
  }
  const listed = stripComments(read(LIST));
  assert.ok(listProblems(listed.replace("statusOrder.fresh(startedAt)", "true")).length > 0, "the list pin noticed a stale reply winning");
  assert.ok(listProblems(listed.replace("target: { tcp: { host, port: portNumber } }", "target: { tcp: { host, port: 9100 } }")).length > 0, "the list pin noticed a port the form did not check");
  const flow = stripComments(read(FLOW));
  const step = stripComments(read(STEP));
  const cases: [string, string, string, (code: string) => string[]][] = [
    [flow, "if (inFlight.current) return;", "", flowProblems], [flow, "if (live.current) send(event);", "send(event);", flowProblems],
    [flow, "live.current = false;\n    };", "};", flowProblems], [flow, "message: attemptErrorWordsOf(error)", "message: undefined", flowProblems],
    [step, "onPick({ id: row.id }, row.name)", "onPick({ id: row.name }, row.name)", targetProblems], [step, "if (checked.target !== null) onPick(", "if (true) onPick(", targetProblems],
    [step, '(scanning && row.transport === "ble")', "scanning", targetProblems],
  ];
  for (const [code, from, to, problems] of cases) {
    const mutated = code.replace(from, to);
    assert.notEqual(mutated, code, `${from}: the mutation changed the source`);
    assert.ok(problems(mutated).length > 0, `${from}: the pin noticed`);
  }
  const button = stripComments(read(BUTTON));
  for (const mutated of [button.replace("if (next) show(\"status\");", "if (next) setOpen(true);"), button.replace("setOpen(next);\n  };", "setOpen(next);\n    if (!next) show(\"status\");\n  };")]) {
    assert.notEqual(mutated, button, "the mutation changed the source");
    assert.ok(viewsProblems(mutated).length > 0, "the views pin noticed");
  }
});

// F-I4 (printer-panel-layout.test.ts), extended to the guided connect: it reads what is cached and the app's own list.
const RECURRING = /refetchInterval|setInterval|router\.refresh|useQuery\(/;
const CONNECT_FILES = ["components/print/connect/ConnectFlow.tsx", "components/print/connect/ConnectType.tsx", "components/print/connect/ConnectList.tsx", "components/print/connect/ConnectProgress.tsx", "components/print/connect/ConnectTest.tsx", ATTEMPT, LIST, "hooks/use-printer-views.ts", "lib/printer/connect-flow.ts"];
test("the guided connect adds no recurring request", () => {
  for (const file of CONNECT_FILES) {
    const raw = read(file);
    assert.ok(raw.length > 100, `${file} was read`);
    assert.ok(!RECURRING.test(raw), `${file}: no refetchInterval, setInterval, router.refresh or useQuery(`);
  }
  assert.ok(RECURRING.test("setInterval(scan, 8000)"), "the needle catches a timer");
});
