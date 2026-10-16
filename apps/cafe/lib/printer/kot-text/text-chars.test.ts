import { test } from "node:test";
import assert from "node:assert/strict";

import { TEXT_CHAR_MAP, asciiText } from "./text-chars";

// Printing Phase 4 (spec 2026-10-15 §4.2): only printable ASCII reaches a printer in text mode; a few characters today's
// kitchen tickets print are mapped first, and anything else makes the slip a picture (asciiText answers null).

const ch = (code: number): string => String.fromCharCode(code);

test("printable ASCII passes through unchanged", () => {
  const all = Array.from({ length: 0x7f - 0x20 }, (_, i) => ch(0x20 + i)).join("");
  assert.equal(asciiText(all), all, "every character from space to tilde is kept");
  assert.equal(asciiText(""), "", "an empty string stays empty");
});

test("the mapped characters become their ASCII text", () => {
  const cases: Array<[string, string]> = [
    [`${ch(0x20b9)}240`, "Rs 240"],
    [`${ch(0x20b9)}1,23,456`, "Rs 1,23,456"],
    [`2 ${ch(0x00d7)} Masala Chai`, "2 x Masala Chai"],
    [`T-1 ${ch(0x2192)} T-4`, "T-1 -> T-4"],
    [`ORDERED ${ch(0x2014)} DO NOT`, "ORDERED - DO NOT"],
    [`a ${ch(0x2013)} b`, "a - b"],
    [`${ch(0x25b8)} no onion`, "> no onion"],
    [`${ch(0x00bb)} no onion`, ">> no onion"],
    [`BACKUP PRINTER ${ch(0x00b7)} REPRINT`, "BACKUP PRINTER - REPRINT"],
    [`${ch(0x2018)}hot${ch(0x2019)}`, "'hot'"],
    [`${ch(0x201c)}hot${ch(0x201d)}`, '"hot"'],
    [`wait${ch(0x2026)}`, "wait..."],
    [`02:35${ch(0x202f)}pm`, "02:35 pm"],
    [`02:35${ch(0x00a0)}pm`, "02:35 pm"],
  ];
  for (const [from, to] of cases) assert.equal(asciiText(from), to, `maps ${JSON.stringify(from)}`);
  assert.equal(TEXT_CHAR_MAP.size, 15, "the map holds exactly the fifteen characters of spec §4.2");
});

test("line breaks are kept; a carriage return and a tab are spaces, as the picture shows them (the 4A gate's m-1)", () => {
  assert.equal(asciiText("one\r\ntwo\nthree"), "one \ntwo\nthree", "CRLF: a space, then the line break (the layout trims it)");
  assert.equal(asciiText("no onion\rno garlic"), "no onion no garlic", "a lone carriage return is a space, never two words run together");
  assert.equal(asciiText("a\tb"), "a b", "a tab is one space");
});

test("any other character means the slip cannot be text", () => {
  const refused = [
    "पनीर टिक्का", // Hindi (Devanagari)
    "ખમણ ઢોકળા", // Gujarati
    "பனீர்", // Tamil
    "Café", // an accented Latin letter
    "Chai " + String.fromCodePoint(0x1f375), // an emoji
    "Pizza" + ch(0x2122), // a trademark sign, not in the map
    "€5", // a currency sign not in the map
    "a" + ch(0x7f), // DEL is not printable
    "a" + ch(0x1b) + "@", // a control character (ESC) typed into a name never reaches the printer
  ];
  for (const text of refused) assert.equal(asciiText(text), null, `refuses ${JSON.stringify(text)}`);
});
