import type { BlockAlign, DividerStyle } from "@pos/shared/print-template";
import type { PaperWidth } from "@/lib/constants";
import { asciiText } from "./text-chars";

// Printing Phase 4 (spec 2026-10-15 §4.3): the rows a design's text renderer says a block prints become the lines a
// printer prints in its own Font A. Pure: no React, no DOM, no printer. A row's characters are mapped and checked here
// (text-chars.ts); one character text cannot print makes the whole layout null, and the slip prints as a picture.

/** The printer's character sizes text mode uses: normal, double height, double width and height. */
export type TextSize = "normal" | "tall" | "big";

/** A line whose size in the picture is at least this many times the base prints double height (spec §4.3). */
export const TEXT_TALL_MIN_RATIO = 1.2;
/** …and at least this many times, double width and height. */
export const TEXT_BIG_MIN_RATIO = 1.5;

/** Font A's columns per paper (spec P4-5): 32 on 58 mm, 48 on 80 mm, or 42 for an 80 mm printer with a narrower head. */
export const TEXT_COLUMNS_58MM = 32;
export const TEXT_COLUMNS_80MM = 48;
export const TEXT_COLUMNS_80MM_NARROW = 42;
export type TextColumns = typeof TEXT_COLUMNS_58MM | typeof TEXT_COLUMNS_80MM | typeof TEXT_COLUMNS_80MM_NARROW;
export const TEXT_COLUMN_CHOICES: readonly TextColumns[] = [TEXT_COLUMNS_58MM, TEXT_COLUMNS_80MM_NARROW, TEXT_COLUMNS_80MM];

/** A line leaves its last column empty: a printer that moves to the next line by itself when a line is exactly full
 *  would otherwise add a blank line (spec §4.3). */
const SPARE_COLUMNS = 1;

export function textSizeOf(ratio: number): TextSize {
  if (ratio >= TEXT_BIG_MIN_RATIO) return "big";
  return ratio >= TEXT_TALL_MIN_RATIO ? "tall" : "normal";
}

export function textColumnsOf(paper: PaperWidth, narrow80: boolean): TextColumns {
  if (paper === "58mm") return TEXT_COLUMNS_58MM;
  return narrow80 ? TEXT_COLUMNS_80MM_NARROW : TEXT_COLUMNS_80MM;
}

/** The most characters one line holds at a size. */
export function lineWidth(columns: number, size: TextSize): number {
  const usable = columns - SPARE_COLUMNS;
  return size === "big" ? Math.floor(usable / 2) : usable;
}

/** One printed line: printable ASCII, never longer than lineWidth at its size. */
export interface TextLine {
  text: string;
  align: BlockAlign;
  bold: boolean;
  size: TextSize;
  invert: boolean;
}

/** A paper feed, ESC J n: n of the printer's vertical motion units (a dot on most receipt printers, finer on some). */
export interface TextFeed {
  feedDots: number;
}

export type TextPiece = TextLine | TextFeed;

/** How a row prints. `ratio` is the line's size in the picture relative to the 14 px base (spec §4.3). */
export interface RowStyle {
  align: BlockAlign;
  bold: boolean;
  ratio: number;
  invert?: boolean;
  /** Upper case, as the design's CSS `uppercase` shows it (a row's text; an item's name, never its amount). */
  upper?: boolean;
  /** Spaces before each line of a left-aligned row. */
  indent?: number;
}

/** What a design's text renderer says a block prints, before the characters are checked and the lines wrapped. */
export type TextRow =
  /** Free text; `keepBreaks` keeps its line breaks (custom text), elsewhere a break is a space. */
  | { kind: "text"; text: string; style: RowStyle; keepBreaks?: boolean }
  /** A label left and its value right; a pair that does not fit puts the value under the label, right-aligned. */
  | { kind: "split"; label: string; value: string; style: RowStyle }
  /** An item: its name left and its amount ("" for none) right on the first line; the name wraps, its later lines
   *  starting `hang` columns in. */
  | { kind: "item"; name: string; amount: string; style: RowStyle; hang: number }
  | { kind: "rule"; rule: DividerStyle }
  | { kind: "feed"; dots: number };

/** An item's first line keeps at least this much room for its name; a longer amount goes to a line of its own. */
const ITEM_NAME_MIN_COLUMNS = 6;
const ORNAMENT_TEXT = "* * * * *";

/** Greedy word wrap at spaces; a word longer than a line is split. The first line may have its own width. Always at
 *  least one line (an empty text is one empty line). */
export function wrapWords(text: string, width: number, firstWidth: number = width): string[] {
  const words = text.split(" ").filter((word) => word !== "");
  const lines: string[] = [];
  let line = "";
  const room = (): number => Math.max(1, lines.length === 0 ? firstWidth : width);
  for (const whole of words) {
    let word = whole;
    while (word.length > 0) {
      const cap = room();
      if (line === "") {
        const part = word.slice(0, cap);
        word = word.slice(part.length);
        if (word.length > 0) lines.push(part);
        else line = part;
      } else if (line.length + 1 + word.length <= cap) {
        line = `${line} ${word}`;
        word = "";
      } else {
        lines.push(line);
        line = "";
      }
    }
  }
  if (line !== "" || lines.length === 0) lines.push(line);
  return lines;
}

function bandOf(text: string, width: number, align: BlockAlign): string {
  const pad = Math.max(0, width - text.length);
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") return " ".repeat(Math.floor(pad / 2)) + text + " ".repeat(pad - Math.floor(pad / 2));
  return text + " ".repeat(pad);
}

function lineOf(text: string, style: RowStyle, size: TextSize, width: number): TextLine {
  const invert = style.invert === true;
  return {
    text: invert ? bandOf(text, width, style.align) : text,
    // A band carries its own placement in its spaces.
    align: invert ? "left" : style.align,
    bold: style.bold,
    size,
    invert,
  };
}

function textLines(row: Extract<TextRow, { kind: "text" }>, columns: number): TextLine[] | null {
  const mapped = asciiText(row.text);
  if (mapped === null) return null;
  const cased = row.style.upper === true ? mapped.toUpperCase() : mapped;
  const segments = row.keepBreaks === true ? cased.split("\n").map((s) => s.trimEnd()) : [cased.replace(/\s+/g, " ").trim()];
  if (segments.length === 1 && segments[0] === "") return [];
  const size = textSizeOf(row.style.ratio);
  const width = lineWidth(columns, size);
  const indent = row.style.indent ?? 0;
  const margin = " ".repeat(indent);
  return segments.flatMap((segment) => wrapWords(segment, width - indent).map((part) => lineOf(margin + part, row.style, size, width)));
}

function splitLines(row: Extract<TextRow, { kind: "split" }>, columns: number): TextLine[] | null {
  const label = asciiText(row.label);
  const value = asciiText(row.value);
  if (label === null || value === null) return null;
  const l = label.replace(/\s+/g, " ").trim();
  const v = value.replace(/\s+/g, " ").trim();
  const size = textSizeOf(row.style.ratio);
  const width = lineWidth(columns, size);
  const left: RowStyle = { ...row.style, align: "left" };
  if (v === "") return wrapWords(l, width).map((part) => lineOf(part, left, size, width));
  if (l.length + 1 + v.length <= width) return [lineOf(l + " ".repeat(width - l.length - v.length) + v, left, size, width)];
  return [
    ...wrapWords(l, width).map((part) => lineOf(part, left, size, width)),
    ...wrapWords(v, width).map((part) => lineOf(part.padStart(width), left, size, width)),
  ];
}

function itemLines(row: Extract<TextRow, { kind: "item" }>, columns: number): TextLine[] | null {
  const name = asciiText(row.name);
  const amount = asciiText(row.amount);
  if (name === null || amount === null) return null;
  const n = (row.style.upper === true ? name.toUpperCase() : name).replace(/\s+/g, " ").trim();
  const a = amount.replace(/\s+/g, " ").trim();
  const size = textSizeOf(row.style.ratio);
  const width = lineWidth(columns, size);
  const left: RowStyle = { ...row.style, align: "left" };
  const hang = " ".repeat(row.hang);
  const rest = width - row.hang;
  const firstWidth = a === "" ? width : width - a.length - 1;
  if (firstWidth < ITEM_NAME_MIN_COLUMNS) {
    const named = wrapWords(n, rest, width).map((part, i) => lineOf(i === 0 ? part : hang + part, left, size, width));
    return [...named, lineOf(a.padStart(width), left, size, width)];
  }
  return wrapWords(n, rest, firstWidth).map((part, i) => {
    if (i > 0) return lineOf(hang + part, left, size, width);
    return lineOf(a === "" ? part : part.padEnd(width - a.length) + a, left, size, width);
  });
}

function ruleLine(rule: DividerStyle, columns: number): TextLine {
  const width = lineWidth(columns, "normal");
  const plain = { align: "left" as const, bold: false, size: "normal" as const, invert: false };
  switch (rule) {
    case "dashed":
      return { ...plain, text: "- ".repeat(Math.ceil(width / 2)).slice(0, width).trimEnd() };
    case "solid":
      return { ...plain, text: "-".repeat(width) };
    case "double":
      return { ...plain, text: "=".repeat(width) };
    case "blank":
      return { ...plain, text: "" };
    case "ornament":
      return { ...plain, text: ORNAMENT_TEXT, align: "center" };
  }
}

/** Every row as printed pieces, or null when any of them holds a character text cannot print. */
export function layoutRows(rows: readonly TextRow[], columns: number): TextPiece[] | null {
  const pieces: TextPiece[] = [];
  for (const row of rows) {
    if (row.kind === "feed") {
      pieces.push({ feedDots: row.dots });
      continue;
    }
    if (row.kind === "rule") {
      pieces.push(ruleLine(row.rule, columns));
      continue;
    }
    const lines = row.kind === "text" ? textLines(row, columns) : row.kind === "split" ? splitLines(row, columns) : itemLines(row, columns);
    if (lines === null) return null;
    pieces.push(...lines);
  }
  return pieces;
}
