// Pure ESC/POS raster encoder for the browser lanes (Web Serial, Web
// Bluetooth, native bridge). A Uint8Array port of apps/desktop/src/escpos.ts:
// the desktop app is OUTSIDE the npm workspace and is never imported, so
// escpos-parity.test.ts pins every constant, command byte and the luminance
// math equal to that file's source text. Differences by design: the pixel
// input is RGBA (canvas getImageData order, not Electron's BGRA) and there is
// no Buffer (browsers have none). No DOM or Node API is touched here.
import type { PaperWidth } from "@/lib/constants";

/** Standard thermal print-head density; every dot count below is derived from it. */
export const DOTS_PER_INCH = 203;
/** 72mm printable width @203dpi -- the dot width for an 80mm-class roll. */
export const DOTS_80MM = 576;
/** 48mm printable width @203dpi -- the dot width for a 58mm-class roll. */
export const DOTS_58MM = 384;
/** Luminance strictly below this (0-255) is rendered as a black dot. */
export const RASTER_THRESHOLD = 128;
/** Rows per GS v 0 command -- small so cheap boards never hold a whole slip. */
export const RASTER_BAND_ROWS = 256;
/** Blank rows appended after the ink, before the cut (about 2mm). */
export const RASTER_BOTTOM_PAD_ROWS = 16;
/** Upper bound on rows ever rasterized (about 2m of paper); the caller refuses past it. */
export const RASTER_MAX_ROWS = 16_000;
/** Alpha below this is transparent -- rendered as paper, never as ink. */
export const ALPHA_OPAQUE_MIN = 128;

// The slip's CSS width is measured from the drawn document (the cafe's receipt
// root is a fixed-width block: 300px for 80mm, 210px for 58mm -- PAPER_WIDTH_CLASS
// in lib/print.ts, parity-pinned). These bounds catch a document with no
// fixed-width root; the fallback then assumes the cafe's own widths.
export const SLIP_CSS_PX_MIN = 120;
export const SLIP_CSS_PX_MAX = 800;
export const SLIP_CSS_PX_DEFAULT_80MM = 300;
export const SLIP_CSS_PX_DEFAULT_58MM = 210;

/** The head's dot width for the cafe's configured paper width. */
export function dotsForPaper(paper: PaperWidth): number {
  return paper === "58mm" ? DOTS_58MM : DOTS_80MM;
}

/** The measured slip width when it is plausible, else the cafe's own default for this paper. */
export function usableSlipCssWidth(measured: number, dots: number): number {
  if (Number.isFinite(measured) && measured >= SLIP_CSS_PX_MIN && measured <= SLIP_CSS_PX_MAX) return measured;
  return dots === DOTS_58MM ? SLIP_CSS_PX_DEFAULT_58MM : SLIP_CSS_PX_DEFAULT_80MM;
}

export interface RasterBitmap {
  dots: number;
  rows: number;
  rowBytes: number;
  bits: Uint8Array;
}

function luminance(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Converts an RGBA pixel buffer (canvas getImageData order) into a
 * 1-bit-per-dot raster, MSB-first, cropped/padded to `dots` columns wide, with
 * trailing all-white rows trimmed so the paper is only as long as the ink.
 */
export function rasterizeRgba(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  dots: number,
): RasterBitmap {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`rasterizeRgba: width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError(`rasterizeRgba: height must be a positive integer, got ${height}`);
  }
  if (!Number.isInteger(dots) || dots <= 0 || dots % 8 !== 0) {
    throw new RangeError(`rasterizeRgba: dots must be a positive multiple of 8, got ${dots}`);
  }
  if (pixels.length !== width * height * 4) {
    throw new RangeError(
      `rasterizeRgba: pixels.length must equal width*height*4 (${width * height * 4}), got ${pixels.length}`,
    );
  }

  const rowBytes = dots / 8;
  const cols = Math.min(width, dots);
  const rowsOut: Uint8Array[] = [];

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(rowBytes);
    for (let x = 0; x < cols; x++) {
      const offset = (y * width + x) * 4;
      const r = pixels[offset] as number;
      const g = pixels[offset + 1] as number;
      const b = pixels[offset + 2] as number;
      const a = pixels[offset + 3] as number;
      const isBlack = a >= ALPHA_OPAQUE_MIN && luminance(r, g, b) < RASTER_THRESHOLD;
      if (isBlack) {
        const byteIndex = x >> 3;
        const bitInByte = 7 - (x & 7);
        row[byteIndex] = (row[byteIndex] as number) | (1 << bitInByte);
      }
    }
    // Columns beyond the source width (width < dots) stay white padding --
    // the row buffer starts zeroed, so nothing further is needed here.
    rowsOut.push(row);
  }

  // Trim TRAILING all-white rows only -- leading rows are the slip's own top
  // padding and must survive untouched.
  let lastInkRow = -1;
  for (let y = rowsOut.length - 1; y >= 0; y--) {
    const row = rowsOut[y] as Uint8Array;
    if (row.some((byte) => byte !== 0)) {
      lastInkRow = y;
      break;
    }
  }

  const rows = lastInkRow + 1;
  const bits = new Uint8Array(rowBytes * rows);
  for (let y = 0; y < rows; y++) {
    bits.set(rowsOut[y] as Uint8Array, y * rowBytes);
  }

  return { dots, rows, rowBytes, bits };
}

// --- ESC/POS byte protocol -------------------------------------------------

/** ESC @ -- reset the printer to its power-on state before the job. */
export const ESC_INIT = new Uint8Array([0x1b, 0x40]);
/** GS v 0 m -- start of a raster-image command; m=0x00 is "normal" (no scaling). */
export const GS_RASTER_HEADER = new Uint8Array([0x1d, 0x76, 0x30, 0x00]);
/** GS V 66 0 -- Epson "Function B": feed to the cutting position, then partial cut. */
export const CUT_PARTIAL_WITH_FEED = new Uint8Array([0x1d, 0x56, 0x42, 0x00]);

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** One GS v 0 band command: header + little-endian width(bytes)/height(dots) + the band bits. */
function buildRasterBand(rowBytes: number, bandRows: number, bandBits: Uint8Array): Uint8Array {
  const xL = rowBytes & 0xff;
  const xH = (rowBytes >> 8) & 0xff;
  const yL = bandRows & 0xff;
  const yH = (bandRows >> 8) & 0xff;
  return concatBytes([GS_RASTER_HEADER, new Uint8Array([xL, xH, yL, yH]), bandBits]);
}

/**
 * Turns a rasterized bitmap into the exact bytes to send to the printer:
 * init, the ink plus a blank bottom pad split into bands, then a partial cut.
 * A blank slip (rows === 0) is refused -- never send a cut with nothing printed.
 */
export function escposJob(raster: RasterBitmap): Uint8Array {
  if (raster.rows === 0) {
    throw new RangeError("escposJob: raster.rows === 0 -- a blank slip is never sent");
  }
  if (raster.bits.length !== raster.rowBytes * raster.rows) {
    throw new RangeError(
      `escposJob: bits.length (${raster.bits.length}) !== rowBytes*rows (${raster.rowBytes * raster.rows})`,
    );
  }

  const totalRows = raster.rows + RASTER_BOTTOM_PAD_ROWS;
  const padded = new Uint8Array(raster.rowBytes * totalRows);
  padded.set(raster.bits, 0);
  // The pad rows stay zeroed (white) -- Uint8Array is zero-initialized.

  const bands: Uint8Array[] = [];
  for (let rowStart = 0; rowStart < totalRows; rowStart += RASTER_BAND_ROWS) {
    const bandRows = Math.min(RASTER_BAND_ROWS, totalRows - rowStart);
    const byteStart = rowStart * raster.rowBytes;
    const byteEnd = byteStart + bandRows * raster.rowBytes;
    bands.push(buildRasterBand(raster.rowBytes, bandRows, padded.subarray(byteStart, byteEnd)));
  }

  return concatBytes([ESC_INIT, ...bands, CUT_PARTIAL_WITH_FEED]);
}
