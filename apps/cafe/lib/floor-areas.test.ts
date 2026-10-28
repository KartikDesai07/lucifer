// U3 Task 2 (2026-10-28): the Floor's area tabs, the area the page shows and its sections (lib/floor-areas.ts; design
// 6.3 / 6.4, values 2.3 / 3.1 / 5.1). Review Focus 1: a chosen area that drifts away (removed, emptied, the tabs hidden)
// shows All. Review Focus 2: for every area x pill, the pill's count is what the grid shows. The section pins (P26)
// moved here from lib/floor-tiles.test.ts on purpose: the summary is now the HTML's "{n} tables" of the tiles shown
// (design 6.4), and the sections take the chosen area.
import { test } from "node:test";
import assert from "node:assert/strict";

import { FLOOR_ALL_AREAS, effectiveArea, floorAreaTabs, floorSections, tilesInArea } from "@/lib/floor-areas";
import { FLOOR_FILTERS, filterTiles, floorCounts, type FloorFilter, type FloorTileModel } from "@/lib/floor-tiles";
import { area, build, printed, tab, table } from "@/lib/floor-tiles.fixtures";
import { NO_AREA_KEY } from "@/lib/table-areas";

const HALL = area("area-hall", "AC Hall");
const GARDEN = area("area-garden", "Garden");
const UNUSED = area("area-unused", "Rooftop");

// Listed Garden-first so AREA order (the server's), not table order, is what the tests see.
const AREAS = [GARDEN, HALL, UNUSED];
const FLOOR = build(
  [
    table("H-1", "Occupied", { areaId: HALL._id }),
    table("G-1", "Available", { areaId: GARDEN._id }),
    table("H-2", "Available", { areaId: HALL._id }),
    table("G-2", "Available", { areaId: GARDEN._id }),
    table("H-3", "Reserved", { areaId: HALL._id }),
    table("X-1", "Occupied"),
    table("X-2", "Available", { areaId: "area-deleted" }),
  ],
  [],
);
const nosOf = (tiles: readonly FloorTileModel[]) => tiles.map((t) => t.table.tableNo);
const keysOf = (tabs: readonly { key: string }[]) => tabs.map((t) => t.key);

// ── The tabs (design 6.3) ───────────────────────────────────────────────────────────────────────────────────────────

test("floorAreaTabs: All, then one tab per group in the server's order, Other tables last; an area with no table has none", () => {
  const tabs = floorAreaTabs(FLOOR, AREAS);
  assert.deepEqual(tabs.map((t) => t.name), ["All", "Garden", "AC Hall", "Other tables"], "values 2.3 order, Other tables last");
  assert.deepEqual(keysOf(tabs), [FLOOR_ALL_AREAS, GARDEN._id, HALL._id, NO_AREA_KEY], "keys: All, the area ids, the no-area key");
  assert.ok(!keysOf(tabs).includes(UNUSED._id), "Rooftop holds no table: no tab");
  assert.equal(FLOOR_ALL_AREAS, "all", "the All key (no area id or the no-area key can be it)");
});

test("floorAreaTabs: no tabs with one group or none, or before the areas load (design 6.3)", () => {
  const oneArea = build([table("H-1", "Occupied", { areaId: HALL._id }), table("H-2", "Available", { areaId: HALL._id })], []);
  assert.deepEqual(floorAreaTabs(oneArea, AREAS), [], "one named area: no tabs");
  const noArea = build([table("A", "Occupied"), table("B", "Available")], []);
  assert.deepEqual(floorAreaTabs(noArea, AREAS), [], "every table under Other tables: no tabs");
  assert.deepEqual(floorAreaTabs([], AREAS), [], "no tables: no tabs");
  assert.deepEqual(floorAreaTabs(FLOOR, undefined), [], "the areas not loaded: every table reads as Other tables, no tabs");
  assert.deepEqual(floorAreaTabs(FLOOR, []), [], "no areas at all: no tabs");
});

test("effectiveArea (Review Focus 1): the choice while a tab has it; a removed or emptied area, or hidden tabs, give All", () => {
  const tabs = floorAreaTabs(FLOOR, AREAS);
  assert.equal(effectiveArea(GARDEN._id, tabs), GARDEN._id, "a live area stays chosen");
  assert.equal(effectiveArea(NO_AREA_KEY, tabs), NO_AREA_KEY, "Other tables can be chosen like any area");
  assert.equal(effectiveArea(FLOOR_ALL_AREAS, tabs), FLOOR_ALL_AREAS, "All is All");
  // Another device removed Garden: its tables fall under Other tables and its tab goes.
  const removed = floorAreaTabs(FLOOR, [HALL, UNUSED]);
  assert.equal(effectiveArea(GARDEN._id, removed), FLOOR_ALL_AREAS, "a removed area shows All");
  // Garden's tables moved to AC Hall: Garden holds nothing and has no tab.
  const emptied = build([table("H-1", "Occupied", { areaId: HALL._id }), table("G-1", "Available", { areaId: HALL._id }), table("X-1", "Occupied")], []);
  assert.equal(effectiveArea(GARDEN._id, floorAreaTabs(emptied, AREAS)), FLOOR_ALL_AREAS, "an emptied area shows All");
  // The floor dropped below two groups: no tabs, so nothing can be chosen.
  assert.equal(effectiveArea(HALL._id, []), FLOOR_ALL_AREAS, "hidden tabs show All");
  assert.equal(effectiveArea("", tabs), FLOOR_ALL_AREAS, "an unknown key shows All");
});

test("tilesInArea: every tile for All, else that group's tiles in order; an area the floor does not show has none", () => {
  assert.deepEqual(nosOf(tilesInArea(FLOOR, AREAS, FLOOR_ALL_AREAS)), nosOf(FLOOR), "All: every tile, in table order");
  assert.deepEqual(nosOf(tilesInArea(FLOOR, AREAS, HALL._id)), ["H-1", "H-2", "H-3"], "AC Hall's tiles");
  assert.deepEqual(nosOf(tilesInArea(FLOOR, AREAS, NO_AREA_KEY)), ["X-1", "X-2"], "Other tables: no area and a deleted one");
  assert.deepEqual(tilesInArea(FLOOR, AREAS, UNUSED._id), [], "an area holding no table");
});

// ── The sections (design 6.4; P26 moved on purpose) ─────────────────────────────────────────────────────────────────

test("floorSections: groups follow AREA order, unassigned and dangling last under Other tables, '{n} tables' shown", () => {
  const s = floorSections(FLOOR, AREAS, "all", FLOOR_ALL_AREAS);
  assert.equal(s.showHeadings, true, "a table sits in a known area");
  assert.deepEqual(s.groups.map((g) => g.name), ["Garden", "AC Hall", "Other tables"], "area order, Other tables last");
  assert.deepEqual(s.groups.map((g) => nosOf(g.tiles)), [["G-1", "G-2"], ["H-1", "H-2", "H-3"], ["X-1", "X-2"]], "tiles keep table order");
  assert.deepEqual(s.groups.map((g) => g.key), [GARDEN._id, HALL._id, NO_AREA_KEY], "keys");
  assert.deepEqual(s.groups.map((g) => g.summary), ["2 tables", "3 tables", "2 tables"], "values 3.1: the tiles shown");
  const one = floorSections(build([table("A", "Occupied", { areaId: HALL._id })], []), AREAS, "all", FLOOR_ALL_AREAS);
  assert.equal(one.groups[0].summary, "1 table", "singular");
});

test("floorSections: the area, then the filter inside it; the summary counts what is shown", () => {
  const free = floorSections(FLOOR, AREAS, "free", FLOOR_ALL_AREAS);
  assert.deepEqual(free.groups.map((g) => nosOf(g.tiles)), [["G-1", "G-2"], ["H-2"], ["X-2"]], "the filter runs inside every area");
  assert.deepEqual(free.groups.map((g) => g.summary), ["2 tables", "1 table", "1 table"], "the tiles shown, not 'shown of total'");
  const hall = floorSections(FLOOR, AREAS, "all", HALL._id);
  assert.deepEqual(hall.groups.map((g) => g.name), ["AC Hall"], "one area chosen: its section alone");
  const hallFree = floorSections(FLOOR, AREAS, "free", HALL._id);
  assert.deepEqual(hallFree.groups.map((g) => [g.name, nosOf(g.tiles), g.summary]), [["AC Hall", ["H-2"], "1 table"]], "area + pill");
  const other = floorSections(FLOOR, AREAS, "occupied", NO_AREA_KEY);
  assert.deepEqual(other.groups.map((g) => nosOf(g.tiles)), [["X-1"]], "Other tables filters like any area");
});

test("floorSections: an area with nothing to show is dropped, and the headings stay judged before the filters", () => {
  const s = floorSections(FLOOR, AREAS, "reserved", FLOOR_ALL_AREAS);
  assert.deepEqual(s.groups.map((g) => g.name), ["AC Hall"], "Garden and Other tables have no Reserved tile");
  assert.equal(s.showHeadings, true, "headings stay");
  const none = floorSections(FLOOR, AREAS, "reserved", GARDEN._id);
  assert.deepEqual(none.groups, [], "Garden has no Reserved tile: nothing to show");
  assert.equal(none.showHeadings, true, "judged before the area and the filter");
  // Every table in the filter belongs to no area, but the floor still HAS areas: headings stay.
  const skewed = build([table("H-1", "Occupied", { areaId: HALL._id }), table("X-1", "Available")], []);
  const only = floorSections(skewed, AREAS, "free", FLOOR_ALL_AREAS);
  assert.equal(only.showHeadings, true, "judged before the filter");
  assert.deepEqual(only.groups.map((g) => g.name), ["Other tables"], "the one group with a match");
});

test("floorSections: zero areas (or areas nobody uses) is today's flat list, no headings", () => {
  const flat = build([table("A", "Occupied"), table("B", "Available"), table("C", "Available")], []);
  for (const areas of [undefined, [], [UNUSED]]) {
    for (const { key } of FLOOR_FILTERS) {
      const s = floorSections(flat, areas, key, FLOOR_ALL_AREAS);
      assert.equal(s.showHeadings, false, `${key}: no headings without a known area`);
      const expected = filterTiles(flat, key);
      if (expected.length === 0) assert.deepEqual(s.groups, [], `${key}: nothing shown, no group`);
      else assert.deepEqual(s.groups.map((g) => g.tiles), [expected], `${key}: one group holding exactly the filtered list`);
    }
  }
  assert.deepEqual(floorSections([], AREAS, "all", FLOOR_ALL_AREAS), { showHeadings: false, groups: [] }, "no tables");
});

// ── Review Focus 2: counts and filters agree ────────────────────────────────────────────────────────────────────────

const ROOF = area("area-roof", "Rooftop");
const MIXED_AREAS = [HALL, GARDEN, ROOF];
// Three areas + Other tables, every kind the pills sort: K1 printed and not, K2, K5, K7, K8.
const MIXED = build(
  [
    table("H-1", "Occupied", { areaId: HALL._id }), table("H-2", "Occupied", { areaId: HALL._id }),
    table("H-3", "Available", { areaId: HALL._id }), table("G-1", "Occupied", { areaId: GARDEN._id }),
    table("G-2", "Available", { areaId: GARDEN._id }), table("G-3", "Reserved", { areaId: GARDEN._id }),
    table("R-1", "Reserved", { areaId: ROOF._id }), table("R-2", "Occupied", { areaId: ROOF._id }),
    table("X-1", "Occupied"), table("X-2", "Available"), table("X-3", "Occupied", { areaId: "area-gone" }),
  ],
  [printed(tab("H-1", 70)), tab("H-2", 12), tab("H-3", 9), printed(tab("R-2", 30)), tab("X-1", 3), printed(tab("X-2", 40))],
);

test("Review Focus 2: for every area x pill, the pill's count is the number of tiles the grid shows", () => {
  const tabs = floorAreaTabs(MIXED, MIXED_AREAS);
  assert.deepEqual(tabs.map((t) => t.name), ["All", "AC Hall", "Garden", "Rooftop", "Other tables"], "landmark: 3 areas + Other tables");
  for (const { key: chosen, name } of tabs) {
    const shownArea = effectiveArea(chosen, tabs);
    const counts = floorCounts(tilesInArea(MIXED, MIXED_AREAS, shownArea));
    const kinds = FLOOR_FILTERS.filter((f) => f.key !== "all").map((f) => f.key);
    assert.equal(kinds.reduce((sum, k) => sum + counts[k], 0), counts.all, `${name}: every table counts in exactly one pill`);
    for (const { key: filter } of FLOOR_FILTERS) {
      const shown = floorSections(MIXED, MIXED_AREAS, filter, shownArea).groups.flatMap((g) => g.tiles);
      assert.equal(counts[filter], shown.length, `${name} x ${filter}: the pill reads ${counts[filter]}, the grid shows ${shown.length}`);
    }
  }
  const all = floorCounts(MIXED);
  assert.deepEqual(all, { all: 11, free: 3, occupied: 4, billed: 2, reserved: 2 }, "H-1 and R-2 printed; H-3, X-2 (K7) Available");
  const billed = (filter: FloorFilter) => nosOf(floorSections(MIXED, MIXED_AREAS, filter, FLOOR_ALL_AREAS).groups.flatMap((g) => g.tiles));
  assert.deepEqual(billed("billed"), ["H-1", "R-2"], "a printed K1 shows under Bill printed");
  assert.ok(!billed("occupied").includes("H-1"), "…and never under Occupied too");
  assert.ok(billed("free").includes("X-2") && !billed("billed").includes("X-2"), "K7 (a bill on an Available table, printed) is Available");
});
