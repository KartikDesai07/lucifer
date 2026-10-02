import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Cross-app parity: apps/cafe/lib/printer/escpos.ts is a Uint8Array port of
// apps/desktop/src/escpos.ts (+ the slip-width bounds in print-direct.ts). The
// desktop app is outside the npm workspace, so it is read as TEXT, never
// imported. Every pin is mutation-checked below on an in-memory copy.

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
// Read as text with CRLF folded: a checkout with autocrlf must not matter.
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const WEB = "apps/cafe/lib/printer/escpos.ts";
const DESKTOP_ESCPOS = "apps/desktop/src/escpos.ts";
const DESKTOP_DIRECT = "apps/desktop/src/print-direct.ts";
const CAFE_PRINT = "apps/cafe/lib/print.ts";

interface Sources {
  web: string;
  escpos: string;
  direct: string;
  print: string;
}

const load = (): Sources => ({
  web: readSrc(WEB),
  escpos: readSrc(DESKTOP_ESCPOS),
  direct: readSrc(DESKTOP_DIRECT),
  print: readSrc(CAFE_PRINT),
});

// The literal values both sides must hold (a same-value mutation on BOTH
// sides must still fail, so the pin carries the numbers itself).
const ESCPOS_CONSTANTS: Record<string, number> = {
  DOTS_PER_INCH: 203,
  DOTS_80MM: 576,
  DOTS_58MM: 384,
  RASTER_THRESHOLD: 128,
  RASTER_BAND_ROWS: 256,
  RASTER_BOTTOM_PAD_ROWS: 16,
  RASTER_MAX_ROWS: 16_000,
  ALPHA_OPAQUE_MIN: 128,
};
const SLIP_CONSTANTS: Record<string, number> = {
  SLIP_CSS_PX_MIN: 120,
  SLIP_CSS_PX_MAX: 800,
  SLIP_CSS_PX_DEFAULT_80MM: 300,
  SLIP_CSS_PX_DEFAULT_58MM: 210,
};
const BYTE_ARRAYS: Record<string, number[]> = {
  ESC_INIT: [0x1b, 0x40],
  GS_RASTER_HEADER: [0x1d, 0x76, 0x30, 0x00],
  CUT_PARTIAL_WITH_FEED: [0x1d, 0x56, 0x42, 0x00],
};
// Expressions that must appear verbatim (whitespace-normalised) on BOTH sides.
const SHARED_EXPRESSIONS = [
  "Math.round(0.299 * r + 0.587 * g + 0.114 * b)",
  "const bitInByte = 7 - (x & 7);",
  "a >= ALPHA_OPAQUE_MIN && luminance(r, g, b) < RASTER_THRESHOLD",
  "const xL = rowBytes & 0xff;",
  "const xH = (rowBytes >> 8) & 0xff;",
  "const yL = bandRows & 0xff;",
  "const yH = (bandRows >> 8) & 0xff;",
  "const totalRows = raster.rows + RASTER_BOTTOM_PAD_ROWS;",
  "Math.min(RASTER_BAND_ROWS, totalRows - rowStart)",
  "if (Number.isFinite(measured) && measured >= SLIP_CSS_PX_MIN && measured <= SLIP_CSS_PX_MAX) return measured;",
];

const norm = (s: string): string => s.replace(/\s+/g, " ");

function constantOf(src: string, name: string): number | null {
  const m = new RegExp(`^(?:export\\s+)?const\\s+${name}\\s*=\\s*([0-9_]+);`, "m").exec(src);
  return m === null ? null : Number((m[1] as string).replace(/_/g, ""));
}

function bytesOf(src: string, name: string): number[] | null {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(?:Buffer\\.from|new Uint8Array)\\(\\[([^\\]]*)\\]\\)`).exec(src);
  if (m === null) return null;
  return (m[1] as string).split(",").map((t) => Number(t.trim()));
}

/** Every parity violation across the four sources; an empty list is green. */
function parityProblems(s: Sources): string[] {
  const problems: string[] = [];
  const check = (label: string, src: string, table: Record<string, number>): void => {
    for (const [name, expected] of Object.entries(table)) {
      const got = constantOf(src, name);
      if (got !== expected) problems.push(`${label}: ${name} is ${got}, expected ${expected}`);
    }
  };
  check("web escpos.ts", s.web, ESCPOS_CONSTANTS);
  check("desktop escpos.ts", s.escpos, ESCPOS_CONSTANTS);
  check("web escpos.ts", s.web, SLIP_CONSTANTS);
  check("desktop print-direct.ts", s.direct, SLIP_CONSTANTS);
  for (const [name, expected] of Object.entries(BYTE_ARRAYS)) {
    for (const [label, src] of [["web", s.web], ["desktop", s.escpos]] as const) {
      const got = bytesOf(src, name);
      if (got === null || got.join() !== expected.join()) problems.push(`${label}: ${name} is [${got}], expected [${expected}]`);
    }
  }
  for (const expr of SHARED_EXPRESSIONS) {
    const owner = expr.includes("SLIP_CSS_PX") ? [["web", s.web], ["desktop print-direct.ts", s.direct]] : [["web", s.web], ["desktop escpos.ts", s.escpos]];
    for (const [label, src] of owner as Array<[string, string]>) {
      if (!norm(src).includes(norm(expr))) problems.push(`${label}: missing expression ${expr}`);
    }
  }
  // The one INTENTIONAL difference: pixel channel order. Desktop reads BGRA
  // (first byte is blue); the web port reads RGBA (first byte is red).
  if (!norm(s.web).includes("const r = pixels[offset] as number;")) problems.push("web: first channel must be r (RGBA)");
  if (!norm(s.escpos).includes("const b = pixels[offset] as number;")) problems.push("desktop: first channel must be b (BGRA)");
  // The cafe's own paper widths the SLIP_CSS defaults mirror (PAPER_WIDTH_CLASS).
  const w58 = /"58mm":\s*"w-\[(\d+)px\]"/.exec(s.print);
  const w80 = /"80mm":\s*"w-\[(\d+)px\]"/.exec(s.print);
  if (w58 === null || Number(w58[1]) !== SLIP_CONSTANTS.SLIP_CSS_PX_DEFAULT_58MM) problems.push("print.ts: 58mm width != SLIP_CSS_PX_DEFAULT_58MM");
  if (w80 === null || Number(w80[1]) !== SLIP_CONSTANTS.SLIP_CSS_PX_DEFAULT_80MM) problems.push("print.ts: 80mm width != SLIP_CSS_PX_DEFAULT_80MM");
  return problems;
}

test("PARITY: web escpos.ts matches the desktop encoder (constants, command bytes, luminance, MSB-first, bands, slip widths)", () => {
  const sources = load();
  // Vision guard: the scan must have seen real files, not empty strings.
  for (const [label, src] of Object.entries(sources)) assert.ok(src.length > 500, `${label} source loaded`);
  assert.deepEqual(parityProblems(sources), []);
});

// --- mutation self-check: every pin must turn red on an in-memory copy ------

function mutate(s: Sources, key: keyof Sources, from: string, to: string): Sources {
  assert.ok(s[key].includes(from), `mutation target "${from}" exists in ${key}`);
  return { ...s, [key]: s[key].replace(from, to) };
}

const MUTATIONS: Array<[string, keyof Sources, string, string]> = [
  ["desktop band rows 256 -> 255", "escpos", "RASTER_BAND_ROWS = 256", "RASTER_BAND_ROWS = 255"],
  ["web band rows 256 -> 255", "web", "RASTER_BAND_ROWS = 256", "RASTER_BAND_ROWS = 255"],
  ["desktop cut 0x42 -> 0x41", "escpos", "[0x1d, 0x56, 0x42, 0x00]", "[0x1d, 0x56, 0x41, 0x00]"],
  ["web cut 0x42 -> 0x41", "web", "[0x1d, 0x56, 0x42, 0x00]", "[0x1d, 0x56, 0x41, 0x00]"],
  ["web raster header m byte", "web", "[0x1d, 0x76, 0x30, 0x00]", "[0x1d, 0x76, 0x30, 0x01]"],
  ["desktop ESC @ -> ESC A", "escpos", "[0x1b, 0x40]", "[0x1b, 0x41]"],
  ["desktop threshold 128 -> 127", "escpos", "RASTER_THRESHOLD = 128", "RASTER_THRESHOLD = 127"],
  ["web alpha 128 -> 127", "web", "ALPHA_OPAQUE_MIN = 128", "ALPHA_OPAQUE_MIN = 127"],
  ["desktop max rows 16_000 -> 15_000", "escpos", "RASTER_MAX_ROWS = 16_000", "RASTER_MAX_ROWS = 15_000"],
  ["web 80mm dots 576 -> 572", "web", "DOTS_80MM = 576", "DOTS_80MM = 572"],
  ["web luminance coefficients swapped", "web", "0.299 * r + 0.587 * g", "0.587 * r + 0.299 * g"],
  ["desktop luminance coefficient", "escpos", "0.114 * b", "0.144 * b"],
  ["web LSB-first bit order", "web", "7 - (x & 7)", "(x & 7)"],
  ["desktop LSB-first bit order", "escpos", "7 - (x & 7)", "(x & 7)"],
  ["web channel order flipped to BGRA", "web", "const r = pixels[offset] as number;", "const r = pixels[offset + 2] as number;"],
  ["desktop slip default 300 -> 301", "direct", "SLIP_CSS_PX_DEFAULT_80MM = 300", "SLIP_CSS_PX_DEFAULT_80MM = 301"],
  ["web slip default 210 -> 211", "web", "SLIP_CSS_PX_DEFAULT_58MM = 210", "SLIP_CSS_PX_DEFAULT_58MM = 211"],
  ["web slip max 800 -> 900", "web", "SLIP_CSS_PX_MAX = 800", "SLIP_CSS_PX_MAX = 900"],
  ["cafe 80mm class drifts from the default", "print", '"80mm": "w-[300px]"', '"80mm": "w-[320px]"'],
  ["web band header yL dropped", "web", "const yL = bandRows & 0xff;", "const yL = bandRows;"],
  ["desktop bottom pad 16 -> 8", "escpos", "RASTER_BOTTOM_PAD_ROWS = 16", "RASTER_BOTTOM_PAD_ROWS = 8"],
];

for (const [name, key, from, to] of MUTATIONS) {
  test(`MUTATION caught: ${name}`, () => {
    const mutated = mutate(load(), key, from, to);
    assert.notDeepEqual(parityProblems(mutated), [], `${name} must turn the parity check red`);
  });
}

test("MUTATION caught: a constant deleted from either side is reported, not skipped", () => {
  const s = load();
  const noThreshold = { ...s, web: s.web.replace(/^export const RASTER_THRESHOLD.*$/m, "") };
  assert.notEqual(noThreshold.web, s.web);
  assert.ok(parityProblems(noThreshold).some((p) => p.includes("RASTER_THRESHOLD is null")));
});
