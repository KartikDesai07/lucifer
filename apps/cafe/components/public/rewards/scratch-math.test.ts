import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampDpr,
  clearedFraction,
  makeGrid,
  markStroke,
  SCRATCH_BRUSH_PX,
  SCRATCH_CELL_PX,
  SCRATCH_MAX_DPR,
  SCRATCH_REVEAL_FRACTION,
} from "@/components/public/rewards/scratch-math";

const GRID_PX = 160;
const CELL_CENTRE = SCRATCH_CELL_PX / 2;

test("makeGrid: ceil of the size over the cell, never below 1x1, starts empty", () => {
  const grid = makeGrid(288, 288);
  assert.equal(grid.cols, 288 / SCRATCH_CELL_PX);
  assert.equal(grid.rows, 288 / SCRATCH_CELL_PX);
  assert.equal(grid.clearedCount, 0);
  assert.equal(clearedFraction(grid), 0);
  const odd = makeGrid(SCRATCH_CELL_PX + 1, 1);
  assert.deepEqual([odd.cols, odd.rows], [2, 1]);
  const tiny = makeGrid(0, 0);
  assert.deepEqual([tiny.cols, tiny.rows], [1, 1]);
});

test("markStroke: a touch on a cell corner clears nothing, on a cell centre clears it, and a repeat adds nothing", () => {
  const grid = makeGrid(GRID_PX, GRID_PX);
  // The four cells around a corner have centres cell/2*sqrt(2) ~ 11.3px away, outside the 11px brush radius.
  markStroke(grid, null, { x: 5 * SCRATCH_CELL_PX, y: 5 * SCRATCH_CELL_PX });
  assert.equal(grid.clearedCount, 0);
  const centre = { x: 5 * SCRATCH_CELL_PX + CELL_CENTRE, y: 5 * SCRATCH_CELL_PX + CELL_CENTRE };
  markStroke(grid, null, centre);
  assert.ok(grid.clearedCount >= 1);
  const after = grid.clearedCount;
  markStroke(grid, null, centre);
  assert.equal(grid.clearedCount, after, "the same touch again adds nothing");
  assert.equal(
    grid.clearedCount,
    grid.cleared.reduce((sum, v) => sum + v, 0),
    "the running count matches the marks",
  );
});

test("markStroke: a stroke clears the cells along its segment, not the ones far from it", () => {
  const grid = makeGrid(GRID_PX, GRID_PX);
  markStroke(grid, { x: CELL_CENTRE, y: CELL_CENTRE }, { x: GRID_PX - CELL_CENTRE, y: CELL_CENTRE });
  const topRow = Array.from(grid.cleared.slice(0, grid.cols));
  assert.ok(topRow.every((v) => v === 1), "the whole top row is cleared");
  const bottomRow = Array.from(grid.cleared.slice((grid.rows - 1) * grid.cols));
  assert.ok(bottomRow.every((v) => v === 0), "the bottom row is untouched");
});

test("markStroke: points outside the grid are clamped, never throw or index out of range", () => {
  const grid = makeGrid(64, 64);
  markStroke(grid, { x: -500, y: -500 }, { x: -400, y: -400 });
  markStroke(grid, { x: 9000, y: 9000 }, { x: 9100, y: 9100 });
  assert.equal(grid.clearedCount, 0);
  markStroke(grid, { x: -20, y: 32 }, { x: 90, y: 32 });
  assert.ok(grid.clearedCount > 0);
});

test("clearedFraction: rises monotonically, a full sweep reaches 1, half the foil passes the reveal threshold", () => {
  const grid = makeGrid(GRID_PX, GRID_PX);
  let previous = 0;
  for (let y = CELL_CENTRE; y < GRID_PX; y += SCRATCH_BRUSH_PX / 2) {
    markStroke(grid, { x: 0, y }, { x: GRID_PX, y });
    const fraction = clearedFraction(grid);
    assert.ok(fraction >= previous);
    previous = fraction;
  }
  assert.equal(previous, 1);

  const half = makeGrid(GRID_PX, GRID_PX);
  for (let y = CELL_CENTRE; y < GRID_PX / 2; y += SCRATCH_CELL_PX) {
    markStroke(half, { x: 0, y }, { x: GRID_PX, y });
  }
  assert.ok(clearedFraction(half) >= SCRATCH_REVEAL_FRACTION);
  assert.ok(clearedFraction(half) < 1);
});

test("clampDpr: between 1 and the cap, junk becomes 1", () => {
  assert.equal(clampDpr(1), 1);
  assert.equal(clampDpr(1.5), 1.5);
  assert.equal(clampDpr(3), SCRATCH_MAX_DPR);
  assert.equal(clampDpr(0.5), 1);
  assert.equal(clampDpr(Number.NaN), 1);
  assert.equal(clampDpr(Number.POSITIVE_INFINITY), 1);
});
