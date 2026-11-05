// Printer UX PX-3 Task 10b (spec §6.5, §6.6 item 2; mockup t-settings-pm; rulings X5-X7, T10b-B, T10b-C): printers mode's
// one card, "Printers on this device". Source pins (comments stripped) over DevicePrinterSection, OtherDevicePrinters, their
// shared parts (settings/PrinterBlock) and the Test print tap the card shares with the Printer setup page. The pure words
// live in settings-view.test.ts. Every pin is proven to bite by an in-memory mutation of the real file (nothing is written).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const CAFE = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

const DEVICE = "components/print/DevicePrinterSection.tsx";
const OTHERS = "components/print/OtherDevicePrinters.tsx";
const SETTINGS = "components/print/settings/";

type Pin = (code: string) => string[];
const need = (problems: string[], ok: boolean, message: string): void => {
  if (!ok) problems.push(message);
};
// PX-3 Task 10b (spec §6.6 item 2, X5–X7): printers mode is one card, this device's printer first, the app's others inside it.
const oneCardPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes('const printersCard = lane !== "desktop" && dot.printersMode && dot.isWriter;'), "the card on a printers-mode writer (the Windows app keeps its picker)");
  need(p, code.includes("title={printersCard ? PRINTERS_CARD.title : deviceCardTitleOf(lane)}") && code.includes("sub={printersCard ? PRINTERS_CARD.sub : undefined}"), "titled Printers on this device, with its sub");
  const others = code.indexOf("<OtherDevicePrinters");
  need(p, count(code, "<PanelSection") === 1 && others > code.indexOf("<PanelSection") && others < code.indexOf("</PanelSection>"), "the app's other printers inside the one card");
  need(p, code.includes("card={printersCard}") && code.includes("here={here}") && code.includes("canAdd={printer !== null}"), "they are told they are the card's, with the setup's names; a second printer once there is a first (T10b-C)");
  need(p, /\{testAnswer\}\s*(\{\}\s*)?<PaperSizeToggle value=\{printer\.paper\}/.test(code) && code.includes("{(!printersCard || !pool.active) && ("), "Paper width in every mode (the device test draws at it); Change kept off the app's pool (T10b-C)");
  return p;
};
const othersCardPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes("const NOTE = PRINTERS_CARD.sub;") && code.includes("{showNames && <p className={PRINTER_LABEL_CLASS}>{TITLE}</p>}") && code.includes("{showNames && <p className={PRINTER_NOTE_CLASS}>{NOTE}</p>}"), "simple mode's note is the card's sub; in the card no title or note of their own");
  // PX-3 Task 11 (on purpose, spec §6.7): Connect another printer opens the guided connect in add mode (was its inline list).
  need(p, /onClick=\{\(\) => onConnect\(CONNECT_ADD\)\}>\s*Connect another printer\s*<\/Button>/.test(code) && code.includes("name={named?.name ?? entry.printer.name}"), "Connect another printer: the guided connect's add; the setup's name, else the app's");
  need(p, count(code, "{canAdd && ") === 1 && !code.includes("NativePrinterPicker"), "T10b-C: Connect another printer only once this device has its own printer; no inline list");
  return p;
};
// Ruling T10b-B (over X7 for the app's printers): every printer of the card keeps today's Reconnect, whatever its state
// (a stale "Connected" link), primary while not connected; this device's own one only in printers mode.
const reconnectPin = (gate: string, variant: string): Pin => (code) => {
  const p: string[] = [];
  const at = code.indexOf(".reconnect(");
  const button = code.lastIndexOf("<Button", at);
  const before = code.slice(button - 120, button);
  need(p, count(code, ".reconnect(") === 1 && button > 0 && before.includes(gate) && !before.includes('"connected" &&'), `one Reconnect, behind ${gate} only, whatever the state`);
  need(p, code.slice(button, at).includes(variant), "primary while not connected, outline when connected");
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
// The review's I2: the setup page's rule (testPrintBlock), its state (printerRowState) and its one tap handler, never a copy.
const setupTestPin: Pin = (code) => {
  const p: string[] = [];
  need(p, count(code, "useTestPrinterTap()") === 1 && !code.includes("mutateAsync(") && code.includes("onClick={() => void testPrint.run(config, state)}"), "the setup's tap handler, not a copy");
  need(p, code.includes("const blocked = testPrintBlock(config, printers, here);") && code.includes("disabled={disabled || blocked !== null || testPrint.pending}") && code.includes("{blocked !== null && <p"), "the setup's rule: disabled with its reason; one test at a time");
  need(p, code.includes("const state = printerRowState(config, NO_DEVICES, { ...here, devicesFailed: true });") && code.includes('canPrint: printer.status === "connected", ownState: printer.nativeId !== undefined'), "the setup's state, from the entry's own");
  return p;
};
const tapPin: Pin = (code) => {
  const p: string[] = [];
  need(p, /await testPrint\.mutateAsync\(printer\.id\);\s*toast\.success\(testPrintSentText\(printer, state\)\);\s*\} catch \{\s*\}/.test(code), "one request per tap, the setup's toast; an error is the hook's");
  need(p, count(code, "testPrintSentText(") === 1 && code.includes("return { run, pending: testPrint.isPending };"), "one handler");
  return p;
};

// PX-3 harness F2: in simple mode the "Other printers on this device" label and its sub are drawn only when the app holds
// another printer (with none, the sub is wrong: no manager chooses slips per printer yet; two lines of phone scroll).
const othersNamedPin: Pin = (code) => {
  const p: string[] = [];
  need(p, code.includes("const showNames = !card && others.length > 0;"), "the label and sub are for simple mode with other printers only");
  need(p, code.includes("{showNames && <p className={PRINTER_LABEL_CLASS}>{TITLE}</p>}") && code.includes("{showNames && <p className={PRINTER_NOTE_CLASS}>{NOTE}</p>}"), "both lines wear that one gate");
  need(p, count(code, "{TITLE}") === 1 && count(code, "{NOTE}") === 1 && code.includes("{canAdd && (") && count(code, "{canAdd && ") === 1, "one label, one sub; Connect another printer keeps its own gate");
  return p;
};
const CASES: { name: string; file: string; pin: Pin; mutations: [string, string, string][] }[] = [
  { name: "printers mode is one card (DevicePrinterSection)", file: DEVICE, pin: oneCardPin, mutations: [
    ["the card on a device that prints nothing", "dot.printersMode && dot.isWriter;", "dot.printersMode;"],
    ["the old title", "title={printersCard ? PRINTERS_CARD.title : deviceCardTitleOf(lane)}", "title={deviceCardTitleOf(lane)}"],
    ["the others outside the card", "{caps.native && <OtherDevicePrinters", "{caps.native && false}</PanelSection><PanelSection>{<OtherDevicePrinters"],
    ["a second printer first", "canAdd={printer !== null}", "canAdd={true}"], ["no Paper width in printers mode", "<PaperSizeToggle value", "{!printersCard && <PaperSizeToggle value"],
    ["no Change on Chrome in printers mode", "{(!printersCard || !pool.active) && (", "{!printersCard && ("],
  ] },
  { name: "printers mode is one card (OtherDevicePrinters)", file: OTHERS, pin: othersCardPin, mutations: [
    ["a title of their own in the card", "{showNames && <p className={PRINTER_LABEL_CLASS}>{TITLE}</p>}", "<p className={PRINTER_LABEL_CLASS}>{TITLE}</p>"],
    ["the old words", "Connect another printer", "Add another printer"], ["the add opens a replace", "onConnect(CONNECT_ADD)", "onConnect(CONNECT_REPLACE)"],
    ["the app's name over the setup's", "name={named?.name ?? entry.printer.name}", "name={entry.printer.name}"], ["a second printer before the first", "{canAdd && (", "{("],
  ] },
  { name: "simple mode names the other printers only when there are some (OtherDevicePrinters)", file: OTHERS, pin: othersNamedPin, mutations: [
    ["the label with no printers", "const showNames = !card && others.length > 0;", "const showNames = !card;"],
    ["the label in printers mode", "const showNames = !card && others.length > 0;", "const showNames = others.length > 0;"],
    ["the sub always", "{showNames && <p className={PRINTER_NOTE_CLASS}>{NOTE}</p>}", "{!card && <p className={PRINTER_NOTE_CLASS}>{NOTE}</p>}"],
    ["Connect another printer hidden with none", "{canAdd && (", "{canAdd && others.length > 0 && ("],
  ] },
  { name: "T10b-B: today's Reconnect in printers mode (DevicePrinterSection)", file: DEVICE, pin: reconnectPin("{printersCard && (", 'variant={status === "connected" ? "outline" : "default"}'), mutations: [["a Reconnect in simple mode", "{printersCard && (", "{true && ("], ["hidden while connected", "{printersCard && (", '{printersCard && status !== "connected" && ('], ["outline while down", 'variant={status === "connected" ? "outline" : "default"}', 'variant="outline"']] },
  { name: "T10b-B: today's Reconnect on every app printer (OtherDevicePrinters)", file: OTHERS, pin: reconnectPin('<div className="flex flex-wrap gap-2">', 'variant={entry.status === "connected" ? "outline" : "default"}'), mutations: [["hidden while connected", "<Button className={PRINTER_BUTTON_CLASS} variant={entry.status", '{entry.status !== "connected" && <Button className={PRINTER_BUTTON_CLASS} variant={entry.status'], ["outline while down", 'variant={entry.status === "connected" ? "outline" : "default"}', 'variant="outline"']] },
  { name: "the setup's test is the admin's (DevicePrinterSection)", file: DEVICE, pin: adminTestPin, mutations: [["staff get it", "isAdmin && ownHere !== undefined ?", "ownHere !== undefined ?"]] },
  { name: "the setup's test is the admin's (OtherDevicePrinters)", file: OTHERS, pin: adminTestPin, mutations: [["on a printer the setup does not name", "isAdmin && named !== undefined && <SetupTestPrint printer={named}", "isAdmin && <SetupTestPrint printer={named!}"]] },
  { name: "the setup's test keeps the setup's rule and state (settings/PrinterBlock)", file: `${SETTINGS}PrinterBlock.tsx`, pin: setupTestPin, mutations: [["the rule ignored", "disabled={disabled || blocked !== null || testPrint.pending}", "disabled={disabled || testPrint.pending}"], ["a fixed state", "testPrint.run(config, state)", 'testPrint.run(config, { tone: "ok", text: "" })'], ["a copy of the handler", "const testPrint = useTestPrinterTap();", "const testPrint = useTestPrinterTap(); void useTestPrinter().mutateAsync(printer.id);"]] },
  { name: "one Test print tap for the setup page and the card (hooks/use-print-setup)", file: "hooks/use-print-setup.ts", pin: tapPin, mutations: [["a second toast", "testPrintSentText(printer, state));", 'testPrintSentText(printer, state)); toast.error("twice");'], ["the toast not the setup's", "toast.success(testPrintSentText(printer, state))", 'toast.success("Sent.")']] },
  { name: "staff keep the device test on this device's printer (DevicePrinterSection)", file: DEVICE, pin: staffTestPin, mutations: [["the device test gone for staff", "{ownSetupTest ?? testButton}", "{ownSetupTest}"]] },
];

for (const c of CASES) {
  test(c.name, () => {
    const code = stripComments(read(c.file));
    assert.ok(code.length > 100, `${c.file} was read`);
    assert.deepEqual(c.pin(code), [], `${c.file}\n  - ${c.pin(code).join("\n  - ")}`);
  });
}

test("every printers-card pin bites: a mutation of the real file is noticed", () => {
  for (const c of CASES) {
    const code = stripComments(read(c.file));
    for (const [name, from, to] of c.mutations) {
      const mutated = code.replace(from, to);
      assert.notEqual(mutated, code, `${c.file} :: ${name}: the mutation changed the source`);
      assert.ok(c.pin(mutated).length >= 1, `${c.file} :: ${name}: the pin did not notice`);
    }
  }
});
