import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutRows, lineWidth, textColumnsOf, textSizeOf, wrapWords, type RowStyle, type TextLine, type TextPiece } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.3): a design's rows become printed lines: sizes from the picture's em ratio,
// at most one character less than the columns per line, words wrapped, label / value and item rows, rules and bands.

const plain: RowStyle = { align: "left", bold: false, ratio: 1 };
const textsOf = (pieces: TextPiece[] | null): string[] => {
  assert.ok(pieces !== null, "the rows are printable");
  return pieces.map((piece) => ("text" in piece ? piece.text : `<feed ${piece.feedDots}>`));
};
const lineOf = (pieces: TextPiece[] | null, i: number): TextLine => {
  assert.ok(pieces !== null, "the rows are printable");
  const piece = pieces[i];
  assert.ok(piece !== undefined && "text" in piece, `piece ${i} is a line`);
  return piece;
};

test("a line's size follows the picture's em ratio", () => {
  assert.equal(textSizeOf(0.86), "normal", "a small line is normal");
  assert.equal(textSizeOf(1.19), "normal", "below 1.2 is normal");
  assert.equal(textSizeOf(1.2), "tall", "1.2 is double height");
  assert.equal(textSizeOf(1.29), "tall", "Classic's title is double height");
  assert.equal(textSizeOf(1.49), "tall", "below 1.5 is double height");
  assert.equal(textSizeOf(1.5), "big", "1.5 is double width and height");
  assert.equal(textSizeOf(2.2), "big", "Kitchen Bold's ticket number is double size");
});

test("columns come from the paper, with the 42 choice on 80 mm only", () => {
  assert.equal(textColumnsOf("58mm", false), 32, "58 mm prints 32 columns");
  assert.equal(textColumnsOf("58mm", true), 32, "the 42 choice does not apply to 58 mm");
  assert.equal(textColumnsOf("80mm", false), 48, "80 mm prints 48 columns");
  assert.equal(textColumnsOf("80mm", true), 42, "an 80 mm printer set to 42");
});

test("a line holds one character less than the columns, half of that at double width", () => {
  assert.equal(lineWidth(48, "normal"), 47, "48 columns: 47 characters");
  assert.equal(lineWidth(48, "tall"), 47, "double height keeps the width");
  assert.equal(lineWidth(48, "big"), 23, "double width: 23");
  assert.equal(lineWidth(42, "big"), 20, "42 columns at double width: 20");
  assert.equal(lineWidth(32, "normal"), 31, "32 columns: 31");
  assert.equal(lineWidth(32, "big"), 15, "32 columns at double width: 15");
});

test("words wrap greedily, a word longer than the line is split, and the first line may be shorter", () => {
  assert.deepEqual(wrapWords("Paneer Tikka Masala", 12), ["Paneer Tikka", "Masala"], "greedy at spaces");
  assert.deepEqual(wrapWords("Supercalifragilistic", 8), ["Supercal", "ifragili", "stic"], "a long word is split");
  assert.deepEqual(wrapWords("a b c d e f", 5, 3), ["a b", "c d e", "f"], "the first line has its own width");
  assert.deepEqual(wrapWords("  spaced   out  ", 20), ["spaced out"], "runs of spaces are one");
  assert.deepEqual(wrapWords("", 10), [""], "an empty text is one empty line");
});

test("a text row is mapped, wrapped and styled; a band is padded to the full width", () => {
  const centred = layoutRows([{ kind: "text", text: "KITCHEN ORDER", style: { align: "center", bold: true, ratio: 1.29 } }], 48);
  assert.deepEqual(lineOf(centred, 0), { text: "KITCHEN ORDER", align: "center", bold: true, size: "tall", invert: false }, "a tall bold centred title");
  const band = layoutRows([{ kind: "text", text: "REPRINT", style: { align: "center", bold: true, ratio: 1.29, invert: true } }], 48);
  assert.equal(lineOf(band, 0).text, `${" ".repeat(20)}REPRINT${" ".repeat(20)}`, "the band spans 47 characters, the word centred");
  assert.equal(lineOf(band, 0).align, "left", "a padded band needs no alignment command");
  const bigBand = layoutRows([{ kind: "text", text: "KOT 12", style: { align: "left", bold: true, ratio: 2.2, invert: true } }], 48);
  assert.equal(lineOf(bigBand, 0).text, `KOT 12${" ".repeat(17)}`, "a double-size band spans 23 characters");
  const indented = layoutRows([{ kind: "text", text: "Less sugar and extra ginger please", style: { ...plain, ratio: 0.86, indent: 4 } }], 32);
  assert.deepEqual(textsOf(indented), ["    Less sugar and extra ginger", "    please"], "an indented line wraps inside its indent");
  const upper = layoutRows([{ kind: "text", text: "Test Cafe", style: { ...plain, upper: true } }], 48);
  assert.deepEqual(textsOf(upper), ["TEST CAFE"], "upper case on request");
  const kept = layoutRows([{ kind: "text", text: "Line one\n\nLine three", style: plain, keepBreaks: true }], 48);
  assert.deepEqual(textsOf(kept), ["Line one", "", "Line three"], "custom text keeps its line breaks");
  const joined = layoutRows([{ kind: "text", text: "Line one\nLine two", style: plain }], 48);
  assert.deepEqual(textsOf(joined), ["Line one Line two"], "elsewhere a line break is a space");
  assert.deepEqual(textsOf(layoutRows([{ kind: "text", text: "   ", style: plain }], 48)), [], "a blank text prints nothing");
});

test("a label / value row keeps its ends, and moves the value under the label when they do not fit", () => {
  const fits = layoutRows([{ kind: "split", label: "Table", value: "T-4", style: plain }], 32);
  assert.deepEqual(textsOf(fits), [`Table${" ".repeat(23)}T-4`], "label left, value right in 31 characters");
  const long = layoutRows([{ kind: "split", label: "Staff", value: "Aishwarya Ramachandran Iyer", style: plain }], 32);
  assert.deepEqual(textsOf(long), ["Staff", "    Aishwarya Ramachandran Iyer"], "the value drops to its own line, right-aligned");
});

test("an item row keeps the amount on its first line; the name wraps from the start or under its hang", () => {
  const short = layoutRows([{ kind: "item", name: "2 × Masala Chai", amount: "₹80", style: { ...plain, bold: true }, hang: 0 }], 48);
  assert.deepEqual(textsOf(short), [`2 x Masala Chai${" ".repeat(27)}Rs 80`], "mapped, the amount flush right");
  const classic = layoutRows([{ kind: "item", name: "1 × Paneer Butter Masala With Extra Gravy", amount: "₹1,240", style: plain, hang: 0 }], 32);
  assert.deepEqual(textsOf(classic), [`${"1 x Paneer Butter".padEnd(23)}Rs 1,240`, "Masala With Extra Gravy"], "Classic wraps from the line's start");
  const bold = layoutRows([{ kind: "item", name: "[1] Paneer Butter Masala With Extra Gravy", amount: "", style: { ...plain, upper: true }, hang: 4 }], 32);
  assert.deepEqual(textsOf(bold), ["[1] PANEER BUTTER MASALA WITH", "    EXTRA GRAVY"], "Kitchen Bold wraps under the name");
});

test("rules span the line; a blank rule is an empty line and an ornament is centred", () => {
  const rules = layoutRows(
    [{ kind: "rule", rule: "dashed" }, { kind: "rule", rule: "solid" }, { kind: "rule", rule: "double" }, { kind: "rule", rule: "blank" }, { kind: "rule", rule: "ornament" }],
    32,
  );
  assert.deepEqual(
    textsOf(rules),
    ["- - - - - - - - - - - - - - - -", "-".repeat(31), "=".repeat(31), "", "* * * * *"],
    "dashed, solid, double, blank, ornament",
  );
  assert.equal(lineOf(rules, 4).align, "center", "the ornament is centred");
});

test("a feed row is a feed; any character text cannot print makes the whole layout null", () => {
  assert.deepEqual(textsOf(layoutRows([{ kind: "feed", dots: 12 }], 48)), ["<feed 12>"], "a feed passes through");
  assert.equal(layoutRows([{ kind: "text", text: "Paneer Tikka", style: plain }, { kind: "text", text: "पनीर", style: plain }], 48), null, "Hindi anywhere: null");
  assert.equal(layoutRows([{ kind: "split", label: "Staff", value: "Ramesh ભાઈ", style: plain }], 48), null, "Gujarati in a value: null");
  assert.equal(layoutRows([{ kind: "item", name: "1 × Crème brûlée", amount: "₹200", style: plain, hang: 0 }], 48), null, "an accented name: null");
});
