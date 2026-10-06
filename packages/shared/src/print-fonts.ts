// Print customization S3 (01-PLAN §2.5): the self-hosted slip faces. Pure and client-safe. Each family below is
// declared by apps/cafe/app/print-fonts.css under exactly this name (pinned by the cafe's
// lib/print-fonts-paths.test.ts); the files are latin + ₹ subsets in apps/cafe/assets/print-fonts/.
//
// A slip sets its faces as inline `font-family` stacks built here, never through CSS variables or classes: a
// variable does not survive the react-to-print iframe or the raster lane's SVG, and the raster inliner keeps an
// @font-face only for a family some element's computed font-family names (lib/printer/raster-assets.ts).
import type { PrintFontKey } from "./print-template";

export const PRINT_FONT_FACES = ["sans", "condensed", "slab", "mono", "display", "devanagari"] as const;
export type PrintFontFace = (typeof PRINT_FONT_FACES)[number];

export interface PrintFontFaceInfo {
  /** The @font-face family name in apps/cafe/app/print-fonts.css. */
  family: string;
  /** The weights shipped; a missing weight resolves to the nearest one (400 -> 500, 600/800 -> 700). */
  weights: readonly number[];
  /** Digits share one width (natively or through `tnum`), so the face may print amounts and columns. */
  numbers: boolean;
  /** Carries ₹ (U+20B9). A face without it falls back to the stack's next family for that glyph. */
  rupee: boolean;
  /** Generic family closing the stack. */
  generic: "sans-serif" | "serif" | "monospace";
}

/** The raster lane's asset cache holds 16 entries (RASTER_ASSET_CACHE_MAX): weights x families must fit. */
export const PRINT_FONT_WEIGHTS_MAX = 2;
export const PRINT_FONT_FAMILIES_MAX = 4;

// Facts measured from the shipped files (fontTools, s75): digit advance widths, the GSUB feature list, the cmap.
export const PRINT_FONT_CATALOG: Record<PrintFontFace, PrintFontFaceInfo> = {
  // Inter: tnum, ₹, and every ornament the slips use, which is why it closes every other stack.
  sans: { family: "POS Print Sans", weights: [500, 700], numbers: true, rupee: true, generic: "sans-serif" },
  // Barlow Condensed: tnum; no ₹ (falls back to Sans).
  condensed: { family: "POS Print Condensed", weights: [500, 700], numbers: true, rupee: false, generic: "sans-serif" },
  // Roboto Slab (Apache-2.0): proportional digits and NO tnum, so headings only, never an amount.
  slab: { family: "POS Print Slab", weights: [500, 700], numbers: false, rupee: false, generic: "serif" },
  // IBM Plex Mono: monospace digits, ₹ (JetBrains Mono was rejected: no ₹).
  mono: { family: "POS Print Mono", weights: [500, 700], numbers: true, rupee: true, generic: "monospace" },
  // Archivo Black: one heavy weight, tabular digits, no ₹. Token numbers and names only.
  display: { family: "POS Print Display", weights: [400], numbers: true, rupee: false, generic: "sans-serif" },
  // Noto Sans Devanagari: joins a stack only when the slip carries Devanagari text (it is the largest file).
  devanagari: { family: "POS Print Devanagari", weights: [500, 700], numbers: true, rupee: true, generic: "sans-serif" },
};

/** A template's base font -> its face. "geistMono" is the legacy slip's own face (the root's `font-mono` class), not
 *  self-hosted, so it has no face and no stack. */
export const PRINT_FONT_KEY_FACE: Record<Exclude<PrintFontKey, "geistMono">, PrintFontFace> = {
  mono: "mono",
  sans: "sans",
  condensed: "condensed",
  slab: "slab",
};

/** The glyph fallback every self-hosted stack closes on: it carries ₹ and the ornaments the others lack. */
export const PRINT_FALLBACK_FACE: PrintFontFace = "sans";

export const SLIP_DEVANAGARI_RE = /[ऀ-ॿ]/;

/** The self-hosted face of a template font, or null for the legacy "geistMono". */
export function printFontFaceOf(font: PrintFontKey): PrintFontFace | null {
  return font === "geistMono" ? null : PRINT_FONT_KEY_FACE[font];
}

/** The faces a stack for `face` names, in order: the face, the ₹ fallback, then Devanagari when asked for. */
export function printFontStackFaces(face: PrintFontFace, devanagari: boolean): PrintFontFace[] {
  const faces: PrintFontFace[] = [face];
  if (face !== PRINT_FALLBACK_FACE) faces.push(PRINT_FALLBACK_FACE);
  if (devanagari && face !== "devanagari") faces.push("devanagari");
  return faces;
}

/** The inline `font-family` value for a face: its family, the fallbacks, and the generic family. */
export function printFontStack(face: PrintFontFace, devanagari: boolean): string {
  const names = printFontStackFaces(face, devanagari).map((f) => `"${PRINT_FONT_CATALOG[f].family}"`);
  return [...names, PRINT_FONT_CATALOG[face].generic].join(", ");
}
