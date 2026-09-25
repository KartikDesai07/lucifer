// Regression suite for the 2026-09-17 RUNAWAY PAPER FEED incident.
//
// WHAT HAPPENED. A blank-print report was mis-diagnosed as an invalid @page
// rule. `@page { size: 80mm auto; ... }` is indeed not valid CSS (the `size`
// property takes the lone keyword `auto`, OR one length, OR two lengths), and
// Chromium does discard it — verified by reading /MediaBox out of printToPDF
// in Electron 44.2.0. On that basis the height was changed to an explicit
// `1200mm`, reasoning that a roll printer "advances only as far as the ink
// goes, so an over-tall page costs no paper".
//
// THAT REASONING WAS WRONG AND WAS NEVER TESTED ON A REAL PRINTER. An explicit
// @page height IS the page length. The thermal printer fed 1.2 METRES per
// slip, ran the roll to its end, and kept feeding after a fresh roll was
// loaded. Paper loss plus a wedged printer on a live counter.
//
// WHY `auto` IS CORRECT HERE. A thermal roll is continuous — the only right
// answer is "feed exactly as far as the slip was drawn". Chromium not
// honouring the rule is precisely what delivers that: page geometry is left
// to the roll driver. `auto` is what every working slip has used since
// 2026-08-12 (4a71ca3), and printing worked with it.
//
// THE BLANK PRINTING WAS A DIFFERENT BUG ENTIRELY. The desktop shell printed
// silently to the WINDOWS DEFAULT printer (`deviceName: null`, no picker), and
// on the counter PC that default was a virtual "save to file" device — an
// OneNote `nul:` port swallows the job, a `PORTPROMPT:` device opens a save
// dialog. Fixed in apps/desktop/src/print.ts (refuse an unchosen or
// file-writing printer) plus the Settings → Printing printer picker. The page
// rule was never involved.
//
// WHAT THIS SUITE PINS: the page height stays `auto` at every paper width, and
// no explicit length may be reintroduced. A length here is a PAPER-WASTING
// regression on real hardware, not a cosmetic one.
import { test } from "node:test";
import assert from "node:assert/strict";

import { PAPER_WIDTHS } from "@pos/shared/constants";

import { RECEIPT_PAGE_STYLE, receiptPageStyle } from "./print";

// `size: <width> <length>` — an explicit page HEIGHT. On a continuous roll
// this is the number of millimetres fed per slip.
const EXPLICIT_HEIGHT = /size:\s*[\d.]+(?:mm|cm|in|px|pt)\s+[\d.]+(?:mm|cm|in|px|pt)/;

test("REGRESSION (2026-09-17 runaway feed): the page height is `auto` — an explicit length makes a thermal printer feed that many mm per slip and run the roll out", () => {
  assert.match(
    RECEIPT_PAGE_STYLE,
    /size:\s*80mm\s+auto\b/,
    "RECEIPT_PAGE_STYLE must keep `80mm auto`. An explicit height is the PAGE LENGTH: 1200mm fed 1.2 metres per slip on the counter PC and did not stop when the roll was replaced.",
  );
  assert.doesNotMatch(
    RECEIPT_PAGE_STYLE,
    EXPLICIT_HEIGHT,
    "RECEIPT_PAGE_STYLE must not declare an explicit page height — that is the runaway-paper-feed bug.",
  );

  for (const width of PAPER_WIDTHS) {
    const style = receiptPageStyle(width);
    assert.match(
      style,
      new RegExp(`size:\\s*${width.replace(".", "\\.")}\\s+auto\\b`),
      `receiptPageStyle("${width}") must keep \`${width} auto\` — every configured paper width runs on a continuous roll.`,
    );
    assert.doesNotMatch(
      style,
      EXPLICIT_HEIGHT,
      `receiptPageStyle("${width}") must not declare an explicit page height.`,
    );
  }
});

test("REGRESSION: every page rule still declares its paper WIDTH and the 4mm margin", () => {
  for (const width of PAPER_WIDTHS) {
    const style = receiptPageStyle(width);
    assert.match(style, new RegExp(`size:\\s*${width.replace(".", "\\.")}\\b`), `receiptPageStyle("${width}") must declare that width`);
    assert.match(style, /margin: 4mm/, "the 4mm page margin must survive");
  }
});

test("REGRESSION: receiptPageStyle('80mm') reproduces RECEIPT_PAGE_STYLE byte for byte, and both match the long-standing working value", () => {
  assert.equal(receiptPageStyle("80mm"), RECEIPT_PAGE_STYLE);
  // The exact string that printed correctly from 2026-08-12 onwards. Pinned
  // verbatim so any future "fix" to the page rule has to confront this test
  // and the incident recorded at the top of this file.
  assert.equal(
    RECEIPT_PAGE_STYLE,
    "@page { size: 80mm auto; margin: 4mm; } @media print { body { margin: 0; } }",
  );
});
