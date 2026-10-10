import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { DESKTOP_PRINT_EMPTY_MESSAGE, DESKTOP_PRINT_NO_REPLY_MESSAGE, DESKTOP_PRINT_TOO_LARGE_MESSAGE } from "@/lib/desktop-shell";
import { DESKTOP_SHELL_NEVER_PRINTS, DESKTOP_SHELL_NOT_READY_MESSAGE, DESKTOP_SHELL_REFUSALS } from "@/lib/desktop-shell-messages";
import { PRINT_HOST_EMPTY_SLIP_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { LANE_PRINT_FAILED_MESSAGE, NO_PRINTER_MESSAGE, laneFailureMessage } from "@/lib/printer/lane-print";
import { nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_ERROR_CODES, type NativeErrorCode } from "@/lib/printer/native-bridge-protocol";
import { PrintWriteError, hostPrintFailureMessage, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { stripComments } from "@/lib/source-pin-utils";
import { RASTER_FAILED_MESSAGE, RASTER_TOO_LARGE_MESSAGE } from "@/lib/printer/raster";
import { nativeErrorMessage } from "@/lib/printer/transport-native";
import { PRINTER_ELSEWHERE_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing Phase 1 Session 1C (spec §7.5): the agent says sent:"no" only when nothing can have
// reached the printer. These cases pin every curated sentence the print lanes throw.

function outcome(message: string): string {
  const o = printWriteOutcomeOf(new Error(message));
  return o.permanent ? `${o.sent}+permanent` : o.sent;
}

test("refusals made before any byte left are sent:'no' (no printer, not connected, another tab, could not draw)", () => {
  for (const message of [NO_PRINTER_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_ELSEWHERE_MESSAGE, RASTER_FAILED_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE]) {
    assert.equal(outcome(message), "no", message);
  }
});

test("a slip that can never print is sent:'no' and permanent (too large, blank)", () => {
  for (const message of [RASTER_TOO_LARGE_MESSAGE, DESKTOP_PRINT_TOO_LARGE_MESSAGE, DESKTOP_PRINT_EMPTY_MESSAGE, PRINT_HOST_EMPTY_SLIP_MESSAGE]) {
    assert.equal(outcome(message), "no+permanent", message);
  }
});

test("anything that may already be on paper is 'maybe': write failed, no reply, the bridge's give-up, unknown text", () => {
  for (const message of [PRINTER_WRITE_FAILED_MESSAGE, DESKTOP_PRINT_NO_REPLY_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE, LANE_PRINT_FAILED_MESSAGE, "socket hang up"]) {
    assert.equal(outcome(message), "maybe", message);
  }
  assert.equal(printWriteOutcomeOf("not an error").sent, "maybe", "a thrown non-Error is maybe");
  assert.equal(printWriteOutcomeOf(new Error("")).message, "may have printed", "an empty message still says why");
  assert.equal(printWriteOutcomeOf(new Error("Error invoking remote method 'print': Error: Paper jam")).sent, "maybe", "a desktop shell failure is maybe");
});

test("the Android bridge's codes (spec §7.5): refusals are 'no', a write that failed is 'maybe', too large is permanent", () => {
  const expected: Record<NativeErrorCode, string> = {
    NOT_CONNECTED: "no",
    BUSY: "no",
    BLUETOOTH_OFF: "no",
    UNAUTHORIZED: "no",
    LOCATION_OFF: "no",
    TOO_LARGE: "no+permanent",
    WRITE_FAILED: "maybe",
    TIMEOUT: "maybe",
    // Their sentence is the write-failed one, so they read as maybe: the safe direction.
    UNSUPPORTED: "maybe",
    BAD_REQUEST: "maybe",
  };
  for (const code of NATIVE_ERROR_CODES) {
    assert.equal(outcome(nativeErrorMessage(nativeError(code, code))), expected[code], code);
  }
});

test("a PrintWriteError keeps its own class and its operator sentence (toasts and laneFailureMessage unchanged)", () => {
  const refused = new PrintWriteError(PRINT_HOST_PRINT_FAILED_MESSAGE, "no", true);
  assert.deepEqual(printWriteOutcomeOf(refused), { sent: "no", permanent: true, message: PRINT_HOST_PRINT_FAILED_MESSAGE });
  assert.ok(refused instanceof Error, "it is still an Error");
  assert.equal(laneFailureMessage(new PrintWriteError(PRINTER_NOT_CONNECTED_MESSAGE, "no")), PRINTER_NOT_CONNECTED_MESSAGE, "the lane toast reads the same sentence");
});

// The Phase 1 final gate (I-3, spec §7.5's Windows row): the Windows app's sentence reaches the page wrapped by
// the IPC layer, so the bridge read every Windows failure as an unknown "may have printed": a PC with no printer
// chosen turned each KOT into REPRINT and then "Couldn't print", and its first real paper said REPRINT.
const ipcWrapped = (sentence: string): Error => new Error(`Error invoking remote method 'pos-desktop:print-html': Error: ${sentence}`);

test("the Phase 1 final gate (I-3): the Windows app's refusals reach the agent unwrapped and keep their class", () => {
  for (const sentence of DESKTOP_SHELL_REFUSALS) {
    const message = hostPrintFailureMessage(ipcWrapped(sentence), true);
    assert.equal(message, sentence, "the shell's own sentence, unwrapped");
    assert.equal(outcome(message), "no", `a printer problem before any byte left never counts: ${sentence}`);
  }
  const notReady = hostPrintFailureMessage(ipcWrapped(DESKTOP_SHELL_NOT_READY_MESSAGE), true);
  assert.equal(outcome(notReady), "no", "the slip did not finish drawing: nothing was sent");
  assert.equal(isSlipRefusal(printWriteOutcomeOf(new Error(notReady))), true, "and it is the slip's own fault (owner, 1C gate I3): the second one fails it");
  for (const sentence of DESKTOP_SHELL_NEVER_PRINTS) {
    assert.equal(outcome(hostPrintFailureMessage(ipcWrapped(sentence), true)), "no+permanent", `it can never print: ${sentence}`);
  }
  assert.equal(outcome(hostPrintFailureMessage(new Error(DESKTOP_PRINT_TOO_LARGE_MESSAGE), true)), "no+permanent", "the seam's own refusal, before the IPC call");
  for (const sentence of [
    "The printer did not answer. Check the printer and print again.",
    "This print request was refused.",
    "Windows did not allow printing to the chosen printer.",
    "Printing failed: Windows error 1722",
    "Printing failed: the printer queue did not accept the whole slip.",
    "Printing failed: Print job canceled",
  ]) {
    assert.equal(outcome(hostPrintFailureMessage(ipcWrapped(sentence), true)), "maybe", `it may be on paper: ${sentence}`);
  }
  assert.equal(outcome(hostPrintFailureMessage(new Error(DESKTOP_PRINT_NO_REPLY_MESSAGE), true)), "maybe", "the shell never answered");
  assert.equal(outcome(hostPrintFailureMessage(new Error("contentRef is null"), true)), "maybe", "anything else in the shell: the safe direction");
  assert.equal(hostPrintFailureMessage(new Error(PRINTER_NOT_CONNECTED_MESSAGE), false), PRINTER_NOT_CONNECTED_MESSAGE, "no shell: a lane's own sentence, unchanged");
  assert.equal(hostPrintFailureMessage(new Error("socket hang up"), false), PRINT_HOST_PRINT_FAILED_MESSAGE, "no shell: anything else is the bridge's generic sentence, unchanged");
});

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("3E: a network printer on the Windows app fails with the lane's own sentence: not connected is nothing sent, a write that failed may be on paper", () => {
  assert.equal(hostPrintFailureMessage(new Error(PRINTER_NOT_CONNECTED_MESSAGE), true), PRINTER_NOT_CONNECTED_MESSAGE, "kept as it is in the Windows app");
  assert.equal(outcome(hostPrintFailureMessage(new Error(PRINTER_NOT_CONNECTED_MESSAGE), true)), "no", "nothing sent: acked unreachable for a network printer");
  assert.equal(outcome(hostPrintFailureMessage(new Error(PRINTER_WRITE_FAILED_MESSAGE), true)), "maybe", "part of it may be on paper: REPRINT");
  assert.equal(hostPrintFailureMessage(new Error("Error invoking remote method 'pos-desktop:print-html': Error: This print request was refused."), true), "This print request was refused.", "a page slip's shell sentence still unwrapped");
});

test("PIN (I-3): the Windows app's sentences here are the shell's own, word for word", () => {
  const shell = ["print-messages.ts", "raw-spool.ts"].map((file) => readFileSync(path.join(REPO_ROOT, "apps/desktop/src", file), "utf8")).join("\n");
  for (const sentence of [...DESKTOP_SHELL_REFUSALS, DESKTOP_SHELL_NOT_READY_MESSAGE, ...DESKTOP_SHELL_NEVER_PRINTS]) {
    assert.ok(shell.includes(JSON.stringify(sentence)), `apps/desktop/src still says, word for word: ${sentence}`);
  }
});

test("PIN (I-3): the host bridge hands each failed slip the shell's own sentence", () => {
  const bridge = stripComments(readFileSync(path.join(REPO_ROOT, "apps/cafe/hooks/use-print-host-bridge.ts"), "utf8"));
  assert.match(bridge, /settle\(hostPrintFailureMessage\(error\)\)/, "onPrintError must unwrap the shell's sentence (in the Windows app)");
  assert.ok(!bridge.includes("laneFailureMessage(error) ?? PRINT_HOST_PRINT_FAILED_MESSAGE"), "the lane-only read is gone");
});
