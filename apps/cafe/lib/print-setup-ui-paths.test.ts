import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import { stripComments } from "@/lib/source-pin-utils";
import { stationDeleteQuestion } from "@/lib/print-setup-text";

// Printing redesign, Phase 2 Session 2D (spec §11; plan decision 11): the Printer setup page's sections. Source pins
// for the screens (their rules live in lib/print-setup-form.ts and lib/print-setup-text.ts, unit-tested there).

const CAFE = process.cwd();
const raw = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8").replace(/\r\n/g, "\n");
const src = (rel: string): string => stripComments(raw(rel));
const lines = (text: string): number => text.replace(/\n$/, "").split("\n").length;
const SETUP = "components/print/setup/";
const FILES = ["PrintSetupSections.tsx", "PrintersSetupSection.tsx", "PrinterFormDialog.tsx", "SetUpPrintersCard.tsx", "StationsSetupSection.tsx", "DevicesSetupSection.tsx"].map((f) => `${SETUP}${f}`);

test("PIN (2D): the admin Printer setup page shows the outlet's sections after this device's panel", () => {
  const page = src("app/(dashboard)/printers/page.tsx");
  assert.match(page, /import \{ PrintSetupSections \} from "@\/components\/print\/setup\/PrintSetupSections";/);
  const panel = page.indexOf("<PrinterPanel />");
  const sections = page.indexOf("<PrintSetupSections />");
  assert.ok(panel >= 0 && sections > panel, `the panel (${panel}) then the sections (${sections})`);
  const container = src(`${SETUP}PrintSetupSections.tsx`);
  const order = ["<PrintersSetupSection", "<StationsSetupSection", "<DevicesSetupSection"].map((tag) => container.indexOf(tag));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > (order[i - 1] ?? 0))), "Printers, Kitchen stations, Devices");
  assert.match(container, /void qc\.invalidateQueries\(\{ queryKey: PRINTERS_KEYS\.all \}\);/, "the printers are read again when the page opens");
  // The 2D gate's review (I-1, M-1): nothing shows, and so nothing saves, before both lists are in; the 2D review gate
  // (M-7): the devices too, or every remote printer reads "has not checked in" and the LAN form offers no device.
  assert.match(container, /if \(!loaded \|\| !ready \|\| !devicesLoaded\) return <p role="status"/, "the sections wait for the printers, the stations and the devices");
  assert.match(container, /if \(failed \|\| stationsFailed \|\| devicesFailed\) return <p role="alert"/, "and say so when any read failed");
  assert.match(container, /const \{ printers, loaded, failed \} = usePrintersRead\(true\);/, "the agent's entry, read without a second subscription");
});

test("PIN (2D, spec §6.6): with no printer, Set up printers comes first, makes Printer 1 from this device's printer, and only on the device that prints today", () => {
  const section = src(`${SETUP}PrintersSetupSection.tsx`);
  assert.match(section, /printers\.length === 0 \? \(\s*<SetUpPrintersCard deviceId=\{deviceId\} \/>/, "no Add printer before a printer exists");
  const card = src(`${SETUP}SetUpPrintersCard.tsx`);
  assert.match(card, /await save\.mutateAsync\(\{ body: setUpPrintersBody\(here\) \}\);/, "Printer 1 from this device's printer");
  assert.match(card, /const elsewhere = known && remote !== "none" && !isHostDevice;/, "a device that is not the print host is told where to do it");
  assert.ok(!card.includes("usePosPulse" + "Context"), "the narrow dot context, never the wide pulse");
  assert.match(card, /disabled=\{reason !== null \|\| save\.isPending\}/);
  // Session 2D's final review (M-1, the 2C gate's M-6 words): with no host, other devices' slips move to Printer 1,
  // so the toast after the tap must not say that nothing changes; it says what the text above the button says.
  assert.ok(!card.includes("Nothing changes on paper"), "the toast never says nothing changes on paper");
  assert.match(card, /const DONE_MESSAGE = "Printer 1 is set up\. This device's paper does not change, and other devices' slips print here too\.";/, "the toast says where other devices' slips print now");
});

test("PIN (2D): each printer row: its state in words, on/off, Test print only when it can print, edit, delete with a question", () => {
  const section = src(`${SETUP}PrintersSetupSection.tsx`);
  assert.match(section, /const state = printerRowState\(printer, devices, \{ deviceId, localIds, canPrint \}\);/);
  assert.match(section, /const localIds = agentPrintersOf\(printers, deviceId, local, desktop\)\.localIds;/, "from the list the page holds (Session 2E: and this PC's Windows printers)");
  // The 2D review gate (M-4): a printer its writer's lease would never take, or one this device writes but cannot print
  // right now, is not tested (the slip would only wait).
  assert.match(section, /const blocked = testPrintBlock\(printer, printers, \{ deviceId, localIds, canPrint \}\);/, "Test print only when its slip can print");
  assert.match(section, /disabled=\{blocked !== null \|\| testPrint\.isPending\}/);
  assert.match(section, /await testPrint\.mutateAsync\(printer\.id\);\s*toast\.success\(testPrintSentText\(printer, state\)\);/);
  assert.match(section, /printerBodyOf\(\{ \.\.\.printerDraftOf\(printer, stations\), enabled: !printer\.enabled \}, printers, printer\.id\)/, "on/off saves the printer whole, through the same rules as the form");
  // The 2D review gate (M-5): switching a printer off fails its waiting slips (the sweep), so it asks first, as Delete does.
  assert.match(section, /question=\{`Switch \$\{printer\.name\} off\? Slips still waiting for it will show under Couldn't print\.`\}/, "switching off asks first");
  assert.match(section, /onCheckedChange=\{\(\) => \(printer\.enabled \? setSwitchingOff\(printer\.id\) : void toggle\(printer\)\)\}/, "switching on needs no question");
  assert.match(section, /question=\{`Delete \$\{printer\.name\}\? Slips still waiting for it will show under Couldn't print\.`\}/);
  assert.match(section, /\{gaps\.map\(\(gap\) => \(/, "what the setup leaves without a printer is said above the list");
});

test("PIN (2D, spec §11): the printer form: a network printer's printing device from the Android app devices, this device's printer never typed, Full KOT copy clears the stations", () => {
  const form = src(`${SETUP}PrinterFormDialog.tsx`);
  assert.match(form, /const result = printerBodyOf\(draft, printers, printer\?\.id\);/, "the body and its rules from the pure lib");
  assert.match(form, /devices\.filter\(\(device\) => device\.shell === "android" && device\.deviceId !== deviceId\)/, "only Android app devices print to a LAN printer for now");
  assert.match(form, /\[\.\.\.\(caps\.native && deviceId !== "" \? \[deviceId\] : \[\]\), \.\.\.android\]/, "this device when it is the Android app");
  assert.match(form, /onClick=\{\(\) => setDraft\(\(current\) => draftWithLocal\(current, here\)\)\}/, "Use this device's printer copies its saved printer");
  assert.match(form, /onChange=\{\(kotAll\) => set\(\{ kotAll, \.\.\.\(kotAll \? \{ kotStations: \[\] \} : \{\}\) \}\)\}/, "Full KOT copy clears the station boxes");
  assert.match(form, /disabled=\{draft\.kotAll\}/, "and keeps them off while it is on");
  assert.ok(form.includes("static IP") && form.includes("DHCP reservation"), "the fixed-address tip");
});

test("PIN (2D, the 2A gate's M5): a station's delete names the printers it leaves with nothing; the default is never deleted, said in words", () => {
  const stations = src(`${SETUP}StationsSetupSection.tsx`);
  assert.match(stations, /<InlineConfirm question=\{stationDeleteQuestion\(station, printers\)\}/);
  assert.match(stations, /\{!station\.isDefault && \(/, "no Delete or Make default on the default station");
  assert.ok(stations.includes("The default station can't be deleted. Make another station the default first."));
  assert.match(stations, /save\.mutateAsync\(\{ id: station\.id, body: \{ isDefault: true \} \}\)/, "Make default moves the flag");
  const bar: StationConfig = { id: "s-bar", name: "Bar", order: 1, isDefault: false };
  const barPrinter: PrinterConfig = {
    id: "p",
    name: "Bar printer",
    connection: { kind: "device", deviceId: "d", transport: "usb", address: "x" },
    order: 0,
    paper: 80,
    slips: { bill: false, kotStations: ["s-bar"], kotAll: false, notices: false, eod: false },
    copies: { kot: 1, bill: 1 },
    enabled: true,
  };
  assert.equal(stationDeleteQuestion(bar, [barPrinter]), "Delete Bar? Its categories, items and printers go back to the default station. Bar printer will then take no slips and stop printing.");
  assert.equal(stationDeleteQuestion(bar, []), "Delete Bar? Its categories, items and printers go back to the default station.");
});

test("PIN (2D): the Devices section lists each device, online or when last seen, and the printers it prints", () => {
  const devices = src(`${SETUP}DevicesSetupSection.tsx`);
  // The 2D review gate (M-8): only printers routing sends slips to (switched on and taking a slip).
  assert.match(devices, /routablePrinters\(printers\)\.filter\(\(printer\) => printerWriterDeviceId\(printer\) === device\.deviceId\)/, "the printers it prints: switched-off ones, and ones taking no slip, are not");
  assert.match(devices, /device\.online \? "Online" : `Offline · seen \$\{seenAt\(device\.lastSeenAt\)\}`/);
});

// The 2D review gate (M-3): the waiting-slips panel only shows printer names; it reads the agent's entry, so an admin
// save costs this device one printers read, never two (the agent's subscription is the only one).
test("PIN (the 2D review gate, M-3): only the agent's printers read subscribes; the waiting-slips panel reads the same entry", () => {
  const card = src("components/print/WaitingSlipsCard.tsx");
  assert.match(card, /const \{ printers \} = usePrintersRead\(true\);/);
  assert.ok(!/usePrinters\(/.test(card), "no subscription of its own");
  const hook = src("hooks/use-print-setup.ts");
  assert.match(hook, /return \{ devices: query\.data \?\? NO_DEVICES, loaded: query\.isSuccess, failed: query\.isError \};/, "the devices read says when it is in and when it failed");
});

test("PIN (2D): the setup screens are client components, stay small, never log, and keep every write's error at its hook", () => {
  for (const rel of FILES) {
    const text = raw(rel);
    assert.ok(text.startsWith('"use client";'), `${rel} is a client component`);
    assert.ok(lines(text) <= 220, `${rel} stays <= 220 lines, got ${lines(text)}`);
    assert.ok(!/console\./.test(text), `${rel} never logs`);
    assert.ok(!/\.mutate\(/.test(src(rel)), `${rel} awaits mutateAsync (a per-call callback fires only for the latest call)`);
  }
});
