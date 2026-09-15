// CB-1d.2 installable POS icons.
//
// Purpose: generates the generic, tenant-free POS icon set that
// lib/pos-install.ts's manifest advertises (pos-192.png, pos-512.png,
// pos-maskable-512.png, apple-touch-icon.png) into apps/cafe/public/icons.
//
// How to run (from apps/cafe): `node scripts/gen-pos-icons.mjs`
//
// Geometry mirrors DEFAULT_PRODUCT_LOGO_SVG in lib/branding-default-logo.ts
// (a 64x64 rounded-rect mark: navy background, white paper, three navy
// bars) so the installed icon matches the product's own built-in mark.
// MARK_COLOR below mirrors MANIFEST_THEME_COLOR ("#0f172a") in
// lib/pos-install.ts.
//
// Dependency-free by design (no sharp/canvas): a small table-based CRC32 +
// a minimal 8-bit RGBA PNG encoder (zlib.deflateSync for IDAT), plus a
// 4x4-supersampled anti-aliased rounded-rect painter.

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// Design constants (mirrors lib/branding-default-logo.ts + lib/pos-install.ts)
// ---------------------------------------------------------------------------
const MARK_COLOR = "#0f172a"; // mirrors MANIFEST_THEME_COLOR in lib/pos-install.ts
const PAPER_COLOR = "#ffffff";
const DESIGN_UNITS = 64;
const SAFE_ZONE_RATIO = 0.8; // maskable icons keep content inside the centre 80%
const SUPERSAMPLE = 4; // 4x4 sub-samples per pixel for anti-aliasing

const ICON_SIZE_SMALL_PX = 192;
const ICON_SIZE_LARGE_PX = 512;
const APPLE_TOUCH_ICON_SIZE_PX = 180;

// Shapes in the 64x64 design space, painted in this order.
const BACKGROUND_RECT = { x: 0, y: 0, w: 64, h: 64, r: 14, color: MARK_COLOR };
const PAPER_RECT = { x: 18, y: 13, w: 28, h: 38, r: 3, color: PAPER_COLOR };
const BAR_RECTS = [
  { x: 23, y: 21, w: 18, h: 3.5, r: 1.75, color: MARK_COLOR },
  { x: 23, y: 30, w: 18, h: 3.5, r: 1.75, color: MARK_COLOR },
  { x: 23, y: 39, w: 11, h: 3.5, r: 1.75, color: MARK_COLOR },
];
const DESIGN_SHAPES = [BACKGROUND_RECT, PAPER_RECT, ...BAR_RECTS];

const OUTPUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// ---------------------------------------------------------------------------
// CRC32 (table-based, local — not zlib.crc32)
// ---------------------------------------------------------------------------
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// PNG encoder: 8-bit RGBA, colour type 6, filter byte 0 per scanline
// ---------------------------------------------------------------------------
function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lengthBuf, typeBytes, data, crcBuf]);
}

function encodePng(width, height, rgbaPixels) {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // colour type 6 = RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace

  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    rgbaPixels.copy(raw, rowStart + 1, y * rowBytes, y * rowBytes + rowBytes);
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdrData),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Anti-aliased rounded-rect painter (4x4 supersampling, signed-distance test)
// ---------------------------------------------------------------------------
function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

// Coverage (0..1) of a rounded rect at a given point, via 4x4 supersampling.
// Rect is given in the SAME coordinate space as the sample point (already
// scaled/offset). Signed-distance test per CLAUDE-provided spec: for a rect
// with half-sizes (hw, hh) and corner radius r, a point p relative to the
// rect's centre is inside when
//   length(max(|p| - (hw - r, hh - r), 0)) - r < 0
function roundedRectCoverage(px, py, rect) {
  const { x, y, w, h, r } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hw = w / 2;
  const hh = h / 2;
  const step = 1 / SUPERSAMPLE;
  const halfStep = step / 2;
  let insideCount = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    const sampleY = py + sy * step + halfStep;
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const sampleX = px + sx * step + halfStep;
      const dx = Math.abs(sampleX - cx) - (hw - r);
      const dy = Math.abs(sampleY - cy) - (hh - r);
      const qx = Math.max(dx, 0);
      const qy = Math.max(dy, 0);
      const outsideDist = Math.sqrt(qx * qx + qy * qy) - r;
      if (outsideDist < 0) insideCount++;
    }
  }
  return insideCount / (SUPERSAMPLE * SUPERSAMPLE);
}

// Composites `rect` (source-over, premultiplied-correct alpha blend) onto
// `pixels` (a Buffer of width*height*4 RGBA bytes), keeping existing alpha
// for fully-uncovered pixels so transparent corners/canvas stay transparent.
function paintRoundedRect(pixels, width, height, rect) {
  const { r, g, b } = hexToRgb(rect.color);
  const minX = Math.max(0, Math.floor(rect.x));
  const maxX = Math.min(width, Math.ceil(rect.x + rect.w));
  const minY = Math.max(0, Math.floor(rect.y));
  const maxY = Math.min(height, Math.ceil(rect.y + rect.h));

  for (let py = minY; py < maxY; py++) {
    for (let px = minX; px < maxX; px++) {
      const coverage = roundedRectCoverage(px, py, rect);
      if (coverage <= 0) continue;
      const idx = (py * width + px) * 4;
      const dstA = pixels[idx + 3] / 255;
      const srcA = coverage;
      const outA = srcA + dstA * (1 - srcA);
      if (outA <= 0) continue;
      // source-over compositing, un-premultiplied storage
      const outR = (r * srcA + pixels[idx] * dstA * (1 - srcA)) / outA;
      const outG = (g * srcA + pixels[idx + 1] * dstA * (1 - srcA)) / outA;
      const outB = (b * srcA + pixels[idx + 2] * dstA * (1 - srcA)) / outA;
      pixels[idx] = Math.round(outR);
      pixels[idx + 1] = Math.round(outG);
      pixels[idx + 2] = Math.round(outB);
      pixels[idx + 3] = Math.round(outA * 255);
    }
  }
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------
// Renders DESIGN_SHAPES onto a `size`x`size` canvas. `scale`/`offset` map
// design-space (0..DESIGN_UNITS) coordinates onto the canvas. When
// `opaqueBackground` is set, the canvas starts fully opaque in that colour
// (maskable + apple-touch variants); otherwise it starts fully transparent.
function renderIcon(size, scale, offset, opaqueBackground) {
  const pixels = Buffer.alloc(size * size * 4, 0);
  if (opaqueBackground) {
    const { r, g, b } = hexToRgb(opaqueBackground);
    for (let i = 0; i < size * size; i++) {
      pixels[i * 4] = r;
      pixels[i * 4 + 1] = g;
      pixels[i * 4 + 2] = b;
      pixels[i * 4 + 3] = 255;
    }
  }
  for (const shape of DESIGN_SHAPES) {
    paintRoundedRect(pixels, size, size, {
      x: shape.x * scale + offset,
      y: shape.y * scale + offset,
      w: shape.w * scale,
      h: shape.h * scale,
      r: shape.r * scale,
      color: shape.color,
    });
  }
  return pixels;
}

function writeIcon(fileName, size, scale, offset, opaqueBackground) {
  const pixels = renderIcon(size, scale, offset, opaqueBackground);
  const png = encodePng(size, size, pixels);
  const outPath = path.join(OUTPUT_DIR, fileName);
  writeFileSync(outPath, png);
  process.stdout.write(`${fileName}: ${size}x${size}, ${png.length} bytes\n`);
}

// ---------------------------------------------------------------------------
// Generate variants
// ---------------------------------------------------------------------------
mkdirSync(OUTPUT_DIR, { recursive: true });

// pos-192 / pos-512 (manifest purpose "any"): transparent canvas, design
// scaled to fill the whole canvas — rounded corners of BACKGROUND_RECT stay
// transparent.
writeIcon("pos-192.png", ICON_SIZE_SMALL_PX, ICON_SIZE_SMALL_PX / DESIGN_UNITS, 0, null);
writeIcon("pos-512.png", ICON_SIZE_LARGE_PX, ICON_SIZE_LARGE_PX / DESIGN_UNITS, 0, null);

// pos-maskable-512 (manifest purpose "maskable"): opaque canvas edge to
// edge, design scaled to the 80% safe zone and centred.
{
  const size = ICON_SIZE_LARGE_PX;
  const scale = (size * SAFE_ZONE_RATIO) / DESIGN_UNITS;
  const offset = size * (1 - SAFE_ZONE_RATIO) / 2;
  writeIcon("pos-maskable-512.png", size, scale, offset, MARK_COLOR);
}

// apple-touch-icon (180x180): opaque canvas, design at full scale (iOS
// applies its own corner mask, so no rounded transparent corners needed).
writeIcon(
  "apple-touch-icon.png",
  APPLE_TOUCH_ICON_SIZE_PX,
  APPLE_TOUCH_ICON_SIZE_PX / DESIGN_UNITS,
  0,
  MARK_COLOR,
);
