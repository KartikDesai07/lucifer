import { test } from "node:test";
import assert from "node:assert/strict";

import { PRINT_NOT_A_PRINTER_MESSAGE, PRINT_PRINTER_NOT_HERE_MESSAGE, PRINT_REJECTED_MESSAGE } from "./print-messages";
import { rawOnRefusal, rawOnRequest } from "./print-raw-on";
import { RAW_TCP_DATA_MAX_BYTES } from "./raw-tcp";
import { PRINTER_NAME_MAX_CHARS } from "./shared";

// Printing Phase 4 (spec 2026-10-15 §6): printRawOn, a text slip's ESC/POS bytes to a Windows printer the page names,
// through the raw spool the Direct method already uses. What the page may send, and what is refused before a byte.

const SLIP = Uint8Array.from([0x1b, 0x40, 0x41, 0x0a]);

test("a request is a printer name of 1-256 characters and 1 byte up to the raw limit; anything else is refused", () => {
  assert.deepEqual(rawOnRequest("POS-80", SLIP), { name: "POS-80", data: SLIP }, "a name and the bytes");
  assert.equal(rawOnRequest("", SLIP), null, "no name");
  assert.equal(rawOnRequest("x".repeat(PRINTER_NAME_MAX_CHARS + 1), SLIP), null, "a name too long to be a device");
  assert.equal(rawOnRequest(42, SLIP), null, "not a name");
  assert.equal(rawOnRequest("POS-80", new Uint8Array(0)), null, "no bytes");
  assert.equal(rawOnRequest("POS-80", new Uint8Array(RAW_TCP_DATA_MAX_BYTES + 1)), null, "more than the raw limit");
  assert.ok(rawOnRequest("POS-80", new Uint8Array(RAW_TCP_DATA_MAX_BYTES)) !== null, "the raw limit itself");
  assert.equal(rawOnRequest("POS-80", [0x1b, 0x40]), null, "an array is not bytes");
  assert.equal(rawOnRequest("POS-80", "G0A="), null, "base64 is not bytes");
});

test("a printer Windows does not report, a file printer, or the Windows driver method: refused with the shell's own words", () => {
  assert.equal(rawOnRefusal("POS-80", true, "direct"), null, "landmark: a printer this PC has, Direct to printer");
  assert.equal(rawOnRefusal("POS-80", false, "direct"), PRINT_PRINTER_NOT_HERE_MESSAGE, "not on this PC (removed or renamed in Windows)");
  assert.equal(rawOnRefusal("Microsoft Print to PDF", true, "direct"), PRINT_NOT_A_PRINTER_MESSAGE, "a device that writes a file");
  assert.equal(rawOnRefusal("POS-80", true, "driver"), PRINT_REJECTED_MESSAGE, "Through the Windows driver: no raw bytes");
});
