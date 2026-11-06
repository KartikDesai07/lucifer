// Printer UX polish after PX-3 (2026-11-06, the owner's "chhoti cleanup"): the minors the PX-3 final review left for later
// (plan "Session PX-3 Results", Deferred). Pure rules first, then source pins (comments stripped), each proven to bite by an
// in-memory mutation of the real file (nothing is written).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { attemptErrorWordsOf, bluetoothRowsOf, networkPrefillOf } from "@/lib/printer/connect-flow";
import { PRINTER_CONNECT_FAILED_MESSAGE } from "@/lib/printer/device-printer-link";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import { nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_ERROR_CODES, type NativePrinter } from "@/lib/printer/native-bridge-protocol";
import { PRINTERS_CARD, SIMPLE_OTHERS_NOTE, otherPrintersNoteOf } from "@/lib/printer/settings-view";
import { NATIVE_BLUETOOTH_OFF_MESSAGE, nativeErrorMessage } from "@/lib/printer/transport-native";
import { PRINTER_ELSEWHERE_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";
import { stripComments } from "@/lib/source-pin-utils";

const CAFE = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

// The within-group order of merged rows: a printer the app lists twice (ble, then bt-classic) sits where the entry it is
// shown as sits, in the app's order, not where its first entry was.
test("a merged Bluetooth row sits where its winning entry is", () => {
  const list: NativePrinter[] = [
    { id: "ble:01", name: "A", transport: "ble", address: "01" },
    { id: "bt-classic:02", name: "B", transport: "bt-classic", paired: true, address: "02" },
    { id: "bt-classic:01", name: "A", transport: "bt-classic", paired: true, address: "01" },
  ];
  assert.deepEqual(bluetoothRowsOf(list).map((r) => [r.id, r.primary]), [["bt-classic:02", true], ["bt-classic:01", false]], "B is listed paired before A's paired entry: B first, and B is the primary");
  const nearby: NativePrinter[] = [
    { id: "bt-classic:03", name: "C", transport: "bt-classic", address: "03" },
    { id: "ble:04", name: "D", transport: "ble", address: "04" },
    { id: "ble:03", name: "C", transport: "ble", address: "03" },
  ];
  assert.deepEqual(bluetoothRowsOf(nearby).map((r) => r.id), ["bt-classic:03", "ble:04"], "the classic entry wins and keeps its own place");
});

// A thrown plain Error's raw words: only a sentence written for staff is shown inline; anything else (a code error's text)
// falls back to the step's own words.
test("a thrown attempt shows only words written for staff", () => {
  const known = [PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_ELSEWHERE_MESSAGE, PRINTER_CONNECT_FAILED_MESSAGE, ...NATIVE_ERROR_CODES.map((code) => nativeErrorMessage(nativeError(code, code)))];
  for (const words of known) assert.equal(attemptErrorWordsOf(new Error(words)), words, `kept: ${words}`);
  assert.equal(attemptErrorWordsOf(new TypeError("Cannot read properties of undefined (reading 'id')")), undefined, "a code error's text is never shown");
  assert.equal(attemptErrorWordsOf(new Error("bridge said no")), undefined, "an unknown sentence: the step's words");
  assert.equal(attemptErrorWordsOf(nativeError("BLUETOOTH_OFF", "raw")), NATIVE_BLUETOOTH_OFF_MESSAGE, "a coded refusal still reads as the app's sentence");
});

const native = (printerId: string, transport: "tcp" | "bt-classic"): DevicePrinter => ({ kind: "native", name: "Kitchen", paper: "80mm", printerId, transport });

// Prefilling the Wi-Fi form on "Connect it again" (and Change): the saved network printer's address and port.
test("the Wi-Fi form starts at the saved network printer", () => {
  assert.deepEqual(networkPrefillOf(native("tcp:192.168.1.50:9100", "tcp")), { host: "192.168.1.50", port: "9100" }, "its address and port");
  assert.equal(networkPrefillOf(native("bt-classic:AA:BB", "bt-classic")), null, "a Bluetooth printer: an empty form");
  assert.equal(networkPrefillOf(native("tcp:not an address", "tcp")), null, "an id the form cannot read: an empty form");
  assert.equal(networkPrefillOf({ kind: "ble", name: "X", paper: "58mm", deviceId: "d", serviceUuid: "s", characteristicUuid: "c" }), null, "a browser's printer: an empty form");
  assert.equal(networkPrefillOf(null), null, "no printer: an empty form");
});

// Simple mode's "set by your manager" sub when another app printer exists: in simple mode every slip prints on this
// device's own printer, so the note says that; a printers-mode device keeps the card's sub.
test("the note under the app's other printers fits the mode", () => {
  assert.equal(otherPrintersNoteOf(false), SIMPLE_OTHERS_NOTE, "simple mode: its own note");
  assert.equal(SIMPLE_OTHERS_NOTE, "Every slip prints on the printer above. Your manager can give these printers their own slips in Printer setup.", "the words");
  assert.equal(otherPrintersNoteOf(true), PRINTERS_CARD.sub, "printers mode: the manager decides, as the card says");
  assert.ok(!SIMPLE_OTHERS_NOTE.includes("Which slips each one prints"), "never the printers-mode sentence in simple mode");
});

type Pin = (code: string) => string[];
const need = (problems: string[], ok: boolean, message: string): void => {
  if (!ok) problems.push(message);
};

const DEVICE = "components/print/DevicePrinterSection.tsx";
const OTHERS = "components/print/OtherDevicePrinters.tsx";
const FLOW = "components/print/connect/ConnectFlow.tsx";
const LIST = "components/print/connect/ConnectList.tsx";
const FOCUS = "hooks/use-printer-panel-focus.ts";
const PANEL = "components/print/PrinterPanel.tsx";
const VIEW = "lib/printer/settings-view.ts";

// "Tap Reconnect" on simple mode's card: the browser's saved printer that needs a tap says "Tap Reconnect" there, so that
// card shows today's Reconnect in that state (printers mode always has it, Ruling T10b-B).
const tapPin: Pin = (code) => {
  const p: string[] = [];
  const at = code.indexOf(".reconnect(");
  const button = code.lastIndexOf("<Button", at);
  need(p, count(code, ".reconnect(") === 1 && code.slice(button - 120, button).includes('{(printersCard || status === "needs-tap") && ('), "one Reconnect: printers mode, or a printer that needs a tap");
  return p;
};
const prefillPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes('const prefill = state.mode === "replace" ? networkPrefillOf(saved.printer) : null;') && code.includes("const saved = useDevicePrinter();"), "a replace starts at this device's saved printer; an add starts empty");
  need(p, code.includes("prefill={prefill}"), "the list's Wi-Fi form is handed it");
  return p;
};
const formPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes('const [address, setAddress] = useState(prefill?.host ?? "");') && code.includes("const [port, setPort] = useState(prefill?.port ?? String(DEFAULT_TCP_PRINTER_PORT));"), "the form starts at the prefill, else empty with the default port");
  need(p, code.includes("<NetworkForm error={error} prefill={prefill} onPick={onPick} />"), "the container hands it to the form");
  return p;
};
const notePin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes("const note = otherPrintersNoteOf(agent.printersMode);") && !code.includes("PRINTERS_CARD.sub"), "the note follows the mode");
  need(p, count(code, "{note}") === 1 && code.includes("{showNames && <p className={PRINTER_NOTE_CLASS}>{note}</p>}"), "one note, behind the same gate");
  return p;
};
const focusPin: Pin = (code) => {
  const p: string[] = [];
  const effect = code.slice(code.indexOf("if (shownView.current === view) return;"), code.indexOf("}, [view]);"));
  need(p, effect.includes("const from = shownView.current;") && effect.indexOf("const from = shownView.current;") < effect.indexOf("shownView.current = view;"), "the view it came from is read before it is replaced");
  need(p, effect.includes('if (frame === null && from === "connect" && focusAndShow(rootRef.current, DEVICE_SECTION_SELECTOR)) return;'), "on /printers (no frame) leaving the connect view focuses this device's printer card");
  need(p, effect.indexOf("if (target !== null && focusAndShow(rootRef.current, target)) return;") < effect.indexOf('if (frame === null && from === "connect"'), "a fix's own target first");
  need(p, code.includes(`export const DEVICE_SECTION_SELECTOR = '[data-printer-target="device"]';`), "the device card's selector lives with the focus");
  return p;
};
const panelPin: Pin = (code) => {
  const p: string[] = [];
  need(p, !code.includes("const DEVICE_SECTION_SELECTOR =") && /import \{ DEVICE_SECTION_SELECTOR, usePrinterPanelFocus \} from "@\/hooks\/use-printer-panel-focus";/.test(code), "the panel's targets use the hook's one selector");
  return p;
};
// The review's minor 5: a toast for a thrown connect (Reconnect, a connect that ends after staff left the view) follows the
// same rule as the guided connect's inline line, never a code error's text.
const toastPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes("const thrownWordsOf = (error: unknown): string => attemptErrorWordsOf(error) ?? PRINTER_CONNECT_FAILED_MESSAGE;"), "a thrown attempt's toast: staff words, else the connect-failed sentence");
  need(p, count(code, "toast.error(thrownWordsOf(error));") === 2 && !code.includes("error.message"), "both toasts use it; no raw message");
  return p;
};
const libPin: Pin = (code) => {
  const p: string[] = [];
  need(p, !code.includes('from "@/components/') && code.includes('import { printerTypeLabel } from "@/lib/printer/printer-type-label";'), "settings-view.ts is a pure lib file: no component import");
  return p;
};

const CASES: { name: string; file: string; pin: Pin; mutations: [string, string, string][] }[] = [
  { name: "simple mode's card shows Reconnect when its row says Tap Reconnect (DevicePrinterSection)", file: DEVICE, pin: tapPin, mutations: [
    ["printers mode only", '{(printersCard || status === "needs-tap") && (', "{printersCard && ("],
    ["always", '{(printersCard || status === "needs-tap") && (', "{true && ("],
  ] },
  { name: "Connect it again starts the Wi-Fi form at the saved printer (ConnectFlow)", file: FLOW, pin: prefillPin, mutations: [
    ["an add prefilled too", 'state.mode === "replace" ? networkPrefillOf(saved.printer) : null', "networkPrefillOf(saved.printer)"],
    ["never handed on", "prefill={prefill}", "prefill={null}"],
  ] },
  { name: "the Wi-Fi form starts at its prefill (ConnectList)", file: LIST, pin: formPin, mutations: [
    ["empty anyway", 'useState(prefill?.host ?? "")', 'useState("")'],
    ["the port ignored", "useState(prefill?.port ?? String(DEFAULT_TCP_PRINTER_PORT))", "useState(String(DEFAULT_TCP_PRINTER_PORT))"],
  ] },
  { name: "the note under the app's other printers follows the mode (OtherDevicePrinters)", file: OTHERS, pin: notePin, mutations: [
    ["printers-mode words always", "otherPrintersNoteOf(agent.printersMode)", "PRINTERS_CARD.sub"],
    ["simple words always", "otherPrintersNoteOf(agent.printersMode)", "otherPrintersNoteOf(false)"],
  ] },
  { name: "/printers keeps the focus after the connect view (use-printer-panel-focus)", file: FOCUS, pin: focusPin, mutations: [
    ["the focus left on the body", 'if (frame === null && from === "connect" && focusAndShow(rootRef.current, DEVICE_SECTION_SELECTOR)) return;', ""],
    ["after any view", 'frame === null && from === "connect" &&', "frame === null &&"],
  ] },
  { name: "one device-card selector (PrinterPanel)", file: PANEL, pin: panelPin, mutations: [
    ["a second copy", 'import { DEVICE_SECTION_SELECTOR, usePrinterPanelFocus } from "@/hooks/use-printer-panel-focus";', `import { usePrinterPanelFocus } from "@/hooks/use-printer-panel-focus";\nconst DEVICE_SECTION_SELECTOR = '[data-printer-target="device"]';`],
  ] },
  { name: "a thrown connect's toast keeps only staff words (connect-outcome)", file: "components/print/connect-outcome.ts", pin: toastPin, mutations: [
    ["the raw message back", "attemptErrorWordsOf(error) ?? PRINTER_CONNECT_FAILED_MESSAGE;", "(error instanceof Error ? error.message : PRINTER_CONNECT_FAILED_MESSAGE);"],
  ] },
  { name: "settings-view.ts imports no component file", file: VIEW, pin: libPin, mutations: [
    ["the component again", 'import { printerTypeLabel } from "@/lib/printer/printer-type-label";', 'import { printerTypeLabel } from "@/components/print/printer-type";'],
  ] },
];

for (const c of CASES) {
  test(c.name, () => {
    const code = stripComments(read(c.file));
    assert.ok(code.length > 100, `${c.file} was read`);
    assert.deepEqual(c.pin(code), [], `${c.file}\n  - ${c.pin(code).join("\n  - ")}`);
  });
}

test("every polish pin bites: a mutation of the real file is noticed", () => {
  for (const c of CASES) {
    const code = stripComments(read(c.file));
    for (const [name, from, to] of c.mutations) {
      const mutated = code.replace(from, to);
      assert.notEqual(mutated, code, `${c.file} :: ${name}: the mutation changed the source`);
      assert.ok(c.pin(mutated).length >= 1, `${c.file} :: ${name}: the pin did not notice`);
    }
  }
});
