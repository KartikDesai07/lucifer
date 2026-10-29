// U3 Task 4 fix round 1 (2026-10-28, ruling F15, logic-3): the Floor tile's rise against the page's cascade clock. The
// page starts one clock on its first render with tiles and reads it once per render; each tile fixes its rise when it
// mounts: its tileDelay step (lib/table-sheet.ts, ruling P52) less the time since the clock started. A tile mounted
// while its rise would still run (the first paint; a remount as the areas land after the tables, the area heal, a table
// changing section) joins it part-way with a negative animation-delay; one mounted after that appears at once (design
// 6.5: no replay). Renders of FloorTile, then the source pins. Split from lib/floor-tile-slot.test.ts (≤ 300 lines each).
// Fix round 2 (re-review M1): a remount can give a table another index (flat grid → sections, the area heal, a table
// changing section), so while the cascade runs the page passes each table's FIRST index (lib/floor-rise.ts riseIndexFor):
// the remounted tile continues at its own point on its own curve.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import { classesOf, expectAll, tagOf } from "./class-tags.fixtures";
import { FLOOR_TILE_RISE_CLASS, FLOOR_TILE_WRAP_CLASS } from "./floor-tile-classes";
import { FLOOR_RISE_WINDOW_MS, riseIndexFor } from "./floor-rise";
import { build, table } from "./floor-tiles.fixtures";
import { FloorTile } from "@/components/tables/FloorTile";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const count = (s: string, needle: string): number => s.split(needle).length - 1;

// K5 (an Available table, a link): the kind does not matter to the rise.
const K5 = build([table("T-5", "Available")], [])[0];
/** The wrapper of a K5 tile at `index` in its section (null: no rise), mounted `elapsedMs` after the page's cascade clock
 *  started. */
const wrapOf = (index: number | null, elapsedMs: number): string =>
  tagOf(
    renderToStaticMarkup(
      createElement(FloorTile, { tile: K5, busy: false, tabsFailed: false, riseIndex: index, riseElapsedMs: elapsedMs, onTap: () => {}, onMenu: () => {} }),
    ),
    "floor-tile-wrap",
  );
/** The rise's delay as written on the wrapper, or null when the wrapper has no rise; the rise class and the style agree. */
const riseOf = (index: number | null, elapsedMs: number): string | null => {
  const wrap = wrapOf(index, elapsedMs);
  const delay = wrap.match(/style="animation-delay:([^;"]*)"/)?.[1] ?? null;
  assert.equal(classesOf(wrap).includes(FLOOR_TILE_RISE_CLASS), delay !== null, `index ${index}, ${elapsedMs}ms in: the rise class with its delay, or neither`);
  return delay;
};

test("FloorTile: mounted as the cascade starts, the wrapper rises at tileDelay's step for its index (20ms, 0.3s cap)", () => {
  for (const [index, delay] of [[0, "0.00s"], [1, "0.02s"], [3, "0.06s"], [14, "0.28s"], [15, "0.30s"], [40, "0.30s"]] as const) {
    assert.equal(riseOf(index, 0), delay, `index ${index}: tileDelay's own ${delay}`);
  }
  // A render takes a moment: under 10ms in (tileDelay's precision) the first paint keeps the same delays.
  assert.equal(riseOf(3, 9.9), "0.06s", "index 3, 9.9ms in: still 0.06s");
  expectAll(wrapOf(0, 0), FLOOR_TILE_WRAP_CLASS.split(" "), "the wrapper keeps its own classes");
});

test("FloorTile: mounted mid-cascade it joins its rise part-way (a negative delay); past its window it appears at once", () => {
  assert.equal(riseOf(3, 200), "-0.14s", "index 3, 200ms in: 140ms into its rise");
  assert.equal(riseOf(15, 700), "-0.40s", "index 15, 700ms in: its last 100ms");
  assert.equal(riseOf(0, 495), "-0.49s", "index 0, 495ms in: its last 10ms");
  for (const [index, elapsedMs] of [[0, 500], [0, 520], [15, 800], [15, 820], [3, 60_000]] as const) {
    assert.equal(riseOf(index, elapsedMs), null, `index ${index}, ${elapsedMs}ms in: its rise is over, no rise and no style`);
  }
  assert.equal(riseOf(null, 0), null, "riseIndex null (past the cascade's window): no rise and no style");
});

test("riseIndexFor: during the cascade the same table keeps the index it first got, whatever its new place", () => {
  const first = new Map<string, number>();
  assert.equal(riseIndexFor(first, "t10", 9, 0), 9, "the first paint, the flat grid: T-10 is 10th, recorded");
  assert.equal(riseIndexFor(first, "t10", 2, 380), 9, "remounted 3rd in its section 380ms in: still its first 9");
  assert.equal(riseIndexFor(first, "t10", 0, 420), 9, "the area heal moves it again: still 9");
  assert.equal(riseIndexFor(first, "t10", 2, FLOOR_RISE_WINDOW_MS - 1), 9, "up to the window's last ms");
  assert.deepEqual([...first], [["t10", 9]], "one entry for the table, its first index");
  // With the clock: the remounted tile takes its own curve's point (200ms in), not its new place's (340ms in).
  assert.equal(riseOf(riseIndexFor(first, "t10", 2, 380), 380), "-0.20s", "T-10 remounted 380ms in continues 200ms into its own rise");
});

test("riseIndexFor: a table first seen mid-cascade (a filter change) records the index it first got", () => {
  const first = new Map<string, number>([["t1", 0]]);
  assert.equal(riseIndexFor(first, "t5", 4, 300), 4, "T-5 first shown 5th, 300ms in: recorded");
  assert.equal(riseIndexFor(first, "t5", 1, 500), 4, "a later remount keeps it");
  assert.equal(riseIndexFor(first, "t1", 3, 500), 0, "another table keeps its own");
  assert.deepEqual([...first], [["t1", 0], ["t5", 4]], "one entry per table");
});

test("riseIndexFor: past the cascade's window (the capped step's rise over) it gives null and the map is cleared", () => {
  assert.equal(FLOOR_RISE_WINDOW_MS, 800, "tileDelay's 0.3s cap + the 0.5s rise");
  assert.equal(riseOf(15, FLOOR_RISE_WINDOW_MS - 10), "-0.49s", "the capped step still rises 10ms before the window ends");
  assert.equal(riseOf(15, FLOOR_RISE_WINDOW_MS), null, "at the window no index rises (the tile's own cut-off agrees)");
  const first = new Map<string, number>([["t1", 0], ["t10", 9]]);
  assert.equal(riseIndexFor(first, "t10", 2, FLOOR_RISE_WINDOW_MS), null, "the first render past the window: no rise");
  assert.equal(first.size, 0, "…and the map is cleared");
  assert.equal(riseIndexFor(first, "t11", 0, 60_000), null, "a table added later, a tab / pill change: no rise, no replay");
  assert.equal(first.size, 0, "nothing is recorded past the window: the map never grows on a long-open page");
});

test("the tile fixes its rise at mount, from tileDelay's seconds (no second copy of the 20ms step or the 0.3s cap)", () => {
  const tile = code("components/tables/FloorTile.tsx");
  assert.equal(count(tile, "useState(() => riseDelayAtMount(riseIndex, riseElapsedMs))"), 1, "fixed at mount: a re-render in the cascade never cuts it");
  assert.ok(tile.includes("tileDelaySeconds(index)") && !/0\.02|0\.3\b/.test(tile), "the step and the cap are tileDelay's");
  assert.ok(code("lib/table-sheet.ts").includes("return `${tileDelaySeconds(index).toFixed(2)}s`;"), "tileDelay's string for the POS sheet unchanged");
});

test("the page keeps one cascade clock, started by the first render with tiles (no first-paint latch), and first indexes", () => {
  const page = code("app/(dashboard)/tables/page.tsx");
  assert.equal(count(page, "const riseStart = useRef<number | null>(null);"), 1, "one clock");
  assert.equal(count(page, "const riseReadAt = performance.now();"), 1, "read once per render");
  assert.equal(count(page, "if (riseStart.current === null && hasTiles) riseStart.current = riseReadAt;"), 1, "lazily started by the first render with tiles");
  assert.equal(count(page, "riseStart.current = "), 1, "set once, never reset or turned off afterwards");
  assert.equal(count(page, "const riseElapsedMs = riseReadAt - (riseStart.current ?? riseReadAt);"), 1, "every tile of one render shares one reading (0 on the first paint)");
  assert.ok(page.indexOf("const riseStart = useRef") < page.indexOf("if (tables.isError && tables.data === undefined)"), "the hook runs before the error branch returns");
  assert.ok(!page.includes("firstPaint") && !page.includes(".current = false"), "logic-3: no first-paint latch effect");
  assert.equal(count(page, "const firstRiseIndex = useRef(new Map<string, number>());"), 1, "M1: one record of each table's first index");
  assert.ok(page.indexOf("const firstRiseIndex = useRef") < page.indexOf("if (tables.isError && tables.data === undefined)"), "…before the error branch");
  assert.ok(
    page.includes("riseIndex={riseIndexFor(firstRiseIndex.current, tile.table._id, index, riseElapsedMs)}") && page.includes("riseElapsedMs={riseElapsedMs}"),
    "every tile gets its table's first index (null past the window) and the reading",
  );
  assert.ok(!page.includes("riseIndex={index}"), "M1: never the index of the render it remounts in");
  assert.ok(page.includes("{visible.map((tile, index) => renderTile(tile, index))}"), "the flat grid's indexes");
  const sections = code("components/tables/FloorAreaSections.tsx");
  assert.ok(sections.includes("{group.tiles.map((tile, index) => renderTile(tile, index))}"), "each section counts from 0 (values 7)");
});
