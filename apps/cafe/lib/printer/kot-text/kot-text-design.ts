import type { BlockAlign, BlockSize, KotBlockOf, KotBlockType } from "@pos/shared/print-template";
import type { PrintFontSize } from "@pos/shared/constants";
import type { KotSlipContext } from "@/components/print/slip/slip-context";
import type { RowStyle, TextRow } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.3, §4.4): the contract of a kitchen-ticket design's TEXT renderer, the twin of
// its React renderer (components/print/slip/slip-designs.ts). Each block type says what text rows it prints, in the
// same words and order as the picture (pinned by kot-text-parity.test.ts), or that it has no text form (a logo or a QR
// code that would print), which makes the whole slip a picture. Sizes are the picture's em ratios.

/** A block that would print something text cannot (a logo, a QR code): the slip prints as a picture. */
export const PICTURE_ONLY = "picture-only";
export type PictureOnly = typeof PICTURE_ONLY;

/** What a text renderer reads: the picture's own context (kotSlipContext) plus SlipEngine's one whole-slip fact. */
export interface KotTextContext extends KotSlipContext {
  /** The visible items block shows prices (the round total prints only then). */
  showsPrices: boolean;
}

export type KotTextRenderers = {
  [T in KotBlockType]: (block: KotBlockOf<T>, ctx: KotTextContext) => TextRow[] | PictureOnly;
};

export interface KotTextDesign {
  rows: KotTextRenderers;
  /** A block's extra size from its design's group wrapper in the picture (Classic's meta lines are 0.93em). */
  groupRatio: Partial<Record<KotBlockType, number>>;
}

/** The template's base size against the 14 px a ratio is measured from (lib/print.ts PRINT_FONT_CLASS). */
export const TEXT_BASE_RATIO: Record<PrintFontSize, number> = { small: 12 / 14, normal: 1, large: 16 / 14 };

/** A block's own size choice (components/print/slip/slip-style.ts BLOCK_SIZE_CLASS). */
export const TEXT_BLOCK_SIZE_RATIO: Record<BlockSize, number> = { xs: 0.75, sm: 0.875, md: 1, lg: 1.25, xl: 1.5 };

/** A locked line never shrinks below "sm" (slip-style.ts LOCKED_MIN_SIZE). */
export const TEXT_LOCKED_MIN_SIZE: BlockSize = "sm";

/** The feed between two items (ESC J 12): about the picture's gap, in the printer's motion units (text-escpos.ts). */
export const TEXT_ITEM_GAP_DOTS = 12;

/** Modifier and instruction lines sit this many spaces in (the picture's pl-4). */
export const TEXT_SUB_LINE_INDENT = 4;

/** One text row. */
export function textRow(text: string, ratio: number, bold: boolean, align: BlockAlign, more: Partial<RowStyle> = {}): TextRow {
  return { kind: "text", text, style: { align, bold, ratio, ...more } };
}

/** Free text that keeps its line breaks (custom text, whitespace-pre-wrap in the picture). */
export function keptTextRow(text: string, ratio: number, bold: boolean, align: BlockAlign): TextRow {
  return { kind: "text", text, style: { align, bold, ratio }, keepBreaks: true };
}

/** A label / value row at the body's size, regular weight. */
export function splitRow(label: string, value: string): TextRow {
  return { kind: "split", label, value, style: { align: "left", bold: false, ratio: 1 } };
}

export const ITEM_GAP: TextRow = { kind: "feed", dots: TEXT_ITEM_GAP_DOTS };
