// The Floor's areas as pure functions (U3 Task 2, 2026-10-28; design 6.3 / 6.4, values 2.3 / 3.1 / 5.1): the area tabs,
// the area the page shows, the tiles in it and the sections it draws. Split from lib/floor-tiles.ts by ruling F1 (each
// file stays within 300 lines). Grouping is lib/table-areas.ts's groupByArea, the same as every screen that groups
// tables; nothing here fetches. lib/floor-areas.test.ts pins every rule.
import { filterTiles, type FloorFilter, type FloorTileModel } from "@/lib/floor-tiles";
import { groupByArea, showAreaHeadings, tableAreaIdOf, tableCountText, type AreaGroup } from "@/lib/table-areas";
import type { Area } from "@/types";

/** The "All" tab's key: never an Area._id (ObjectId hex) nor the no-area key ("none"). */
export const FLOOR_ALL_AREAS = "all";

export interface FloorAreaTab {
  /** FLOOR_ALL_AREAS, an Area._id, or the trailing "Other tables" key. */
  key: string;
  name: string;
}

export interface FloorSection {
  /** An Area._id, or the trailing "Other tables" key. */
  key: string;
  name: string;
  /** The HTML's count of the tiles shown: "1 table", "4 tables" (values 3.1). */
  summary: string;
  /** The area's tiles that pass the filter (never empty). */
  tiles: FloorTileModel[];
}

export interface FloorSections {
  /** Headings show only once a table sits in a KNOWN area - judged BEFORE the area and the filter. */
  showHeadings: boolean;
  groups: FloorSection[];
}

/** Every tile under its area, in the server's area order, "Other tables" last (empty groups dropped). */
function groupTiles(tiles: readonly FloorTileModel[], areas: readonly Area[] | undefined): AreaGroup<FloorTileModel>[] {
  return groupByArea(tiles, (tile) => tableAreaIdOf(tile.table), areas);
}

/**
 * The area tabs (values 2.3): "All", then one tab per group of every tile (only areas that hold a table, the server's
 * order, "Other tables" last). None unless there are two or more groups: a cafe with one area or none has no tabs, and
 * before the areas load every table reads as "Other tables" (design 6.3).
 */
export function floorAreaTabs(tiles: readonly FloorTileModel[], areas: readonly Area[] | undefined): FloorAreaTab[] {
  const groups = groupTiles(tiles, areas);
  if (groups.length < 2) return [];
  return [{ key: FLOOR_ALL_AREAS, name: "All" }, ...groups.map((g) => ({ key: g.key, name: g.name }))];
}

/** The area the page shows: the choice while a tab still has it, else All — a refresh, the area heal or another device
 *  that empties or removes it, or tabs that hide, never leave a stuck filter (Review Focus 1; nothing is stored). */
export function effectiveArea(chosen: string, tabs: readonly FloorAreaTab[]): string {
  return tabs.some((t) => t.key === chosen) ? chosen : FLOOR_ALL_AREAS;
}

/** The tiles of one area (every tile for All), in table order: what the pills count (design 6.3). */
export function tilesInArea(tiles: readonly FloorTileModel[], areas: readonly Area[] | undefined, area: string): FloorTileModel[] {
  if (area === FLOOR_ALL_AREAS) return [...tiles];
  return groupTiles(tiles, areas).find((g) => g.key === area)?.items ?? [];
}

/**
 * The tiles under their area headings. ALL tiles are grouped first (so headings do not appear or vanish as a tab or a
 * pill is pressed), then only the chosen area is kept (every area for All), then the status filter runs inside it; a
 * group with no tile left is dropped (values 3.1, 5.1). With no areas the result is one group holding exactly
 * filterTiles(tiles, filter) - today's flat list.
 */
export function floorSections(
  tiles: readonly FloorTileModel[],
  areas: readonly Area[] | undefined,
  filter: FloorFilter,
  area: string,
): FloorSections {
  const all = groupTiles(tiles, areas);
  const groups: FloorSection[] = [];
  for (const group of all) {
    if (area !== FLOOR_ALL_AREAS && group.key !== area) continue;
    const shown = filterTiles(group.items, filter);
    if (shown.length === 0) continue;
    groups.push({ key: group.key, name: group.name, summary: tableCountText(shown.length), tiles: shown });
  }
  return { showHeadings: showAreaHeadings(all), groups };
}
