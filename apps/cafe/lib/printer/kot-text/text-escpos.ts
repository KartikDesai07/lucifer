import type { BlockAlign } from "@pos/shared/print-template";
import { CUT_PARTIAL_WITH_FEED, ESC_INIT, RASTER_BOTTOM_PAD_ROWS } from "../escpos";
import { PRINTABLE_MAX, PRINTABLE_MIN } from "./text-chars";
import { lineWidth, type TextPiece, type TextSize } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.3): a text job's bytes. Only standard ESC/POS commands every receipt printer
// knows: ESC @ (once, first), ESC a (alignment), ESC E (bold), GS ! (character size), GS B (white on black), LF, ESC J
// (a feed) and the picture's own cut. ESC J n feeds n of the printer's vertical motion units: a dot (1/203 inch) on most
// receipt printers, finer on some (1/360 inch on Epson TM), so a feed is about, not exactly, the picture's gap. No code page command: the text is printable ASCII (text-chars.ts). The
// raster encoder (escpos.ts) is only read from, for the init, the bottom pad and the cut, so both kinds of slip begin
// and end the same way.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const ALIGN_BYTE: Record<BlockAlign, number> = { left: 0, center: 1, right: 2 };
// GS ! n: width multiplier - 1 in the high nibble, height multiplier - 1 in the low one.
const SIZE_BYTE: Record<TextSize, number> = { normal: 0x00, tall: 0x01, big: 0x11 };
/** ESC J n takes one byte. */
const FEED_DOTS_MAX = 255;

/** The bytes for the pieces at `columns`. Throws on a blank slip, a line longer than its size allows, a character outside
 *  printable ASCII or a bad feed: the caller then prints the slip as a picture (spec S3), never these bytes. */
export function escposTextJob(pieces: readonly TextPiece[], columns: number): Uint8Array {
  if (!pieces.some((piece) => "text" in piece && piece.text.trim() !== "")) {
    throw new RangeError("escposTextJob: a blank slip is never sent");
  }
  const out: number[] = Array.from(ESC_INIT);
  let align = ALIGN_BYTE.left;
  let bold = false;
  let size = SIZE_BYTE.normal;
  let invert = false;
  for (const piece of pieces) {
    if ("feedDots" in piece) {
      if (!Number.isInteger(piece.feedDots) || piece.feedDots < 1 || piece.feedDots > FEED_DOTS_MAX) {
        throw new RangeError(`escposTextJob: a feed of ${piece.feedDots} dots`);
      }
      out.push(ESC, 0x4a, piece.feedDots);
      continue;
    }
    const most = lineWidth(columns, piece.size);
    if (piece.text.length > most) throw new RangeError(`escposTextJob: a ${piece.size} line longer than ${most}`);
    if (ALIGN_BYTE[piece.align] !== align) {
      align = ALIGN_BYTE[piece.align];
      out.push(ESC, 0x61, align);
    }
    if (piece.bold !== bold) {
      bold = piece.bold;
      out.push(ESC, 0x45, bold ? 1 : 0);
    }
    if (SIZE_BYTE[piece.size] !== size) {
      size = SIZE_BYTE[piece.size];
      out.push(GS, 0x21, size);
    }
    if (piece.invert !== invert) {
      invert = piece.invert;
      out.push(GS, 0x42, invert ? 1 : 0);
    }
    for (let i = 0; i < piece.text.length; i++) {
      const code = piece.text.charCodeAt(i);
      if (code < PRINTABLE_MIN || code > PRINTABLE_MAX) throw new RangeError("escposTextJob: a character that is not printable ASCII");
      out.push(code);
    }
    out.push(LF);
  }
  // Every style back to the power-on state, without ESC @ (some printers drop buffered text on it).
  if (invert) out.push(GS, 0x42, 0);
  if (size !== SIZE_BYTE.normal) out.push(GS, 0x21, SIZE_BYTE.normal);
  if (bold) out.push(ESC, 0x45, 0);
  if (align !== ALIGN_BYTE.left) out.push(ESC, 0x61, ALIGN_BYTE.left);
  out.push(ESC, 0x4a, RASTER_BOTTOM_PAD_ROWS, ...CUT_PARTIAL_WITH_FEED);
  return Uint8Array.from(out);
}
