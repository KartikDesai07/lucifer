import { test } from "node:test";
import assert from "node:assert/strict";

import { CUT_PARTIAL_WITH_FEED, ESC_INIT } from "@/lib/printer/escpos";
import { shownPieces } from "./kot-text.fixtures";
import { TEXT_TEST_RULER_DIGITS, textTestJob, textTestPieces } from "./text-test-slip";

// Printing Phase 4 (spec 2026-10-15 §5.1, S2): the slip a printer prints before its text switch turns on: a sample
// kitchen ticket with a price in Rs, double-height and white-on-black lines, and a ruler as long as a text line may be.

test("the text test slip on 80 mm, line for line", () => {
  assert.deepEqual(shownPieces(textTestPieces({ cafeName: "Test Cafe", columns: 48 })), [
    "tall  B c|Test Cafe|",
    "big   B c|TEXT TEST|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    "tall  B c|KITCHEN ORDER|",
    "normalB l|2 x Masala Chai                           Rs 80|",
    "normal  l|    + Less sugar|",
    "normalB l|    > Hot please|",
    "feed 12",
    "normalB l|1 x Paneer Tikka                         Rs 240|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    `tall  BIl|${" ".repeat(16)}WHITE ON BLACK${" ".repeat(17)}|`,
    "normal  l|12345678901234567890123456789012345678901234567|",
    "normal  c|The numbers above fit on one line.|",
  ], "the whole sample");
});

test("the ruler is exactly one text line long at each width", () => {
  for (const columns of [32, 42, 48] as const) {
    const lines = shownPieces(textTestPieces({ cafeName: "Cafe", columns }));
    const ruler = lines.find((line) => line.includes("|123"));
    assert.ok(ruler !== undefined, `a ruler at ${columns}`);
    const digits = ruler.slice(ruler.indexOf("|") + 1, -1);
    assert.equal(digits.length, columns - 1, `${columns} columns: a ruler of ${columns - 1}`);
    assert.ok(TEXT_TEST_RULER_DIGITS.startsWith(digits.slice(0, 10)), "it counts 1 to 0");
  }
});

test("a cafe name text cannot print is left off; a blank one too", () => {
  assert.equal(shownPieces(textTestPieces({ cafeName: "स्वाद कैफ़े", columns: 48 }))[0], "big   B c|TEXT TEST|", "a Hindi name is left off");
  assert.equal(shownPieces(textTestPieces({ cafeName: "   ", columns: 32 }))[0], "big   B c|TEXT TEST|", "a blank name is left off");
  assert.equal(shownPieces(textTestPieces({ cafeName: undefined, columns: 32 }))[0], "big   B c|TEXT TEST|", "no name");
});

test("the job begins and ends like any slip", () => {
  const bytes = Array.from(textTestJob({ cafeName: "Test Cafe", columns: 32 }));
  assert.deepEqual(bytes.slice(0, 2), Array.from(ESC_INIT), "ESC @ first");
  assert.deepEqual(bytes.slice(-4), Array.from(CUT_PARTIAL_WITH_FEED), "the cut last");
  assert.ok(bytes.length < 800, `${bytes.length} bytes`);
});
