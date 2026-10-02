import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRINT_HOST_BEAT_PRINTER_UNKNOWN,
  PRINT_HOST_BEAT_PRINTER_VALUES,
  PRINT_HOST_PRINTER_STATES,
} from "./print-host-printer";

test("PRINT_HOST_PRINTER_STATES is exactly connected + disconnected", () => {
  assert.deepEqual([...PRINT_HOST_PRINTER_STATES], ["connected", "disconnected"]);
});

test("beat values = the stored states + 'unknown', with no duplicates", () => {
  assert.equal(PRINT_HOST_BEAT_PRINTER_UNKNOWN, "unknown");
  assert.deepEqual([...PRINT_HOST_BEAT_PRINTER_VALUES], [...PRINT_HOST_PRINTER_STATES, PRINT_HOST_BEAT_PRINTER_UNKNOWN]);
  assert.equal(new Set(PRINT_HOST_BEAT_PRINTER_VALUES).size, PRINT_HOST_BEAT_PRINTER_VALUES.length);
});

test("'unknown' is beat-only: it is never a stored state", () => {
  assert.ok(!(PRINT_HOST_PRINTER_STATES as readonly string[]).includes(PRINT_HOST_BEAT_PRINTER_UNKNOWN));
});
