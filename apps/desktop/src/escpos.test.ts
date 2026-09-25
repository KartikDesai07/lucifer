// Pins for src/escpos.ts -- pure module (no electron, no node:fs, no printer).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOTS_PER_INCH,
  DOTS_80MM,
  DOTS_58MM,
  WIDE_PAPER_MIN_MICRONS,
  RASTER_THRESHOLD,
  RASTER_BAND_ROWS,
  RASTER_BOTTOM_PAD_ROWS,
  RASTER_MAX_ROWS,
  dotsForPaperWidth,
  rasterizeBgra,
  escposJob,
  rasterLabel,
  type RasterBitmap,
} from "./escpos";

// --- dotsForPaperWidth ------------------------------------------------------

for (const [input, expected] of [
  [80_000, DOTS_80MM],
  [58_000, DOTS_58MM],
  [null, DOTS_80MM],
  [69_999, DOTS_58MM],
  [70_000, DOTS_80MM],
  [NaN, DOTS_80MM],
] as const) {
  test(`dotsForPaperWidth(${input}) -> ${expected}`, () => {
    assert.equal(dotsForPaperWidth(input), expected);
  });
}

test("WIDE_PAPER_MIN_MICRONS landmark", () => {
  assert.equal(WIDE_PAPER_MIN_MICRONS, 70_000);
});

// --- pixel helpers for building BGRA fixtures ------------------------------

function solidRowBgra(width: number, blackAt: (x: number) => boolean): Uint8Array {
  const row = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) {
    const offset = x * 4;
    if (blackAt(x)) {
      row[offset] = 0; // B
      row[offset + 1] = 0; // G
      row[offset + 2] = 0; // R
      row[offset + 3] = 255; // A
    } else {
      row[offset] = 255;
      row[offset + 1] = 255;
      row[offset + 2] = 255;
      row[offset + 3] = 255;
    }
  }
  return row;
}

function concatRows(rows: Uint8Array[]): Uint8Array {
  const total = rows.reduce((sum, r) => sum + r.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const row of rows) {
    out.set(row, offset);
    offset += row.length;
  }
  return out;
}

// --- rasterizeBgra golden ----------------------------------------------------

test("rasterizeBgra golden: 16x3, row0 black, row1 alternating, row2 white -> trims trailing white", () => {
  const width = 16;
  const row0 = solidRowBgra(width, () => true);
  const row1 = solidRowBgra(width, (x) => x % 2 === 0);
  const row2 = solidRowBgra(width, () => false);
  const pixels = concatRows([row0, row1, row2]);

  const raster = rasterizeBgra(pixels, width, 3, 16);

  assert.equal(raster.rows, 2);
  assert.equal(raster.rowBytes, 2);
  assert.deepEqual(Array.from(raster.bits), [0xff, 0xff, 0xaa, 0xaa]);
});

test("rasterizeBgra: MSB-first -- black pixel at x=0 -> byte0 0x80", () => {
  const width = 16;
  const row = solidRowBgra(width, (x) => x === 0);
  const raster = rasterizeBgra(row, width, 1, 16);
  assert.equal(raster.bits[0], 0x80);
  assert.equal(raster.bits[1], 0x00);
});

test("rasterizeBgra: MSB-first -- black pixel at x=7 -> byte0 0x01", () => {
  const width = 16;
  const row = solidRowBgra(width, (x) => x === 7);
  const raster = rasterizeBgra(row, width, 1, 16);
  assert.equal(raster.bits[0], 0x01);
  assert.equal(raster.bits[1], 0x00);
});

test("rasterizeBgra: MSB-first -- black pixel at x=8 -> byte1 0x80", () => {
  const width = 16;
  const row = solidRowBgra(width, (x) => x === 8);
  const raster = rasterizeBgra(row, width, 1, 16);
  assert.equal(raster.bits[0], 0x00);
  assert.equal(raster.bits[1], 0x80);
});

// --- threshold ---------------------------------------------------------------

function pixelBgra(b: number, g: number, r: number, a: number): Uint8Array {
  return new Uint8Array([b, g, r, a]);
}

test("threshold: gray 127 (B=G=R=127) is black", () => {
  const raster = rasterizeBgra(pixelBgra(127, 127, 127, 255), 1, 1, 8);
  assert.equal(raster.rows, 1);
  assert.equal(raster.bits[0], 0x80);
});

test("threshold: gray 128 (B=G=R=128) is white", () => {
  const raster = rasterizeBgra(pixelBgra(128, 128, 128, 255), 1, 1, 8);
  assert.equal(raster.rows, 0);
  assert.equal(raster.bits.length, 0);
});

test("threshold: pure red (R=255,G=0,B=0 -> L=76) is black", () => {
  const raster = rasterizeBgra(pixelBgra(0, 0, 255, 255), 1, 1, 8);
  assert.equal(raster.rows, 1);
  assert.equal(raster.bits[0], 0x80);
});

test("threshold: alpha 0 with RGB 0 (would-be black) is treated as white", () => {
  const raster = rasterizeBgra(pixelBgra(0, 0, 0, 0), 1, 1, 8);
  assert.equal(raster.rows, 0);
  assert.equal(raster.bits.length, 0);
});

test("RASTER_THRESHOLD landmark matches the boundary used above", () => {
  assert.equal(RASTER_THRESHOLD, 128);
});

// --- crop / pad ---------------------------------------------------------------

test("crop: width 20 with dots 16 keeps the leftmost 16 columns", () => {
  // Black only at x=19 (outside the kept 16 columns) -> nothing survives.
  const row = solidRowBgra(20, (x) => x === 19);
  const raster = rasterizeBgra(row, 20, 1, 16);
  assert.equal(raster.rows, 0);
});

test("crop: width 20 with dots 16 -- a black pixel inside the kept range still renders", () => {
  const row = solidRowBgra(20, (x) => x === 15);
  const raster = rasterizeBgra(row, 20, 1, 16);
  assert.equal(raster.rows, 1);
  assert.equal(raster.bits[1], 0x01); // x=15 -> byte1 bit0
});

test("pad: width 12 with dots 16 pads white on the right (columns 12..15 are 0)", () => {
  const row = solidRowBgra(12, () => true); // all-black source row
  const raster = rasterizeBgra(row, 12, 1, 16);
  assert.equal(raster.rowBytes, 2);
  // columns 0..11 black -> byte0 = 0xFF, byte1 top 4 bits (cols 8-11) set = 0xF0,
  // columns 12..15 (bits 3..0 of byte1) must be 0.
  assert.equal(raster.bits[0], 0xff);
  assert.equal(raster.bits[1], 0xf0);
});

// --- trimming ------------------------------------------------------------------

test("trimming: trailing white rows removed, leading white rows KEPT", () => {
  const white = solidRowBgra(8, () => false);
  const black = solidRowBgra(8, () => true);
  const pixels = concatRows([white, black]);
  const raster = rasterizeBgra(pixels, 8, 2, 8);
  assert.equal(raster.rows, 2);
  assert.equal(raster.bits[0], 0x00); // leading white row kept, all zero
  assert.equal(raster.bits[1], 0xff);
});

test("trimming: all-white image -> rows === 0 and bits.length === 0", () => {
  const pixels = concatRows([solidRowBgra(8, () => false), solidRowBgra(8, () => false)]);
  const raster = rasterizeBgra(pixels, 8, 2, 8);
  assert.equal(raster.rows, 0);
  assert.equal(raster.bits.length, 0);
});

// --- validation ------------------------------------------------------------------

test("rasterizeBgra: wrong pixels length throws RangeError", () => {
  assert.throws(() => rasterizeBgra(new Uint8Array(3), 1, 1, 8), RangeError);
});

test("rasterizeBgra: dots not a multiple of 8 throws RangeError", () => {
  assert.throws(() => rasterizeBgra(new Uint8Array(4), 1, 1, 10), RangeError);
});

test("rasterizeBgra: zero width throws RangeError", () => {
  assert.throws(() => rasterizeBgra(new Uint8Array(0), 0, 1, 8), RangeError);
});

test("rasterizeBgra: non-integer height throws RangeError", () => {
  assert.throws(() => rasterizeBgra(new Uint8Array(4), 1, 1.5, 8), RangeError);
});

// --- escposJob golden --------------------------------------------------------

const ESC_INIT_BYTES = [0x1b, 0x40];
const GS_RASTER_PREFIX = [0x1d, 0x76, 0x30, 0x00];
const CUT_BYTES = [0x1d, 0x56, 0x42, 0x00];

function makeRaster(rowBytes: number, rows: number, bits: number[]): RasterBitmap {
  return { dots: rowBytes * 8, rows, rowBytes, bits: new Uint8Array(bits) };
}

test("escposJob golden: 1-row 8-dot raster produces the exact byte sequence", () => {
  const raster = makeRaster(1, 1, [0x80]);
  const job = escposJob(raster);

  const expectedData = [0x80, ...new Array<number>(16).fill(0x00)]; // 1 ink row + 16 pad rows
  const expected = Buffer.from([
    ...ESC_INIT_BYTES,
    ...GS_RASTER_PREFIX,
    0x01,
    0x00, // xL, xH (rowBytes = 1)
    0x11,
    0x00, // yL, yH (1 + 16 = 17 rows)
    ...expectedData,
    ...CUT_BYTES,
  ]);

  assert.deepEqual(job, expected);
  assert.equal(job.length, 2 + 4 + 4 + 17 + 4);
});

test("escposJob: rows === 0 throws RangeError", () => {
  const raster = makeRaster(1, 0, []);
  assert.throws(() => escposJob(raster), RangeError);
});

test("escposJob: bits length mismatch throws RangeError", () => {
  const raster = makeRaster(1, 2, [0x80]); // needs 2 bytes, has 1
  assert.throws(() => escposJob(raster), RangeError);
});

// --- banding -------------------------------------------------------------------

function countRasterHeaders(buf: Buffer): [number, number][] {
  const positions: [number, number][] = [];
  for (let i = 0; i + 8 <= buf.length; i++) {
    if (
      buf[i] === GS_RASTER_PREFIX[0] &&
      buf[i + 1] === GS_RASTER_PREFIX[1] &&
      buf[i + 2] === GS_RASTER_PREFIX[2] &&
      buf[i + 3] === GS_RASTER_PREFIX[3]
    ) {
      const yL = buf[i + 6] as number;
      const yH = buf[i + 7] as number;
      positions.push([yL, yH]);
    }
  }
  return positions;
}

test("banding: RASTER_BAND_ROWS + 1 rows produces two bands with the expected row counts", () => {
  const rows = RASTER_BAND_ROWS + 1;
  const rowBytes = 1;
  const bits = new Uint8Array(rowBytes * rows); // all-zero data is fine; we only inspect headers
  const raster = makeRaster(rowBytes, rows, Array.from(bits));
  const job = escposJob(raster);

  const headers = countRasterHeaders(job);
  assert.equal(headers.length, 2);
  assert.deepEqual(headers[0], [RASTER_BAND_ROWS & 0xff, (RASTER_BAND_ROWS >> 8) & 0xff]);
  const secondBandRows = rows + RASTER_BOTTOM_PAD_ROWS - RASTER_BAND_ROWS;
  assert.deepEqual(headers[1], [secondBandRows & 0xff, (secondBandRows >> 8) & 0xff]);
});

test("banding: 600 rows at 576 dots splits into 256/256/104 and totals rows+pad", () => {
  const rows = 600;
  const dots = 576;
  const rowBytes = dots / 8;
  const bits = new Uint8Array(rowBytes * rows);
  const raster = makeRaster(rowBytes, rows, Array.from(bits));
  const job = escposJob(raster);

  const headers = countRasterHeaders(job);
  const bandRowCounts = headers.map(([yL, yH]) => yL + (yH << 8));
  assert.deepEqual(bandRowCounts, [256, 256, 104]);
  const total = bandRowCounts.reduce((sum, n) => sum + n, 0);
  assert.equal(total, rows + RASTER_BOTTOM_PAD_ROWS);
});

// --- rasterLabel -----------------------------------------------------------

test('rasterLabel(576x1321) === "576x1321 dots (~165mm)"', () => {
  const raster = makeRaster(72, 1321, []);
  // bits content is irrelevant to the label; bypass validation by not calling escposJob.
  assert.equal(rasterLabel(raster), "576x1321 dots (~165mm)");
});

// --- constants sanity --------------------------------------------------------

test("constants sanity", () => {
  assert.ok(RASTER_BAND_ROWS <= 65535);
  assert.ok(RASTER_BOTTOM_PAD_ROWS < RASTER_BAND_ROWS);
  assert.equal(DOTS_80MM % 8, 0);
  assert.equal(DOTS_58MM % 8, 0);
  assert.equal(DOTS_PER_INCH, 203);
  assert.ok(RASTER_MAX_ROWS > 0);
});
