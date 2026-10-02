// Printer panel (04-web-plan.md slice W5b) — RAW source pins over the panel, its
// setup sections and the /printers page: the panel reads the pulse and
// shows the banner BEFORE the card, the ids/data-action the banner focuses, the
// click-handler call sites of connectNew/reconnect (the chooser must be the
// first await, so the call is made by the click itself), the page has no own
// guard or narrow column, every control is 44px (PR1/PR2), and no jargon (PR6).
// Same PinCase + in-memory mutation self-check idiom as polish-pages-paths.test.ts:
// every pin must report a problem for each named mutation of its own file.
// Needles that a scanned file must not carry are built by concatenation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const PRINT = "apps/cafe/components/print/";
const SETTINGS = "apps/cafe/app/(dashboard)/settings/";
const F = {
  panel: `${PRINT}PrinterPanel.tsx`,
  where: `${PRINT}PrintWhereSection.tsx`,
  device: `${PRINT}DevicePrinterSection.tsx`,
  native: `${PRINT}NativePrinterPicker.tsx`,
  paper: `${PRINT}PaperSizeToggle.tsx`,
  tips: `${PRINT}PrinterTestTips.tsx`,
  advanced: `${PRINT}PrinterAdvanced.tsx`,
  card: `${PRINT}PrinterSetupCard.tsx`,
  parts: `${PRINT}PrintHostCardParts.tsx`,
  type: `${PRINT}printer-type.ts`,
  section: `${PRINT}PrinterSection.tsx`,
  connect: `${PRINT}BrowserPrinterConnect.tsx`,
  picker: `${PRINT}DesktopPrinterPicker.tsx`,
  slip: `${PRINT}PrintHostTestSlip.tsx`,
  classes: `${PRINT}printer-classes.ts`,
  page: "apps/cafe/app/(dashboard)/printers/page.tsx",
  hub: `${SETTINGS}page.tsx`,
  layout: `${SETTINGS}layout.tsx`,
  sections: "apps/cafe/lib/settings-sections.ts",
};
const PRINTING_DESCRIPTION = "Choose where slips print and connect the printer on this device.";

// ── Machinery ───────────────────────────────────────────────────────────────
type Pin = (raw: string) => string[];
interface Mutation {
  name: string;
  apply: (src: string) => string;
}
interface PinCase {
  file: string;
  pin: Pin;
  mutations: Mutation[];
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const lines = (raw: string): number => raw.replace(/\n$/, "").split("\n").length;
const check = (problems: string[], ok: boolean, message: string): void => {
  if (!ok) problems.push(message);
};
const mut = (name: string, from: string | RegExp, to: string): Mutation => ({ name, apply: (s) => s.replace(from, to) });
const append = (name: string, text: string): Mutation => ({ name, apply: (s) => `${s}\n${text}\n` });

function pinNeedles(needles: readonly string[], source: "code" | "raw" = "code"): Pin {
  return (raw) => {
    const p: string[] = [];
    const src = source === "code" ? stripComments(raw) : raw;
    for (const n of needles) check(p, src.includes(n), `must contain ${n}`);
    return p;
  };
}

// ── Pins ────────────────────────────────────────────────────────────────────
const panelPin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  const readers = ["usePosPulseContext()", "usePrintHostDot()", "usePrintHostContext()", "useDevicePrinter()", "usePrintLane()", "useDeviceOnline()"];
  for (const n of readers) check(p, count(code, n) === 1, `must call ${n} exactly once`);
  check(p, count(code, "printerDotOf({") === 1 && code.includes("local: snapshot.status"), "printerDotOf gets the snapshot STATUS as local");
  check(p, code.includes("printerHeadlineOf(dot, {"), "the copy comes from printerHeadlineOf");
  check(p, /<div data-printer-panel className="space-y-4">/.test(code), "W-P: the root carries data-printer-panel (the banner looks inside it)");
  check(p, count(code, "useDesktopPrinterChosen()") === 1 && code.includes("desktopChosen }") && code.includes('desktopNoPrinter: lane === "desktop" && desktopChosen === "none"'), "W-L: the dot and the copy get the desktop shell's printer choice");
  check(p, count(code, "useCanPrintNow()") === 1 && code.includes("canPrintHere,"), "W-T: the copy knows whether this device can print");
  check(p, /printerName: snapshot\.printer\?\.name \?\? null,\s*localStatus: snapshot\.status,/.test(code), "R2-W8: the copy knows the saved printer's status on this device");
  check(p, code.includes("hostLabel: host !== null && host.configured ? host.label : null"), "the host label comes from the pulse");
  check(p, !/hostLabel:\s*"/.test(code), "the host label must never be a literal");
  check(p, code.includes("dot.show ? dot : CHECKING_DOT") && /reason: "checking"/.test(code), "no dot yet -> the checking banner");
  const banner = code.search(/<PrinterStatusBanner\s/);
  const card = code.search(/<PrinterSetupCard\s*\/>/);
  check(p, banner >= 0 && card >= 0 && banner < card, `the banner (${banner}) must come BEFORE the card (${card})`);
  check(p, /onDone !== undefined && \(/.test(code) && code.includes("onClick={onDone}"), "a Done button when onDone is passed");
  return p;
};

const wherePin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  check(p, code.includes('id="printer-where"'), 'section id="printer-where"');
  check(p, count(code, 'data-action="designate"') === 1 && /<Button\s+data-action="designate"/.test(code), "the designate button carries data-action once");
  const own = code.indexOf("isHostDevice ? (");
  const loading = code.indexOf("host === null ? (");
  check(p, own >= 0 && loading > own, "this device is the printing device is decided BEFORE the unresolved-pulse line");
  check(p, code.includes('role="status"') && code.includes("online ? CHECKING_MESSAGE : OFFLINE_MESSAGE"), "PR3: offline reads as a status line");
  check(p, !/still loading/i.test(raw), "never a 'still loading' line");
  const needles = ["Where slips print", "This device prints all slips.", "All slips print at {hostLabel}.", "Each device prints its own slips.", "Name for this device", "Print all slips on this device", "Print on this device instead", "is printing now. Move printing to this device?", "<PrinterSection", "Use one device for all printing", "Good for a Counter PC with the printer: orders from phones print there."];
  for (const n of needles) check(p, code.includes(n), `must contain ${n}`);
  return p;
};

const devicePin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  check(p, code.includes('data-printer-target="device"') && code.includes("tabIndex={-1}"), 'root data-printer-target="device" with tabIndex={-1} (the banner focuses it)');
  check(p, !code.includes('id="printer-device"'), "W-P: no page-wide id (the sheet and the settings page can both be open)");
  check(p, code.includes("toastConnectOutcome(attempt)"), "the connect outcome is toasted by the shared helper");
  // The chooser must be the first await: the CLICK makes the call, nothing awaits before it.
  // 2026-10-02 UI pass: ONE primary "Connect printer" (serial first: it lists paired Bluetooth and
  // USB printers; Web Bluetooth only where serial is missing) plus a quiet "nearby" fallback.
  check(p, code.includes('const primaryKind = caps.serial ? "serial" : "ble";'), "the primary kind is chosen synchronously: serial first, else nearby");
  check(p, /onConnect=\{\(\) => void settle\(devicePrinter\(\)\.connectNew\(primaryKind, paperDefault\), true\)\}/.test(code), "connectNew(primaryKind called straight from the primary click");
  check(p, /onSearchNearby=\{\(\) => void settle\(devicePrinter\(\)\.connectNew\("ble", paperDefault\)\)\}/.test(code), 'connectNew("ble" called straight from the nearby click');
  check(p, count(code, "connectNew(") === 2, "connectNew( has exactly the two click call sites");
  // Review 2026-10-02: a closed nearby search no longer wipes the advice; Change / Keep / Remove start clean.
  check(p, /if \(outcome === "connected"\) \{\s*setChanging\(false\);\s*setNotSeen\(false\);/.test(code), "a connect clears the not-seen hint");
  check(p, /else if \(firstList && outcome === "cancelled"\) \{\s*setNotSeen\(true\);/.test(code), "only a closed FIRST list raises the not-seen hint");
  check(p, count(code, "setNotSeen(false)") === 3, "the hint is also cleared by Change / Keep printer and by Remove");
  check(p, code.includes("paired={caps.serial}") && code.includes("nearby={caps.serial && caps.bluetooth}"), "the connect block hears what this browser can do: the paired list, and the nearby search only when BOTH exist");
  check(p, code.includes('variant={connected ? "outline" : "default"}'), "Reconnect is the primary button only while not connected");
  check(p, !/Bluetooth LE/i.test(code), "no radio jargon (Bluetooth LE) in client copy");
  check(p, /onClick=\{\(\) => void settle\(devicePrinter\(\)\.reconnect\(\)\)\}/.test(code) && count(code, ".reconnect()") === 1, ".reconnect() called straight from onClick, once");
  check(p, code.includes("const paperDefault = printConfigOf(settings.data).bill.paperWidth;"), "paperDefault comes from the print settings");
  check(p, code.includes("const locked = busy || elsewhere;"), "one busy state plus the other-tab state lock everything");
  const buttons = code.split("<Button").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("</Button>")));
  // The connect buttons moved to BrowserPrinterConnect (connectPin); the saved printer's three stay here.
  check(p, buttons.length >= 3 && buttons.every((b) => b.includes("disabled={locked}")), "every printer button is disabled while locked");
  check(p, count(code, "<BrowserPrinterConnect") === 1 && count(code, "<PrinterSection") === 1, "one connect block, one section shell");
  check(p, /lane === "desktop" \? \(\s*<DesktopPrinterPicker \/>/.test(code) && code.includes("caps.native") && code.includes("<NativePrinterPicker"), "desktop picker / app picker by capability");
  check(p, code.includes("devicePrinter().setPaper(paper)") && code.includes("<PaperSizeToggle") && code.includes("devicePrinter().forget()"), "paper toggle and remove are wired");
  for (const n of ["Printer on this device", "Change printer", "Keep this printer","from this device?", "This browser or app cannot connect to a printer directly", "PRINTER_ELSEWHERE_STATUS_MESSAGE"]) {
    check(p, code.includes(n), `must contain ${n}`);
  }
  check(p, !/print window/i.test(code), "W-M: never claim a print window opens where the browser cannot print directly");
  return p;
};

// 2026-10-02 UI pass: one "Connect printer" with three plain steps; the nearby search is a
// quiet second way, only where the browser has BOTH; the hint shows only after a closed list.
const connectPin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  const needles = ["Connect printer", "Search nearby printers", "Printer not in the list?", "How to connect", "Turn the printer on and load paper.", "Bluetooth printer: pair it in this device's Bluetooth settings first. USB printer: plug it in.", "Keep the printer close to this device.", "Tap Connect printer, then pick your printer from the list.", "Finds printers that do not need pairing.", "Did not see your printer? Pair it in Bluetooth settings first (USB printer: check the cable), then tap Connect printer again", "Did not see your printer? Turn it on and keep it close, then tap Connect printer again.", " — or tap Search nearby printers.", "paired ? NOT_SEEN_PAIRED : NOT_SEEN_NEARBY_ONLY"];
  for (const n of needles) check(p, code.includes(n), "must contain " + n);
  const buttons = code.split("<Button").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("</Button>")));
  check(p, buttons.length === 2 && buttons.every((b) => b.includes("disabled={locked}")), "both connect buttons exist and are disabled while locked");
  const primary = code.indexOf("onClick={onConnect}");
  const nearby = code.indexOf("onClick={onSearchNearby}");
  check(p, primary >= 0 && nearby > primary, "the primary button (" + primary + ") comes before the nearby one (" + nearby + ")");
  check(p, /\{nearby && \(\s*<div/.test(code) && /paired \? STEP_PAIR : STEP_CLOSE/.test(code), "the nearby row shows only when both ways exist; step 2 follows the browser");
  check(p, /\{notSeen && \(\s*<p role="status"/.test(code), "the not-seen hint is a status line, shown only after a closed list");
  check(p, !/Bluetooth LE/i.test(code), "no radio jargon (Bluetooth LE) in client copy");
  return p;
};
const typePin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  for (const n of ['"bt-classic": "Bluetooth"', 'ble: "Bluetooth (nearby)"', 'tcp: "Network"', 'usb: "USB"', 'PC_PRINTER_LABEL = "PC printer"']) check(p, code.includes(n), "must contain " + n);
  check(p, !/Bluetooth LE/i.test(code), "no radio jargon (Bluetooth LE) in client copy");
  return p;
};
const sectionPin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  for (const n of ["BRAND_PANEL_CLASS", '"rounded-lg border"', "{...rest}", "<h3", "border-b border-brand-rule", "space-y-3 p-4 text-sm", "PRINTER_TILE_CLASS"]) check(p, code.includes(n), "must contain " + n);
  return p;
};
const partsPin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  for (const n of ['"Connected"', '"Connecting…"', '"Not connected"', "{printerTypeLabel(printer)} · ", "printerTypeIcon(printer)", "break-words font-medium"]) check(p, code.includes(n), "must contain " + n);
  // Review 2026-10-02: every status has its own words; another tab holding the printer is never "Not connected".
  for (const n of ['elsewhere: "In another tab"', '"needs-tap": "Tap Reconnect"', "STATUS_LABEL[status]", "Record<PrinterStatus, string>"]) check(p, code.includes(n), "must contain " + n);
  return p;
};

const nativePin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  const needles = ["listNative(false)", "listNative(true)", "selectNative({ id: printer.id }, paper)", "selectNative({ tcp: { host, port: portNumber } }, paper)", 'nativeRequest("bluetooth.enable")', 'nativeRequest("permissions.request", { kind: "bluetooth" })', "nativeErrorMessage(", "PRINTER_SCAN_MS", "String(DEFAULT_TCP_PRINTER_PORT)", 'inputMode="numeric"', 'bluetooth === "unsupported"', "Use this printer", "Find printers", "Network printer (Wi-Fi or Ethernet)", "NATIVE_TYPE_ICONS"];
  for (const n of needles) check(p, code.includes(n), `must contain ${n}`);
  check(p, count(code, "toast.error(nativeErrorMessage(error))") >= 4, "every app request failure is worded by nativeErrorMessage");
  // A quoted or assigned 9100 is a literal default; the hint sentence "use 9100." is copy, not code.
  check(p, !/["'`=:(,]\s*9100\b/.test(code), "the default port is the shared constant, never a literal");
  check(p, code.includes("isValidPrinterHost(host)") && code.includes("splitHostPort(") && code.includes("ADDRESS_MESSAGE"), "W-AA: the address is checked like the app checks it, and host:port is split");
  check(p, !code.includes("const ADDRESS_MAX_CHARS") && !/\\s\/\.test\(host\)/.test(code), "W-AA: no second, weaker host check of its own");
  check(p, code.includes("onPaste={"), "W-AA: a pasted host:port fills both fields");
  // s63 INT: the name keeps the visible label first (WCAG 2.5.3 label-in-name), then names the printer.
  check(p, code.includes("aria-label={`Use this printer: ${printer.name}`}"), "W-W: each printer button names its printer");
  return p;
};

const cardPin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  const needles = ["<PrintWhereSection", "<DevicePrinterSection />", "<PrinterTestTips />", "stopControl={isHostDevice ? clearControl : null}", "<PrinterAdvanced clearControl={isHostDevice ? null : clearControl} />", "const testable = isHostDevice || lane === \"raster\";", "useState<string | null>(null)", "label ?? (lane === \"pending\" ? DEVICE_LABEL_PC : defaultDeviceLabel(lane))", "Did the test slip print?", "No — help me", "Did it print without a print window?", "Printing works on this device.", "Print test slip", "No printing device is set.", "Busy with another slip."];
  for (const n of needles) check(p, code.includes(n), `must contain ${n}`);
  check(p, count(code, "const clearControl =") === 1, "clearControl is built once");
  const body = code.slice(code.indexOf("const handleAttest"), code.indexOf("const handleClear"));
  const guard = body.indexOf('if (!silentMode && lane === "raster")');
  const tips = body.indexOf("setShowTips(true)");
  const notHost = body.indexOf("if (!isHostDevice)");
  const toast = body.indexOf("TEST_WORKS_MESSAGE");
  const beat = body.indexOf("beat.mutateAsync(");
  check(p, guard >= 0 && tips > guard && notHost > tips && toast > notHost && beat > toast, `handleAttest order: raster-No tips (${tips}) < non-host toast (${toast}) < beat (${beat})`);
  return p;
};

// 2026-10-02: Printer setup left Settings for /printers, so the page now guards
// itself (AdminGuard outside, brand shell inside — the Staff page's idiom) and
// uses the shared PageHeader, not the settings header with its "Settings" back link.
const pagePin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  const guard = code.indexOf("<AdminGuard>");
  const shell = code.indexOf("<MenuPageShell>");
  check(p, guard >= 0 && shell > guard, "the page guards itself: <AdminGuard> wraps <MenuPageShell> (no settings layout above it any more)");
  check(p, code.split("<AdminGuard>").length - 1 === 1, "the page renders <AdminGuard> once");
  check(p, code.includes('from "@/components/shared/AdminGuard"'), "the guard is the shared AdminGuard, not a local stand-in");
  check(p, !raw.includes("max-w-" + "2xl"), "the page is not the narrow column");
  check(p, !code.includes("SettingsPageHeader"), "no settings header (its back link points at Settings)");
  check(p, code.includes("max-w-3xl") && code.includes("<PrinterPanel />") && code.includes("<PageHeader") && code.includes('eyebrow="Admin"'), "positive landmarks: section-page width, the panel, the shared header under the Admin eyebrow");
  check(p, code.includes(`description="${PRINTING_DESCRIPTION}"`) && code.includes('title="Printer setup"'), "title and description");
  return p;
};
const layoutPin: Pin = (raw) => {
  const p: string[] = [];
  check(p, /<AdminGuard>[\s\S]*\{children\}[\s\S]*<\/AdminGuard>/.test(stripComments(raw)), "settings/layout.tsx still guards every settings child");
  return p;
};
// The Settings hub and section list no longer carry Printer setup at all (it is
// the /printers page now); only the old shortcut copy ban is kept for them.
const goneFromSettingsPin: Pin = (raw) => {
  const p: string[] = [];
  const code = stripComments(raw);
  check(p, code.length > 0, "landmark: the file has code to scan");
  check(p, !code.includes(PRINTING_DESCRIPTION) && !code.includes("Printer " + "setup"), "no Printer setup entry or copy left in Settings");
  check(p, !raw.includes("POS Printer " + "shortcut"), "no stale 'POS Printer shortcut' copy");
  return p;
};

// Every control 44px (PR1/PR2), no jargon (PR6), no console, no cafe name.
function hygienePin(budget: number, usesAction: boolean): Pin {
  return (raw) => {
    const p: string[] = [];
    check(p, lines(raw) <= budget, `must stay <= ${budget} lines, got ${lines(raw)}`);
    check(p, !raw.includes("console" + "."), "no console.");
    check(p, !new RegExp("Luci" + "fer", "i").test(raw), "no cafe name");
    // UI copy only (comments stripped): the owner (PR6) bans these words on screen.
    const copy = stripComments(raw);
    for (const word of ["print " + "host", "silent " + "printing", "dia" + "log"]) check(p, !new RegExp(word, "i").test(copy), `no jargon: ${word}`);
    check(p, !raw.includes('size="' + 'sm"') && !/\bh-(8|9|10)\b/.test(raw), "no sub-44px control size");
    if (usesAction) check(p, count(raw, "PRINTER_ACTION_CLASS") >= 2, "controls take the shared 44px class");
    return p;
  };
}
const HYGIENE: [string, number, boolean][] = [
  [F.panel, 90, true], [F.where, 150, true], [F.device, 220, true], [F.native, 260, true], [F.paper, 60, true],
  [F.tips, 50, false], [F.advanced, 100, true], [F.card, 260, true], [F.parts, 100, true], [F.picker, 160, false],
  [F.connect, 110, true], [F.section, 50, false], [F.type, 60, false],
];
const hygieneMutations = [
  append("a console call", "// " + "console" + ".log(1)"),
  append("the cafe name", "// Luci" + "fer"),
  append("jargon in copy", 'const COPY = "Print ' + 'host";'),
  append("a small button", '<Button size="' + 'sm" />'),
  append("a long file", "\n".repeat(400)),
];

const slipPin = pinNeedles(['TEST_SLIP_HEADING = "Test slip"', 'TEST_SLIP_BODY = "If you can read this, this printer works."', "APP_NAME"]);
const pickerPin: Pin = (raw) => {
  const p: string[] = [];
  check(p, /<select\s+className="h-11 [^"]*text-base"/.test(raw), "the printer select is 44px with text-base (PR2)");
  check(p, /<select[^>]*aria-label="Printer"/.test(raw), "W-W: the select has a name a screen reader can read");
  check(p, raw.includes("void refreshDesktopPrinterChosen();"), "W-L: a saved choice is re-read into the shared state");
  // R2-W6: the store follows savePrinter's own answer; the re-read is only a follow-up (it may fail).
  const choose = raw.slice(raw.indexOf("const choose = async"), raw.indexOf("return (", raw.indexOf("const choose = async")));
  check(p, /await api\.savePrinter\(name\);[\s\S]*publishDesktopPrinterSelection\(result\.selected\);[\s\S]*void refreshDesktopPrinterChosen\(\);/.test(choose), "R2-W6: savePrinter -> publish result.selected -> follow-up re-read, in that order");
  check(p, /publishDesktopPrinterSelection,\s*refreshDesktopPrinterChosen/.test(raw) || /import \{[^}]*publishDesktopPrinterSelection[^}]*\} from "@\/lib\/printer\/desktop-printer-state"/.test(raw), "R2-W6: the setter comes from the desktop-printer-state store");
  return p;
};
const classesPin: Pin = (raw) => {
  const p: string[] = [];
  check(p, raw.includes('PRINTER_ACTION_CLASS = "h-11 px-4 text-base"') && raw.includes('PRINTER_INPUT_CLASS = "h-11 text-base md:text-base"'), "the shared control classes are 44px / text-base at every width (W-R)");
  return p;
};

const CASES: PinCase[] = [
  { file: F.panel, pin: panelPin, mutations: [
    mut("banner and card swapped", /(\s*<PrinterStatusBanner[^\n]*\n)(\s*<PrinterSetupCard \/>\n)/, "\n$2$1"),
    mut("a literal host label", "host.configured ? host.label : null", 'host.configured ? "Counter PC" : null'),
    mut("the pulse read dropped", "usePosPulseContext()", "({ pulse: undefined })"),
    mut("the banner renamed", "<PrinterStatusBanner", "<PrinterStatusBannerX"),
    mut("local gets the whole snapshot", "local: snapshot.status", "local: snapshot"),
    mut("the panel marker dropped", "<div data-printer-panel ", "<div "),
    mut("no desktop choice for the dot", "deviceOffline: !online, desktopChosen }", "deviceOffline: !online }"),
    mut("print-here offered blindly", "    canPrintHere,\n", "    canPrintHere: true,\n"),
    mut("the saved printer's status withheld", "    localStatus: snapshot.status,\n", ""),
    mut("the status read from the wrong place", "localStatus: snapshot.status", 'localStatus: "none"'),
  ] },
  { file: F.where, pin: wherePin, mutations: [
    mut("data-action dropped", ' data-action="designate"', ""),
    mut("id renamed", 'id="printer-where"', 'id="where"'),
    mut("offline line dropped", "online ? CHECKING_MESSAGE : OFFLINE_MESSAGE", "CHECKING_MESSAGE"),
    mut("host check renamed", "isHostDevice ? (", "isHostDeviceX ? ("),
    mut("a loading line", "Checking where slips print…", "Still loading"),
    mut("the one-device help dropped", "Good for a Counter PC with the printer: orders from phones print there.", "Every slip prints here."),
    mut("the shell dropped", "<PrinterSection id", "<section id"),
  ] },
  { file: F.device, pin: devicePin, mutations: [
    // Re-anchored 2026-10-02 (one primary "Connect printer"): the old serial/ble click cases became these.
    mut("an await before the primary chooser", "onConnect={() => void settle(devicePrinter().connectNew(primaryKind, paperDefault), true)}", "onConnect={async () => { await Promise.resolve(); void settle(devicePrinter().connectNew(primaryKind, paperDefault), true); }}"),
    mut("the nearby button opens serial", 'connectNew("ble", paperDefault)', 'connectNew("serial", paperDefault)'),
    mut("an await before the nearby chooser", 'onSearchNearby={() => void settle(devicePrinter().connectNew("ble", paperDefault))}', 'onSearchNearby={async () => { await Promise.resolve(); void settle(devicePrinter().connectNew("ble", paperDefault)); }}'),
    mut("the primary kind flipped", 'caps.serial ? "serial" : "ble"', 'caps.serial ? "ble" : "serial"'),
    mut("the hint raised by any cancel", 'else if (firstList && outcome === "cancelled")', 'else if (outcome === "cancelled")'),
    mut("a connect leaves the hint up", "setChanging(false);\n        setNotSeen(false);", "setChanging(false);"),
    mut("change printer keeps a stale hint", "setChanging((v) => !v);\n                      setNotSeen(false);", "setChanging((v) => !v);"),
    mut("nearby offered on a BLE-only browser", "nearby={caps.serial && caps.bluetooth}", "nearby={caps.bluetooth}"),
    mut("paired copy on a BLE-only browser", "paired={caps.serial}", "paired={true}"),
    mut("reconnect always primary", 'variant={connected ? "outline" : "default"}', 'variant="default"'),
    mut("a radio name back in the copy", 'title="Printer on this device"', 'title="Bluetooth LE printer on this device"'),
    mut("reconnect awaited first", "onClick={() => void settle(devicePrinter().reconnect())}", "onClick={async () => { await settle(devicePrinter().reconnect()); }}"),
    mut("a button left enabled", "settle(devicePrinter().reconnect())}\n                    disabled={locked}", "settle(devicePrinter().reconnect())}\n                    disabled={false}"),
    mut("remove button left enabled", 'onClick={() => setConfirmRemove(true)} disabled={locked}', "onClick={() => setConfirmRemove(true)}"),
    mut("the target marker dropped", '      data-printer-target="device"\n', ""),
    mut("the page-wide id back", 'data-printer-target="device"', 'id="printer-device" data-printer-target="device"'),
    mut("a print window claimed", "This browser or app cannot connect to a printer directly.", "This browser cannot connect to a printer directly, so slips open the print window."),
    mut("tabIndex dropped", "      tabIndex={-1}\n", ""),
    mut("paper default hard-coded", "printConfigOf(settings.data).bill.paperWidth", '"80mm"'),
  ] },
  { file: F.native, pin: nativePin, mutations: [
    mut("a literal port", "String(DEFAULT_TCP_PRINTER_PORT)", '"9100"'),
    mut("find does not scan", "listNative(true)", "listNative(false)"),
    mut("numeric keyboard dropped", 'inputMode="numeric"', 'inputMode="text"'),
    mut("bluetooth enable renamed", 'nativeRequest("bluetooth.enable")', 'nativeRequest("bluetooth.on")'),
    mut("raw error text", "nativeErrorMessage(error)", "String(error)"),
    mut("host check dropped", "!isValidPrinterHost(host)", "host === \"\""),
    mut("paste split dropped", "onPaste={", "onPasteX={"),
    mut("printer button unnamed", "aria-label={`Use this printer: ${printer.name}`}", ""),
    mut("the network block loses its title", "Network printer (Wi-Fi or Ethernet)", "Network printer"),
    mut("printer button drops its visible label", "aria-label={`Use this printer: ${printer.name}`}", "aria-label={`Use ${printer.name}`}"),
  ] },
  { file: F.connect, pin: connectPin, mutations: [
    mut("the nearby button left enabled", "onClick={onSearchNearby} disabled={locked}", "onClick={onSearchNearby}"),
    mut("the primary button left enabled", "onClick={onConnect} disabled={locked}", "onClick={onConnect}"),
    mut("the nearby row always shown", "{nearby && (", "{true && ("),
    mut("a radio name back", "Search nearby printers", "Bluetooth LE printers"),
    mut("the hint is no status line", '<p role="status" className="rounded-md', '<p className="rounded-md'),
    mut("step 3 changed", "Tap Connect printer, then pick your printer from the list.", "Tap the button."),
    mut("step 2 ignores the browser", "paired ? STEP_PAIR : STEP_CLOSE", "STEP_PAIR"),
    mut("a BLE-only browser told to pair first", "paired ? NOT_SEEN_PAIRED : NOT_SEEN_NEARBY_ONLY", "NOT_SEEN_PAIRED"),
    mut("USB users get Bluetooth-only advice", " (USB printer: check the cable)", ""),
  ] },
  { file: F.type, pin: typePin, mutations: [
    mut("the radio name back", 'ble: "Bluetooth (nearby)"', 'ble: "Bluetooth LE"'),
    mut("a PC printer renamed", 'PC_PRINTER_LABEL = "PC printer"', 'PC_PRINTER_LABEL = "Serial port"'),
  ] },
  { file: F.section, pin: sectionPin, mutations: [
    mut("the rest props dropped", "{...rest}", ""),
    mut("the hairline dropped", "border-b border-brand-rule", "border-b"),
  ] },
  { file: F.parts, pin: partsPin, mutations: [
    mut("the status words dropped", /"Not connected"/g, '""'),
    mut("another tab reads not connected", 'elsewhere: "In another tab"', 'elsewhere: "Not connected"'),
    mut("the sub-line dropped", "{printerTypeLabel(printer)} · ", ""),
  ] },
  { file: F.advanced, pin: pinNeedles(['nativeRequest("app.changeUrl")', "More options", "Change POS address", "<Collapsible", "usePrintCapabilities()"]), mutations: [
    mut("change-address renamed", 'nativeRequest("app.changeUrl")', 'nativeRequest("app.changeAddress")'),
    mut("label changed", "More options", "Advanced"),
  ] },
  { file: F.paper, pin: pinNeedles(["aria-pressed", "grid-cols-2", "PAPER_WIDTHS.map"]), mutations: [mut("grid dropped", "grid-cols-2", "flex")] },
  { file: F.card, pin: cardPin, mutations: [
    mut("raster No reports", 'if (!silentMode && lane === "raster")', 'if (silentMode && lane === "raster")'),
    mut("non-host guard dropped", "if (!isHostDevice)", "if (isHostDevice === undefined)"),
    mut("clear control placed twice", "<PrinterAdvanced clearControl={isHostDevice ? null : clearControl} />", "<PrinterAdvanced clearControl={clearControl} />"),
    mut("raster question changed", "Did the test slip print?", "Did it print without a dialog?"),
    mut("busy reason dropped", "Busy with another slip.", "Wait."),
    mut("remove reason dropped", "No printing device is set.", "Nothing."),
    mut("label no longer typed-first", "label ?? (lane", "(lane"),
  ] },
  { file: F.page, pin: pagePin, mutations: [
    mut("guard removed", "<AdminGuard>", "<div>"),
    mut("guard swapped for a local stand-in", 'import { AdminGuard } from "@/components/shared/AdminGuard";', "const AdminGuard = ({ children }: { children: ReactNode }) => children;"),
    mut("guard rendered twice", "<AdminGuard>", "<AdminGuard><AdminGuard>"),
    mut("the settings header back", "<PageHeader", "<SettingsPageHeader"),
    mut("eyebrow changed", 'eyebrow="Admin"', 'eyebrow="Settings"'),
    mut("narrow column back", "max-w-3xl", "max-w-" + "2xl"),
    mut("the card instead of the panel", "<PrinterPanel />", "<PrinterSetupCard />"),
    mut("stale description", PRINTING_DESCRIPTION, "Choose the PC that prints."),
  ] },
  { file: F.layout, pin: layoutPin, mutations: [mut("guard removed", "<AdminGuard>", "<div>")] },
  { file: F.hub, pin: goneFromSettingsPin, mutations: [
    append("the card back", 'const CARD = "Printer ' + 'setup";'),
    append("stale shortcut copy", 'const COPY = "Install the POS Printer ' + 'shortcut.";'),
  ] },
  { file: F.sections, pin: goneFromSettingsPin, mutations: [
    append("the entry back", 'const E = { title: "Printer ' + 'setup" };'),
    append("the description back", "const D = \"" + PRINTING_DESCRIPTION + "\";"),
  ] },
  { file: F.picker, pin: pickerPin, mutations: [
    mut("small select back", "h-11 w-full max-w-sm", "h-9 w-full max-w-sm"),
    mut("select unnamed", 'aria-label="Printer"', ""),
    mut("choice not re-read", "void refreshDesktopPrinterChosen();", ""),
    mut("result not published", "      publishDesktopPrinterSelection(result.selected);\n", ""),
    mut("publishes what was asked, not what the shell answered", "publishDesktopPrinterSelection(result.selected)", "publishDesktopPrinterSelection(name)"),
    mut("re-read first, publish last", "      publishDesktopPrinterSelection(result.selected);\n      void refreshDesktopPrinterChosen();", "      void refreshDesktopPrinterChosen();\n      publishDesktopPrinterSelection(result.selected);"),
  ] },
  { file: F.slip, pin: slipPin, mutations: [mut("old heading", 'TEST_SLIP_HEADING = "Test slip"', 'TEST_SLIP_HEADING = "Old test"')] },
  { file: F.classes, pin: classesPin, mutations: [mut("a small action class", "h-11 px-4 text-base", "h-9 px-4 text-sm"), mut("md:text-sm wins again", "text-base md:text-base", "text-base")] },
  ...HYGIENE.map(([file, budget, usesAction]): PinCase => ({ file, pin: hygienePin(budget, usesAction), mutations: hygieneMutations })),
];

for (const c of CASES) {
  test(`PIN: ${c.file.replace("apps/cafe/", "")} — printer panel source pin`, () => {
    const src = readSrc(c.file);
    assert.ok(src.length > 0, `${c.file} must be readable`);
    const problems = c.pin(src);
    assert.deepEqual(problems, [], `${c.file}\n  - ${problems.join("\n  - ")}`);
  });
}

test("MUTATION self-check: every pin reports a problem for each named in-memory mutation", () => {
  let applied = 0;
  for (const c of CASES) {
    assert.ok(c.mutations.length > 0, `${c.file}: every pin case needs at least one mutation`);
    const real = readSrc(c.file);
    assert.deepEqual(c.pin(real), [], `${c.file}: the unmutated source must be clean before it is mutated`);
    for (const m of c.mutations) {
      const mutated = m.apply(real);
      assert.notEqual(mutated, real, `${c.file} :: ${m.name}: the mutation changed nothing`);
      assert.ok(c.pin(mutated).length >= 1, `${c.file} :: ${m.name}: the pin did NOT notice this mutation`);
      applied++;
    }
  }
  assert.ok(applied >= CASES.length, "landmark: mutations were actually applied");
});
