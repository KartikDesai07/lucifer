import { test } from "node:test";
import assert from "node:assert/strict";

import { CUT_PARTIAL_WITH_FEED, ESC_INIT, RASTER_BOTTOM_PAD_ROWS } from "../escpos";
import { escposTextJob } from "./text-escpos";
import type { TextLine, TextPiece } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.3): the bytes of a text job. ESC @ first; each line sends only the state changes
// it needs (ESC a, ESC E, GS !, GS B), its ASCII and LF; then every style reset (never a second ESC @), ESC J 16 for the
// picture's 16-row bottom pad and the picture's own cut.

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));
const line = (text: string, over: Partial<TextLine> = {}): TextLine => ({ text, align: "left", bold: false, size: "normal", invert: false, ...over });
const END = [0x1b, 0x4a, RASTER_BOTTOM_PAD_ROWS, ...CUT_PARTIAL_WITH_FEED];
/** ESC R 0 (the USA international character set) and ESC M 0 (Font A), right after ESC @ (the owner's rulings at the
 *  4A gate). */
const START = [...ESC_INIT, 0x1b, 0x52, 0x00, 0x1b, 0x4d, 0x00];

test("a plain line: init, its text, LF, the pad and the cut", () => {
  assert.deepEqual(Array.from(escposTextJob([line("Order 42")], 48)), [...START, ...ascii("Order 42"), 0x0a, ...END], "the smallest job");
});

test("each style is sent when it changes, and reset once at the end", () => {
  const pieces: TextPiece[] = [
    line("KITCHEN ORDER", { align: "center", bold: true, size: "tall" }),
    line("#12", { align: "center", bold: true, size: "big" }),
    { feedDots: 12 },
    line("Order", {}),
    line("REPRINT", { bold: true, invert: true }),
  ];
  const expected = [
    ...START,
    0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x01, ...ascii("KITCHEN ORDER"), 0x0a,
    0x1d, 0x21, 0x11, ...ascii("#12"), 0x0a,
    0x1b, 0x4a, 12,
    0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0x00, ...ascii("Order"), 0x0a,
    0x1b, 0x45, 1, 0x1d, 0x42, 1, ...ascii("REPRINT"), 0x0a,
    0x1d, 0x42, 0, 0x1b, 0x45, 0,
    ...END,
  ];
  assert.deepEqual(Array.from(escposTextJob(pieces, 48)), expected, "only the changes, then the resets");
  const bytes = Array.from(escposTextJob(pieces, 48));
  assert.equal(bytes.filter((b, i) => b === 0x1b && bytes[i + 1] === 0x40).length, 1, "ESC @ is sent once, at the start");
  assert.equal(bytes.filter((b, i) => b === 0x1b && bytes[i + 1] === 0x52).length, 1, "ESC R is sent once, right after it");
  assert.equal(bytes.filter((b, i) => b === 0x1b && bytes[i + 1] === 0x4d).length, 1, "ESC M is sent once, right after that");
});

test("an empty line is a bare LF", () => {
  assert.deepEqual(Array.from(escposTextJob([line("Note"), line("")], 32)), [...START, ...ascii("Note"), 0x0a, 0x0a, ...END], "LF alone");
});

test("a blank slip, a line too long for its size, a character outside ASCII and a bad feed are refused", () => {
  assert.throws(() => escposTextJob([line(""), line("   ")], 48), /blank slip/, "nothing to print");
  assert.throws(() => escposTextJob([line("x".repeat(48))], 48), /longer than 47/, "48 characters on 48 columns");
  assert.throws(() => escposTextJob([line("x".repeat(24), { size: "big" })], 48), /longer than 23/, "24 double-width characters");
  assert.doesNotThrow(() => escposTextJob([line("x".repeat(47)), line("y".repeat(23), { size: "big" })], 48), "the widest lines pass");
  assert.throws(() => escposTextJob([line("Café")], 48), /not printable ASCII/, "a mapped layout never sends é");
  assert.throws(() => escposTextJob([line("a"), { feedDots: 0 }], 48), /feed/, "a zero feed");
  assert.throws(() => escposTextJob([line("a"), { feedDots: 256 }], 48), /feed/, "a feed past ESC J's 255");
});
