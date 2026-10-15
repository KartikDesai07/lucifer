import { asciiText } from "./text-chars";
import { ITEM_GAP, TEXT_SUB_LINE_INDENT, textRow } from "./kot-text-design";
import { escposTextJob } from "./text-escpos";
import { layoutRows, lineWidth, type TextColumns, type TextPiece, type TextRow } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §5.1, S2): the slip a printer prints before its "Fast text KOTs" switch turns on.
// Staff check it on the paper: a sample kitchen ticket with a price in Rs, a double-height and a white-on-black line,
// and a ruler as long as a text line may be (the columns less one). If the ruler breaks onto a second line the printer
// has fewer columns (on 80 mm, try 42); if anything prints garbled, keep the switch off.

/** The ruler counts 1 to 0 again and again. */
export const TEXT_TEST_RULER_DIGITS = "1234567890".repeat(7);
export const TEXT_TEST_TITLE = "TEXT TEST";
export const TEXT_TEST_CHECK = "The numbers above fit on one line.";

export interface TextTestInput {
  /** The cafe's name; left off when text cannot print it. */
  cafeName: string | undefined;
  columns: TextColumns;
}

export function textTestPieces({ cafeName, columns }: TextTestInput): TextPiece[] {
  const name = asciiText(cafeName ?? "")?.trim() ?? "";
  const rows: TextRow[] = [
    ...(name === "" ? [] : [textRow(name, 1.29, true, "center")]),
    textRow(TEXT_TEST_TITLE, 1.6, true, "center"),
    { kind: "rule", rule: "dashed" },
    textRow("KITCHEN ORDER", 1.29, true, "center"),
    { kind: "item", name: "2 x Masala Chai", amount: "Rs 80", style: { align: "left", bold: true, ratio: 1 }, hang: 0 },
    textRow("+ Less sugar", 0.86, false, "left", { indent: TEXT_SUB_LINE_INDENT }),
    textRow("> Hot please", 0.86, true, "left", { indent: TEXT_SUB_LINE_INDENT }),
    ITEM_GAP,
    { kind: "item", name: "1 x Paneer Tikka", amount: "Rs 240", style: { align: "left", bold: true, ratio: 1 }, hang: 0 },
    { kind: "rule", rule: "dashed" },
    textRow("WHITE ON BLACK", 1.29, true, "center", { invert: true }),
    textRow(TEXT_TEST_RULER_DIGITS.slice(0, lineWidth(columns, "normal")), 1, false, "left"),
    textRow(TEXT_TEST_CHECK, 0.86, false, "center"),
  ];
  const pieces = layoutRows(rows, columns);
  // Every row above is ASCII and the name was checked: a null here is a bug, never a printer's state.
  if (pieces === null) throw new Error("textTestPieces: the sample does not lay out");
  return pieces;
}

export function textTestJob(input: TextTestInput): Uint8Array {
  return escposTextJob(textTestPieces(input), input.columns);
}
