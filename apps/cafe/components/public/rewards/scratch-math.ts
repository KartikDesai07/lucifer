// CB-7 S4 — the scratch foil's arithmetic, PURE (no DOM, no React). The canvas never reads its own pixels back
// (a pixel read stalls low-end phones and taints on some browsers): it keeps a coarse grid of cells instead and marks
// a cell cleared when the brush has passed over its centre. The cleared fraction is a count of marked cells.

export const SCRATCH_CELL_PX = 16;
export const SCRATCH_REVEAL_FRACTION = 0.5;
export const SCRATCH_SAMPLE_MS = 150;
export const SCRATCH_MAX_DPR = 2;
export const SCRATCH_BRUSH_PX = 22;

export interface Point {
  x: number;
  y: number;
}

export interface CellGrid {
  cols: number;
  rows: number;
  cellPx: number;
  cleared: Uint8Array;
  clearedCount: number;
}

export function makeGrid(widthPx: number, heightPx: number, cellPx: number = SCRATCH_CELL_PX): CellGrid {
  const cols = Math.max(1, Math.ceil(widthPx / cellPx));
  const rows = Math.max(1, Math.ceil(heightPx / cellPx));
  return { cols, rows, cellPx, cleared: new Uint8Array(cols * rows), clearedCount: 0 };
}

// Distance from `p` to the segment a-b (a === b is a point).
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Marks every cell whose centre lies within the brush radius of the stroke from `from` to `to` (`from` null = a
// single touch point). Only the cells in the stroke's bounding box are visited.
export function markStroke(grid: CellGrid, from: Point | null, to: Point, brushPx: number = SCRATCH_BRUSH_PX): void {
  const start = from ?? to;
  const radius = brushPx / 2;
  const { cellPx, cols, rows } = grid;
  const minCol = Math.max(0, Math.floor((Math.min(start.x, to.x) - radius) / cellPx));
  const maxCol = Math.min(cols - 1, Math.floor((Math.max(start.x, to.x) + radius) / cellPx));
  const minRow = Math.max(0, Math.floor((Math.min(start.y, to.y) - radius) / cellPx));
  const maxRow = Math.min(rows - 1, Math.floor((Math.max(start.y, to.y) + radius) / cellPx));
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const index = row * cols + col;
      if (grid.cleared[index] === 1) continue;
      const centre = { x: (col + 0.5) * cellPx, y: (row + 0.5) * cellPx };
      if (distanceToSegment(centre, start, to) <= radius) {
        grid.cleared[index] = 1;
        grid.clearedCount += 1;
      }
    }
  }
}

export function clearedFraction(grid: CellGrid): number {
  return grid.clearedCount / (grid.cols * grid.rows);
}

// A device pixel ratio the canvas may use: at least 1, at most SCRATCH_MAX_DPR (a 3x phone would quadruple the
// canvas memory for no visible gain on a foil).
export function clampDpr(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr < 1) return 1;
  return Math.min(dpr, SCRATCH_MAX_DPR);
}
