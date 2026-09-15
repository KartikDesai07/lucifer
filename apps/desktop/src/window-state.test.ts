// Pins for src/window-state.ts -- pure module, no electron import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampBounds, DEFAULT_WINDOW, MIN_WINDOW, type Rect } from "./window-state";
import type { WindowBounds } from "./store";

const WORK_AREA: Rect = { x: 0, y: 0, width: 1920, height: 1040 };

test("constants: DEFAULT_WINDOW and MIN_WINDOW", () => {
  assert.deepEqual(DEFAULT_WINDOW, { width: 1280, height: 800 });
  assert.deepEqual(MIN_WINDOW, { width: 900, height: 600 });
});

test("null bounds -> centered default window in a 1920x1040 work area", () => {
  const result = clampBounds(null, WORK_AREA);
  assert.deepEqual(result, {
    x: Math.round((1920 - 1280) / 2),
    y: Math.round((1040 - 800) / 2),
    width: 1280,
    height: 800,
  });
});

test("oversize bounds are clamped to the work area", () => {
  const bounds: WindowBounds = { x: 0, y: 0, width: 3000, height: 2000 };
  const result = clampBounds(bounds, WORK_AREA);
  assert.equal(result.width, WORK_AREA.width);
  assert.equal(result.height, WORK_AREA.height);
});

test("sub-minimum bounds are raised to MIN_WINDOW", () => {
  const bounds: WindowBounds = { x: 100, y: 100, width: 400, height: 300 };
  const result = clampBounds(bounds, WORK_AREA);
  assert.equal(result.width, MIN_WINDOW.width);
  assert.equal(result.height, MIN_WINDOW.height);
});

test("fully off-screen bounds -> centered default", () => {
  const bounds: WindowBounds = { x: 5000, y: 5000, width: 800, height: 600 };
  const result = clampBounds(bounds, WORK_AREA);
  assert.deepEqual(result, {
    x: Math.round((1920 - 1280) / 2),
    y: Math.round((1040 - 800) / 2),
    width: 1280,
    height: 800,
  });
});

test("partially off-screen bounds are shifted fully inside the work area", () => {
  // Window mostly to the left of the work area but still overlapping it.
  const bounds: WindowBounds = { x: -500, y: 50, width: 800, height: 600 };
  const result = clampBounds(bounds, WORK_AREA);
  assert.ok(result.x >= WORK_AREA.x, `x=${result.x} should be >= ${WORK_AREA.x}`);
  assert.ok(
    result.x + result.width <= WORK_AREA.x + WORK_AREA.width,
    `x+width=${result.x + result.width} should be <= ${WORK_AREA.x + WORK_AREA.width}`,
  );
  assert.ok(result.y >= WORK_AREA.y);
  assert.ok(result.y + result.height <= WORK_AREA.y + WORK_AREA.height);
});

test("partially off-screen on the bottom-right is shifted fully inside", () => {
  const bounds: WindowBounds = { x: 1800, y: 1000, width: 800, height: 600 };
  const result = clampBounds(bounds, WORK_AREA);
  assert.ok(result.x + result.width <= WORK_AREA.x + WORK_AREA.width);
  assert.ok(result.y + result.height <= WORK_AREA.y + WORK_AREA.height);
  assert.ok(result.x >= WORK_AREA.x);
  assert.ok(result.y >= WORK_AREA.y);
});

test("output bounds are always integers", () => {
  const bounds: WindowBounds = { x: 10, y: 10, width: 1000, height: 700 };
  const oddWorkArea: Rect = { x: 0, y: 0, width: 1921, height: 1041 };
  const result = clampBounds(bounds, oddWorkArea);
  for (const key of ["x", "y", "width", "height"] as const) {
    assert.equal(Number.isInteger(result[key]), true, `${key}=${result[key]} should be an integer`);
  }
});

test("valid in-bounds window passes through with clamped-but-unchanged values", () => {
  const bounds: WindowBounds = { x: 100, y: 100, width: 1280, height: 800 };
  const result = clampBounds(bounds, WORK_AREA);
  assert.deepEqual(result, bounds);
});
