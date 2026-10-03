import { test } from "node:test";
import assert from "node:assert/strict";

import { DESKTOP_PRINT_EMPTY_MESSAGE, DESKTOP_PRINT_NO_REPLY_MESSAGE, DESKTOP_PRINT_TOO_LARGE_MESSAGE } from "@/lib/desktop-shell";
import { PRINT_HOST_EMPTY_SLIP_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { LANE_PRINT_FAILED_MESSAGE, NO_PRINTER_MESSAGE, laneFailureMessage } from "@/lib/printer/lane-print";
import { nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_ERROR_CODES, type NativeErrorCode } from "@/lib/printer/native-bridge-protocol";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
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
