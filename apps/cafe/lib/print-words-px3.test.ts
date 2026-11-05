import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { DESKTOP_SHELL_REFUSALS, DESKTOP_SHELL_REFUSAL_WORDS, desktopRefusalWordsOf } from "@/lib/desktop-shell-messages";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";
import { JOB_NOT_CONNECTED_TOAST, slipToastOf } from "@/lib/print-job-toast";
import { notPrintedViewOf } from "@/lib/print-waiting-view";
import { waitingPrintersOf } from "@/lib/print-waiting";
import { printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { printerButtonName } from "@/lib/printer/printer-dot";
import { clockPrinterWords } from "@/lib/pos-clock";
import { PRINT_JOB_NOT_ROUTED_MESSAGE } from "@/lib/print-routing";
import { DESKTOP_NO_PRINTER_MESSAGE } from "@/lib/printer/print-lane";
import { PRINTER_IN_SETUP_MESSAGE, PRINTER_TAKEOVER_MESSAGE } from "@/lib/print-agent-printers";
import { stripComments } from "@/lib/source-pin-utils";

// PX-3 Task 12 (spec §6.8, §6.9 B10; X1, X12, X13; the owner's Q1, Q2): the words point staff where they can go. The
// Windows app still sends its old sentences (they decide "nothing sent"), so the new ones are a display map only.

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

const OLD_REFUSALS = [
  "No printer is chosen for this PC. Open Settings, then Printing, and pick the printer.",
  "The chosen printer saves files instead of printing. Open Settings, then Printing, and pick the real printer.",
  "No server address is set.",
  "Direct printing is not available on this PC. Open Settings, then Printing, and choose the Windows driver method.",
  "The chosen printer was not found on this PC. Open Settings, then Printing, and pick it again.",
  "That printer is not on this PC. Open Printer setup in the POS and choose a printer this PC has.",
];
const NEW_WORDS = [
  "No printer is chosen for this PC. Open the printer icon, then Printer settings, and choose the printer.",
  "The chosen printer saves files instead of printing. Open the printer icon, then Printer settings, and choose the printer.",
  "Direct printing is not available on this PC. Open the printer icon, then Printer settings, and choose the Windows driver method.",
  "The chosen printer was not found on this PC. Open the printer icon, then Printer settings, and choose the printer.",
  "That printer is not on this PC. Ask your manager to change it in Printer setup.",
];

test("the six button names", () => {
  assert.equal(printerButtonName({ show: true, ok: true, reason: "ok" }), "Printer connected — open printer", "connected");
  assert.equal(printerButtonName({ show: true, ok: false, reason: "no-printer" }), "Printer not connected — open printer", "not connected");
  assert.equal(printerButtonName({ show: false }), "Open printer", "nothing set up");
  assert.equal(printerButtonName({ show: true, ok: false, reason: "checking" }), "Checking the printer — open printer", "checking");
  assert.equal(printerButtonName({ show: true, ok: false, reason: "printer-problem" }), "Printer needs attention — open printer", "problem");
  assert.equal(printerButtonName({ show: true, ok: false, reason: "printer-waiting" }), "Printer not printing — open printer", "waiting");
});

test("the refusal list is the Windows app's, byte for byte", () => {
  assert.deepEqual([...DESKTOP_SHELL_REFUSALS], OLD_REFUSALS, "the six sentences the shell still sends");
  for (const sentence of OLD_REFUSALS) assert.equal(printWriteOutcomeOf(new Error(sentence)).sent, "no", `still nothing sent: ${sentence}`);
});

test("desktopRefusalWordsOf maps the five and leaves any other sentence", () => {
  const mapped = OLD_REFUSALS.filter((sentence) => sentence !== "No server address is set.");
  mapped.forEach((sentence, at) => assert.equal(desktopRefusalWordsOf(sentence), NEW_WORDS[at], `shown: ${sentence}`));
  assert.equal(Object.keys(DESKTOP_SHELL_REFUSAL_WORDS).length, 5, "five sentences are mapped");
  assert.equal(desktopRefusalWordsOf("No server address is set."), "No server address is set.", "unchanged");
  assert.equal(desktopRefusalWordsOf("Anything else"), "Anything else", "unknown unchanged");
  assert.equal(desktopRefusalWordsOf(""), "", "empty unchanged");
});

test("slipToastOf: a job's not-connected gets the B7 words; a refusal, job or not, the new words; anything else unchanged", () => {
  assert.equal(slipToastOf(PRINTER_NOT_CONNECTED_MESSAGE, "j1"), JOB_NOT_CONNECTED_TOAST, "a job: B7");
  assert.equal(slipToastOf(PRINTER_NOT_CONNECTED_MESSAGE, undefined), PRINTER_NOT_CONNECTED_MESSAGE, "no job: today's");
  assert.equal(slipToastOf(OLD_REFUSALS[0]!, "j1"), NEW_WORDS[0], "a job's refusal");
  assert.equal(slipToastOf(OLD_REFUSALS[0]!, undefined), NEW_WORDS[0], "a test slip's refusal");
  assert.equal(slipToastOf("The slip is too long.", undefined), "The slip is too long.", "anything else");
});

test("the bridge and the text KOT line read refusals through the display map", () => {
  const bridge = src("hooks/use-print-host-bridge.ts");
  assert.ok(bridge.includes("toast.error(slipToastOf(failure, jobIdRef.current));"), "settle's toast");
  assert.ok(bridge.includes("toast.error(slipToastOf(PRINT_HOST_PRINT_FAILED_MESSAGE, jobIdRef.current));"), "the watchdog's toast");
  assert.ok(src("components/print/TextKotSection.tsx").includes("desktopRefusalWordsOf"), "the error line");
  assert.ok(src("lib/print-waiting-view.ts").includes("desktopRefusalWordsOf"), "the panel rows");
  // The final review's m9: where a failure is recorded keeps the wire sentence (it decides "nothing sent", it is a job's
  // lastError): none of these files imports or calls the display map.
  const mapped = (code: string): boolean => /\b(desktopRefusalWordsOf|slipToastOf)\b/.test(code);
  for (const file of ["lib/desktop-shell.ts", "lib/print-write-outcome.ts", "hooks/use-print-agent.ts"]) {
    const code = src(file);
    assert.ok(code.length > 100, `${file} was read`);
    assert.ok(!mapped(code), `${file}: never where a failure is recorded`);
  }
  assert.ok(mapped(`${src("lib/print-write-outcome.ts")}\nconst shown = slipToastOf(message, undefined);`) && mapped('import { desktopRefusalWordsOf } from "x";'), "the guard bites on a call and an import");
});

function rowOf(over: Partial<PrintAttentionRow>): PrintAttentionRow {
  return { id: "j1", kind: "kot", label: "KOT round 1 · T-4", status: "queued", labels: [], createdAt: new Date(Date.now() - 60_000).toISOString(), ...over };
}
const reasonOf = (over: Partial<PrintAttentionRow>, printers = [{ id: "p1", name: "Kitchen printer" }]): string => {
  const view = notPrintedViewOf([rowOf(over)], false, Date.now(), printers);
  assert.ok(view !== null, "a row gives a card");
  return view.rows[0]!.reason;
};

test("the row words: a refusal row shows the new words; Q1 names the printer or not", () => {
  assert.equal(reasonOf({ lastError: OLD_REFUSALS[0] }), NEW_WORDS[0], "a queued refusal row");
  assert.equal(reasonOf({ status: "failed", lastError: OLD_REFUSALS[4] }), NEW_WORDS[3], "a failed row's own words");
  assert.equal(reasonOf({ lastError: PRINTER_NOT_CONNECTED_MESSAGE }), "The printer is off or not connected.", "Q1 unnamed");
  assert.equal(reasonOf({ printerId: "p1", lastError: PRINTER_NOT_CONNECTED_MESSAGE }), "Kitchen printer is off or not connected.", "Q1 named");
});

test("a stuck printer is named first", () => {
  const printers = [{ id: "k", name: "Kitchen" }, { id: "b", name: "Bill" }, { id: "c", name: "Bar" }];
  assert.deepEqual(waitingPrintersOf("k:4::0|b:1::1", printers).map((w) => w.name), ["Bill", "Kitchen"], "stuck before busy");
  assert.deepEqual(waitingPrintersOf("k:2::1|b:5::1", printers).map((w) => w.name), ["Bill", "Kitchen"], "two stuck: the most slips");
  assert.deepEqual(waitingPrintersOf("c:2::1|k:2::1", printers).map((w) => w.name), ["Kitchen", "Bar"], "a tie: the setup's order");
});

test("the staff pointers", () => {
  assert.equal(DESKTOP_NO_PRINTER_MESSAGE, "No printer is chosen on this PC. Open the printer icon, then Printer settings, and choose the printer.", "no printer");
  assert.equal(PRINT_JOB_NOT_ROUTED_MESSAGE, "No printer takes this slip. Ask your manager to switch Notices on for a printer in Printer setup.", "not routed");
  assert.equal(PRINTER_IN_SETUP_MESSAGE, "Set by your manager in Printer setup.", "in setup");
  assert.equal(
    PRINTER_TAKEOVER_MESSAGE,
    "This device prints it while the device that prints it is offline or cannot reach it. Set by your manager in Printer setup.",
    "takeover",
  );
  const section = src("components/print/setup/PrintersSetupSection.tsx");
  assert.ok(!section.includes("Couldn't print"), "the group is Not printed");
  assert.equal(section.split("will show under Not printed.").length - 1, 2, "both confirms say Not printed");
});

test("the /pos clock says needs attention for the red tone", () => {
  assert.equal(clockPrinterWords("red"), "needs attention", "red");
  assert.equal(clockPrinterWords("green"), "connected", "green");
  assert.equal(clockPrinterWords("none"), null, "none");
});
