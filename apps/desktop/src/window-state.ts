// Pure window-bounds clamping for the desktop shell's main window. No electron
// imports — safe for node:test.
import type { WindowBounds } from "./store";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW = { width: 1280, height: 800 };
export const MIN_WINDOW = { width: 900, height: 600 };

function centered(workArea: Rect): WindowBounds {
  const width = Math.min(DEFAULT_WINDOW.width, workArea.width);
  const height = Math.min(DEFAULT_WINDOW.height, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function intersects(bounds: WindowBounds, workArea: Rect): boolean {
  return (
    bounds.x < workArea.x + workArea.width &&
    bounds.x + bounds.width > workArea.x &&
    bounds.y < workArea.y + workArea.height &&
    bounds.y + bounds.height > workArea.y
  );
}

export function clampBounds(bounds: WindowBounds | null, workArea: Rect): WindowBounds {
  if (bounds === null) {
    return centered(workArea);
  }

  if (!intersects(bounds, workArea)) {
    return centered(workArea);
  }

  const width = Math.round(Math.min(Math.max(bounds.width, MIN_WINDOW.width), workArea.width));
  const height = Math.round(Math.min(Math.max(bounds.height, MIN_WINDOW.height), workArea.height));

  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  const x = Math.round(Math.min(Math.max(bounds.x, workArea.x), Math.max(maxX, workArea.x)));
  const y = Math.round(Math.min(Math.max(bounds.y, workArea.y), Math.max(maxY, workArea.y)));

  return { x, y, width, height };
}
