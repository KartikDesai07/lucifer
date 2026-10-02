import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALPHA_OPAQUE_MIN,
  CUT_PARTIAL_WITH_FEED,
  DOTS_58MM,
  DOTS_80MM,
  DOTS_PER_INCH,
  ESC_INIT,
  GS_RASTER_HEADER,
  RASTER_BAND_ROWS,
  RASTER_BOTTOM_PAD_ROWS,
  RASTER_MAX_ROWS,
  RASTER_THRESHOLD,
  SLIP_CSS_PX_DEFAULT_58MM,
  SLIP_CSS_PX_DEFAULT_80MM,
  dotsForPaper,
  escposJob,
  rasterizeRgba,
  usableSlipCssWidth,
  type RasterBitmap,
} from "./escpos";

// The desktop encoder's golden vectors (apps/desktop/src/escpos.test.ts)
// re-expressed in RGBA. escpos-parity.test.ts pins the two encoders' source
// equal; this file pins the web encoder's BEHAVIOUR.

function solidRowRgba(width: number, blackAt: (x: number) => boolean): Uint8Array {
  const row = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) {
    const value = blackAt(x) ? 0 : 255;
    row.set([value, value, value, 255], x * 4);
  }
  return row;
}

function concatRows(rows: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(rows.reduce((sum, r) => sum + r.length, 0));
  let offset = 0;
  for (const row of rows) {
    out.set(row, offset);
    offset += row.length;
  }
  return out;
}

function rgba(r: number, g: number, b: number, a: number): Uint8Array {
  return new Uint8Array([r, g, b, a]);
}

function makeRaster(rowBytes: number, rows: number, bits: number[]): RasterBitmap {
  return { dots: rowBytes * 8, rows, rowBytes, bits: new Uint8Array(bits) };
}

test("constants and command bytes", () => {
  assert.deepEqual(
    [DOTS_PER_INCH, DOTS_80MM, DOTS_58MM, RASTER_THRESHOLD, RASTER_BAND_ROWS, RASTER_BOTTOM_PAD_ROWS, RASTER_MAX_ROWS, ALPHA_OPAQUE_MIN],
    [203, 576, 384, 128, 256, 16, 16_000, 128],
  );
  assert.deepEqual(Array.from(ESC_INIT), [0x1b, 0x40]);
  assert.deepEqual(Array.from(GS_RASTER_HEADER), [0x1d, 0x76, 0x30, 0x00]);
  assert.deepEqual(Array.from(CUT_PARTIAL_WITH_FEED), [0x1d, 0x56, 0x42, 0x00]);
});

test("dotsForPaper: 80mm -> 576, 58mm -> 384", () => {
  assert.equal(dotsForPaper("80mm"), DOTS_80MM);
  assert.equal(dotsForPaper("58mm"), DOTS_58MM);
});

test("usableSlipCssWidth: plausible measured width wins, else the paper default", () => {
  assert.equal(usableSlipCssWidth(300, DOTS_80MM), 300);
  assert.equal(usableSlipCssWidth(120, DOTS_80MM), 120);
  assert.equal(usableSlipCssWidth(800, DOTS_80MM), 800);
  for (const bad of [0, 119, 801, 1280, NaN, Infinity]) {
    assert.equal(usableSlipCssWidth(bad, DOTS_80MM), SLIP_CSS_PX_DEFAULT_80MM, `bad ${bad} on 80mm`);
    assert.equal(usableSlipCssWidth(bad, DOTS_58MM), SLIP_CSS_PX_DEFAULT_58MM, `bad ${bad} on 58mm`);
  }
  assert.equal(SLIP_CSS_PX_DEFAULT_80MM, 300);
  assert.equal(SLIP_CSS_PX_DEFAULT_58MM, 210);
});

test("rasterizeRgba golden: 16x3, black / alternating / white -> trailing white trimmed", () => {
  const width = 16;
  const pixels = concatRows([
    solidRowRgba(width, () => true),
    solidRowRgba(width, (x) => x % 2 === 0),
    solidRowRgba(width, () => false),
  ]);
  const raster = rasterizeRgba(pixels, width, 3, 16);
  assert.equal(raster.rows, 2);
  assert.equal(raster.rowBytes, 2);
  assert.deepEqual(Array.from(raster.bits), [0xff, 0xff, 0xaa, 0xaa]);
});

for (const [x, byte0, byte1] of [
  [0, 0x80, 0x00],
  [7, 0x01, 0x00],
  [8, 0x00, 0x80],
] as const) {
  test(`rasterizeRgba: MSB-first -- black pixel at x=${x}`, () => {
    const raster = rasterizeRgba(solidRowRgba(16, (cx) => cx === x), 16, 1, 16);
    assert.equal(raster.bits[0], byte0);
    assert.equal(raster.bits[1], byte1);
  });
}

test("rasterizeRgba: RGBA order -- pure red (255,0,0 -> L=76) is black, pure blue (0,0,255 -> L=29) is black", () => {
  assert.equal(rasterizeRgba(rgba(255, 0, 0, 255), 1, 1, 8).bits[0], 0x80);
  assert.equal(rasterizeRgba(rgba(0, 0, 255, 255), 1, 1, 8).bits[0], 0x80);
  // Pure green is L=150: white. Under a BGRA mix-up the first byte would read as blue.
  assert.equal(rasterizeRgba(rgba(0, 255, 0, 255), 1, 1, 8).rows, 0);
});

test("rasterizeRgba: channel order discriminates RGBA from BGRA (255,120,0 -> L=146 white; read as BGRA it would be L=99 black)", () => {
  assert.equal(rasterizeRgba(rgba(255, 120, 0, 255), 1, 1, 8).rows, 0);
  assert.equal(rasterizeRgba(rgba(0, 120, 255, 255), 1, 1, 8).rows, 1);
});

test("threshold: gray 127 is black, gray 128 is white", () => {
  assert.equal(rasterizeRgba(rgba(127, 127, 127, 255), 1, 1, 8).bits[0], 0x80);
  const white = rasterizeRgba(rgba(128, 128, 128, 255), 1, 1, 8);
  assert.equal(white.rows, 0);
  assert.equal(white.bits.length, 0);
});

test("alpha: 0 and 127 are paper, 128 is ink", () => {
  assert.equal(rasterizeRgba(rgba(0, 0, 0, 0), 1, 1, 8).rows, 0);
  assert.equal(rasterizeRgba(rgba(0, 0, 0, ALPHA_OPAQUE_MIN - 1), 1, 1, 8).rows, 0);
  assert.equal(rasterizeRgba(rgba(0, 0, 0, ALPHA_OPAQUE_MIN), 1, 1, 8).rows, 1);
});

test("rasterizeRgba accepts a Uint8ClampedArray (canvas ImageData) identically", () => {
  const row = solidRowRgba(8, (x) => x === 3);
  const fromClamped = rasterizeRgba(new Uint8ClampedArray(row), 8, 1, 8);
  assert.deepEqual(Array.from(fromClamped.bits), Array.from(rasterizeRgba(row, 8, 1, 8).bits));
  assert.equal(fromClamped.bits[0], 0x10);
});

test("crop: width 20 on 16 dots keeps the leftmost 16 columns", () => {
  assert.equal(rasterizeRgba(solidRowRgba(20, (x) => x === 19), 20, 1, 16).rows, 0);
  const kept = rasterizeRgba(solidRowRgba(20, (x) => x === 15), 20, 1, 16);
  assert.equal(kept.rows, 1);
  assert.equal(kept.bits[1], 0x01);
});

test("pad: width 12 on 16 dots pads white on the right", () => {
  const raster = rasterizeRgba(solidRowRgba(12, () => true), 12, 1, 16);
  assert.equal(raster.rowBytes, 2);
  assert.equal(raster.bits[0], 0xff);
  assert.equal(raster.bits[1], 0xf0);
});

test("trimming: trailing white rows removed, leading white rows kept, all-white -> 0 rows", () => {
  const white = solidRowRgba(8, () => false);
  const black = solidRowRgba(8, () => true);
  const kept = rasterizeRgba(concatRows([white, black]), 8, 2, 8);
  assert.equal(kept.rows, 2);
  assert.deepEqual(Array.from(kept.bits), [0x00, 0xff]);
  const blank = rasterizeRgba(concatRows([white, white]), 8, 2, 8);
  assert.equal(blank.rows, 0);
  assert.equal(blank.bits.length, 0);
});

test("rasterizeRgba validation: RangeError on bad length, dots, width, height", () => {
  assert.throws(() => rasterizeRgba(new Uint8Array(3), 1, 1, 8), RangeError);
  assert.throws(() => rasterizeRgba(new Uint8Array(4), 1, 1, 10), RangeError);
  assert.throws(() => rasterizeRgba(new Uint8Array(0), 0, 1, 8), RangeError);
  assert.throws(() => rasterizeRgba(new Uint8Array(4), 1, 1.5, 8), RangeError);
  assert.throws(() => rasterizeRgba(new Uint8Array(4), 1, 1, 0), RangeError);
});

test("escposJob golden: 1-row 8-dot raster is the exact byte sequence", () => {
  const job = escposJob(makeRaster(1, 1, [0x80]));
  const expected = [
    0x1b, 0x40, // ESC @
    0x1d, 0x76, 0x30, 0x00, // GS v 0 m
    0x01, 0x00, // xL xH: rowBytes 1
    0x11, 0x00, // yL yH: 1 ink + 16 pad rows
    0x80, ...new Array<number>(16).fill(0x00),
    0x1d, 0x56, 0x42, 0x00, // GS V 66 0
  ];
  assert.ok(job instanceof Uint8Array);
  assert.deepEqual(Array.from(job), expected);
  assert.equal(job.length, 2 + 4 + 4 + 17 + 4);
});

test("escposJob: rows 0 and a bits/rows mismatch throw RangeError", () => {
  assert.throws(() => escposJob(makeRaster(1, 0, [])), RangeError);
  assert.throws(() => escposJob(makeRaster(1, 2, [0x80])), RangeError);
});

/** Walks the job band by band, returning each band's [rowBytes, rows] and checking the framing. */
function bandsOf(job: Uint8Array): Array<[number, number]> {
  assert.deepEqual(Array.from(job.subarray(0, 2)), [0x1b, 0x40], "job starts with ESC @");
  assert.deepEqual(Array.from(job.subarray(job.length - 4)), [0x1d, 0x56, 0x42, 0x00], "job ends with the cut");
  const bands: Array<[number, number]> = [];
  let i = 2;
  while (i < job.length - 4) {
    assert.deepEqual(Array.from(job.subarray(i, i + 4)), [0x1d, 0x76, 0x30, 0x00], `band header at ${i}`);
    const rowBytes = (job[i + 4] as number) + ((job[i + 5] as number) << 8);
    const rows = (job[i + 6] as number) + ((job[i + 7] as number) << 8);
    bands.push([rowBytes, rows]);
    i += 8 + rowBytes * rows;
  }
  assert.equal(i, job.length - 4, "bands tile the job exactly");
  return bands;
}

test("banding: 257 rows split into 256 + 17 (ink + pad), tiling the job exactly", () => {
  const rows = RASTER_BAND_ROWS + 1;
  const bands = bandsOf(escposJob(makeRaster(1, rows, new Array<number>(rows).fill(0))));
  assert.deepEqual(bands, [[1, 256], [1, 17]]);
});

test("banding: 600 rows at 576 dots split 256/256/104 and total rows + pad", () => {
  const rowBytes = DOTS_80MM / 8;
  const bands = bandsOf(escposJob(makeRaster(rowBytes, 600, new Array<number>(rowBytes * 600).fill(0))));
  assert.deepEqual(bands, [[72, 256], [72, 256], [72, 104]]);
  assert.equal(bands.reduce((sum, [, n]) => sum + n, 0), 600 + RASTER_BOTTOM_PAD_ROWS);
});

test("banding: ink bytes survive the split in order", () => {
  const rows = 300;
  const bits = Array.from({ length: rows }, (_, y) => y % 251);
  const job = escposJob(makeRaster(1, rows, bits));
  const first = job.subarray(2 + 8, 2 + 8 + 256);
  assert.deepEqual(Array.from(first), bits.slice(0, 256));
  const secondStart = 2 + 8 + 256 + 8;
  assert.deepEqual(Array.from(job.subarray(secondStart, secondStart + 44)), bits.slice(256));
});

test("constants sanity", () => {
  assert.ok(RASTER_BAND_ROWS <= 65_535);
  assert.ok(RASTER_BOTTOM_PAD_ROWS < RASTER_BAND_ROWS);
  assert.equal(DOTS_80MM % 8, 0);
  assert.equal(DOTS_58MM % 8, 0);
});
