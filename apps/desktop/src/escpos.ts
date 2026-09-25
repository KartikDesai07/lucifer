// Pure ESC/POS raster module. Imports NOTHING from electron or node:fs —
// only Buffer (Node global) — so node --import tsx --test can load it directly.
//
// 2026-09-19: the POS80 thermal driver ignored the app's page size and printed
// on its own fixed form — a 4cm slip came out on a 297mm page, and earlier the
// same driver truncated a 32-item bill onto a Letter-sized form. The fix
// bypasses the GDI driver entirely: the slip is rasterized to a 1-bit bitmap
// here, then sent as raw ESC/POS bytes to the spooler, so the paper the
// printer feeds is exactly as long as the ink on it — never a fixed form.

/** Standard thermal print-head density; every dot count below is derived from it. */
export const DOTS_PER_INCH = 203;
/** 72mm printable width @203dpi -- the dot width for an 80mm-class roll. */
export const DOTS_80MM = 576;
/** 48mm printable width @203dpi -- the dot width for a 58mm-class roll. */
export const DOTS_58MM = 384;
/** A roll reported at least this wide (in microns) is treated as 80mm class. */
export const WIDE_PAPER_MIN_MICRONS = 70_000;
/** Luminance strictly below this (0-255) is rendered as a black dot. */
export const RASTER_THRESHOLD = 128;
/** Rows per GS v 0 command -- kept small so cheap clone boards' receive
 *  buffers never have to hold a whole tall slip at once. */
export const RASTER_BAND_ROWS = 256;
/** Blank rows appended after the ink, before the cut -- roughly 2mm, enough
 *  that the cutter never bites into the last printed line. */
export const RASTER_BOTTOM_PAD_ROWS = 16;
/** Upper bound on rows the caller will ever raster -- roughly 2m of paper.
 *  Never fed blind; a raster past this is refused by the caller, not here. */
export const RASTER_MAX_ROWS = 16_000;

/**
 * Picks the dot width for a reported roll width. `null` (width unknown) is
 * treated as the common case, 80mm, rather than narrowing a normal roll.
 */
export function dotsForPaperWidth(widthMicrons: number | null): number {
  if (widthMicrons === null || !Number.isFinite(widthMicrons)) {
    return DOTS_80MM;
  }
  return widthMicrons >= WIDE_PAPER_MIN_MICRONS ? DOTS_80MM : DOTS_58MM;
}

export interface RasterBitmap {
  dots: number;
  rows: number;
  rowBytes: number;
  bits: Uint8Array;
}

/** Alpha below this is treated as transparent -- rendered as white (paper),
 *  not black, so an offscreen surface's transparent margins never print. */
const ALPHA_OPAQUE_MIN = 128;

function luminance(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Converts a BGRA pixel buffer (Electron NativeImage.toBitmap order) into a
 * 1-bit-per-dot raster, MSB-first, cropped/padded to `dots` columns wide, with
 * trailing all-white rows trimmed so the paper is only as long as the ink.
 */
export function rasterizeBgra(pixels: Uint8Array, width: number, height: number, dots: number): RasterBitmap {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`rasterizeBgra: width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError(`rasterizeBgra: height must be a positive integer, got ${height}`);
  }
  if (!Number.isInteger(dots) || dots <= 0 || dots % 8 !== 0) {
    throw new RangeError(`rasterizeBgra: dots must be a positive multiple of 8, got ${dots}`);
  }
  if (pixels.length !== width * height * 4) {
    throw new RangeError(
      `rasterizeBgra: pixels.length must equal width*height*4 (${width * height * 4}), got ${pixels.length}`,
    );
  }

  const rowBytes = dots / 8;
  const cols = Math.min(width, dots);
  const rowsOut: Uint8Array[] = [];

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(rowBytes);
    for (let x = 0; x < cols; x++) {
      const offset = (y * width + x) * 4;
      const b = pixels[offset] as number;
      const g = pixels[offset + 1] as number;
      const r = pixels[offset + 2] as number;
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
const ESC_INIT = Buffer.from([0x1b, 0x40]);
/** GS v 0 m -- start of a raster-image command; m=0x00 is "normal" (no scaling). */
const GS_RASTER_HEADER = Buffer.from([0x1d, 0x76, 0x30, 0x00]);
/** GS V 66 0 -- Epson "Function B": feed to the cutting position, then partial cut. */
const CUT_PARTIAL_WITH_FEED = Buffer.from([0x1d, 0x56, 0x42, 0x00]);

/**
 * Builds one GS v 0 band command: header + little-endian width/height in
 * bytes/dots + the raw band bits.
 */
function buildRasterBand(rowBytes: number, bandRows: number, bandBits: Uint8Array): Buffer {
  const xL = rowBytes & 0xff;
  const xH = (rowBytes >> 8) & 0xff;
  const yL = bandRows & 0xff;
  const yH = (bandRows >> 8) & 0xff;
  return Buffer.concat([GS_RASTER_HEADER, Buffer.from([xL, xH, yL, yH]), Buffer.from(bandBits)]);
}

/**
 * Turns a rasterized bitmap into the exact bytes to send RAW to the spooler:
 * init, the ink plus a blank bottom pad split into bands, then a partial cut.
 * A blank slip (rows === 0) is refused -- never send a cut with nothing printed.
 */
export function escposJob(raster: RasterBitmap): Buffer {
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

  const bands: Buffer[] = [];
  for (let rowStart = 0; rowStart < totalRows; rowStart += RASTER_BAND_ROWS) {
    const bandRows = Math.min(RASTER_BAND_ROWS, totalRows - rowStart);
    const byteStart = rowStart * raster.rowBytes;
    const byteEnd = byteStart + bandRows * raster.rowBytes;
    bands.push(buildRasterBand(raster.rowBytes, bandRows, padded.subarray(byteStart, byteEnd)));
  }

  return Buffer.concat([ESC_INIT, ...bands, CUT_PARTIAL_WITH_FEED]);
}

/** A short human label for the field log, e.g. "576x1321 dots (~165mm)". */
export function rasterLabel(raster: RasterBitmap): string {
  const mm = Math.round((raster.rows / DOTS_PER_INCH) * 25.4);
  return `${raster.dots}x${raster.rows} dots (~${mm}mm)`;
}
