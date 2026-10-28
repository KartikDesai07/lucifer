// The Floor tiles' rise cascade (U3 Task 4 fix round 2, 2026-10-28; design 6.5, values 7, rulings P52 / F15 / F17): its
// window and each table's first index. The page starts one cascade clock on its first render with tiles; a tile fixes
// its rise when it mounts, from its index and the clock (components/tables/FloorTile.tsx). A remount during the cascade
// can give the same table another index (the flat grid turning into sections as the areas land, the area heal, a table
// changing section), which would move its tile along its curve (re-review M1); so while the cascade runs each table keeps
// the index of the first render it appeared in, and its remounted tile continues at its own point on its own curve.
import { FLOOR_TILE_RISE_SECONDS } from "@/lib/floor-tile-classes";
import { tileDelaySeconds } from "@/lib/table-sheet";

/** The cascade's window in ms: the last rise any tile can have ends here (tileDelay's capped step, then the rise). A tile
 *  mounted later appears at once (design 6.5: no replay). */
export const FLOOR_RISE_WINDOW_MS = Math.round((tileDelaySeconds(Number.POSITIVE_INFINITY) + FLOOR_TILE_RISE_SECONDS) * 1000);

/**
 * The rise index for table `id`, rendered at `index` (its place in its section, after the filters) `elapsedMs` into the
 * cascade: inside the window, the index `first` recorded for it on the first render it appeared in (recorded now if this
 * is that render: a table first shown mid-cascade, by a filter change, keeps the index it first got); past the window,
 * null (no rise) and `first` is cleared, so the record never grows on a long-open page.
 */
export function riseIndexFor(first: Map<string, number>, id: string, index: number, elapsedMs: number): number | null {
  if (elapsedMs >= FLOOR_RISE_WINDOW_MS) {
    first.clear();
    return null;
  }
  const recorded = first.get(id);
  if (recorded !== undefined) return recorded;
  first.set(id, index);
  return index;
}
