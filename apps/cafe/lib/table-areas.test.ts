// Tables B2 Step 0 - lib/table-areas.ts, the pure grouping and picker rules every
// area-aware screen renders from. Real functions, hand-built fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  AREA_NAME_NEEDED_MESSAGE,
  AREA_REMOVED_MESSAGE,
  NEW_AREA_CHOICE,
  NO_AREA_CHOICE,
  NO_AREA_KEY,
  NO_AREA_LABEL,
  areaGroupKeyMap,
  areaInUseMessage,
  areaOrderSignature,
  areaPatchOf,
  areaSummaryText,
  composeAreaOrder,
  groupByArea,
  initialAreaChoice,
  namedAreaCount,
  resolveAreaChoice,
  sameAreaGroup,
  showAreaHeadings,
  tableCountText,
  tablesInArea,
  unknownAreaIdsKey,
} from "@/lib/table-areas";
import { stripComments } from "@/lib/source-pin-utils";
import type { Area, Table } from "@/types";

const STAMP = "2026-09-30T00:00:00.000Z";
const area = (id: string, name: string): Area => ({ _id: id, name, createdAt: STAMP, updatedAt: STAMP });
const tbl = (tableNo: string, areaId?: string): Table => ({
  _id: `id-${tableNo}`,
  tableNo,
  status: "Available",
  capacity: 4,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...(areaId === undefined ? {} : { areaId }),
});

// Server order: Rooftop before Garden although G < R (the operator arranged it).
const ROOFTOP = area("r1", "Rooftop");
const GARDEN = area("g1", "Garden");
const AREAS = [ROOFTOP, GARDEN];
const areaOf = (t: Table) => t.areaId;

// -- groupByArea ------------------------------------------------------------
test("groupByArea: with NO areas the result is one group holding every item in input order (the flat list, unchanged)", () => {
  const tables = [tbl("T3"), tbl("T1"), tbl("T2")];
  for (const areas of [undefined, []] as const) {
    const groups = groupByArea(tables, areaOf, areas);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].key, NO_AREA_KEY);
    assert.equal(groups[0].name, NO_AREA_LABEL);
    assert.deepEqual(groups[0].items.map((t) => t.tableNo), ["T3", "T1", "T2"]);
  }
  assert.deepEqual(groupByArea([], areaOf, AREAS), [], "no items, no groups");
});

test("groupByArea: groups follow the AREA order, not the order tables first appear; items keep input order", () => {
  const tables = [tbl("T1", "g1"), tbl("T2", "r1"), tbl("T3", "g1"), tbl("T4", "r1")];
  const groups = groupByArea(tables, areaOf, AREAS);
  assert.deepEqual(groups.map((g) => g.key), ["r1", "g1"], "Rooftop first although a Garden table came first");
  assert.deepEqual(groups.map((g) => g.name), ["Rooftop", "Garden"]);
  assert.deepEqual(groups[0].items.map((t) => t.tableNo), ["T2", "T4"]);
  assert.deepEqual(groups[1].items.map((t) => t.tableNo), ["T1", "T3"]);
});

test("groupByArea: absent and dangling area ids land LAST under 'Other tables'; empty areas are dropped", () => {
  const tables = [tbl("T1"), tbl("T2", "ghost"), tbl("T3", "g1")];
  const groups = groupByArea(tables, areaOf, AREAS);
  assert.deepEqual(groups.map((g) => g.key), ["g1", NO_AREA_KEY], "Rooftop has no tables so it is dropped");
  assert.deepEqual(groups[1].items.map((t) => t.tableNo), ["T1", "T2"]);
  assert.equal(groups[1].name, "Other tables");
});

test("groupByArea is generic over the item: a picker row type works the same", () => {
  const rows = [{ no: "A", area: "g1" }, { no: "B", area: undefined }];
  const groups = groupByArea(rows, (r) => r.area, AREAS);
  assert.deepEqual(groups.map((g) => g.items.map((r) => r.no)), [["A"], ["B"]]);
});

// -- headings ---------------------------------------------------------------
test("showAreaHeadings: false with zero areas, false with unused or dangling areas, true once a table sits in a KNOWN area", () => {
  assert.equal(showAreaHeadings(groupByArea([tbl("T1")], areaOf, [])), false);
  assert.equal(showAreaHeadings(groupByArea([tbl("T1")], areaOf, AREAS)), false, "areas exist but none is used");
  assert.equal(showAreaHeadings(groupByArea([tbl("T1", "ghost")], areaOf, AREAS)), false, "a dangling id is not a known area");
  assert.equal(showAreaHeadings(groupByArea([tbl("T1", "g1"), tbl("T2")], areaOf, AREAS)), true);
});

test("namedAreaCount counts the named groups shown and never 'Other tables'", () => {
  const groups = groupByArea([tbl("T1", "g1"), tbl("T2", "r1"), tbl("T3")], areaOf, AREAS);
  assert.equal(groups.length, 3);
  assert.equal(namedAreaCount(groups), 2);
  assert.equal(namedAreaCount(groupByArea([tbl("T1")], areaOf, AREAS)), 0);
});

// -- Setup arrange helpers --------------------------------------------------
test("composeAreaOrder: zero areas is exactly tables.map(tableNo); with areas it is the area-contiguous flat list", () => {
  const tables = [tbl("T3"), tbl("T1", "g1"), tbl("T2", "r1"), tbl("T4", "g1")];
  assert.deepEqual(composeAreaOrder(tables, []), tables.map((t) => t.tableNo));
  assert.deepEqual(composeAreaOrder(tables, undefined), tables.map((t) => t.tableNo));
  assert.deepEqual(composeAreaOrder(tables, AREAS), ["T2", "T1", "T4", "T3"]);
  assert.deepEqual(
    composeAreaOrder(tables, AREAS),
    groupByArea(tables, areaOf, AREAS).flatMap((g) => g.items.map((t) => t.tableNo)),
    "compose is the flatMap of the groups",
  );
});

test("areaOrderSignature changes on a membership-only move even though the flat order does not", () => {
  const before = [tbl("T1", "r1"), tbl("T2")];
  const after = [tbl("T1", "r1"), tbl("T2", "r1")];
  assert.deepEqual(composeAreaOrder(before, AREAS), composeAreaOrder(after, AREAS), "precondition: same flat order");
  assert.notEqual(areaOrderSignature(before, AREAS), areaOrderSignature(after, AREAS));
  assert.equal(areaOrderSignature(before, AREAS), areaOrderSignature([...before], AREAS), "stable for equal input");
});

test("areaGroupKeyMap + sameAreaGroup: same group true, different group false, unknown table false", () => {
  const keys = areaGroupKeyMap([tbl("T1", "g1"), tbl("T2", "g1"), tbl("T3", "r1"), tbl("T4")], AREAS);
  assert.equal(sameAreaGroup(keys, "T1", "T2"), true);
  assert.equal(sameAreaGroup(keys, "T1", "T3"), false);
  assert.equal(sameAreaGroup(keys, "T4", "T4"), true);
  assert.equal(sameAreaGroup(keys, "T1", "nope"), false);
  assert.equal(sameAreaGroup(keys, "nope", "nope"), false, "two unknown tables are not 'the same group'");
});

// -- heal key ---------------------------------------------------------------
test("unknownAreaIdsKey: '' while areas are unloaded and when every id is known; else the sorted unique unknown ids", () => {
  const tables = [tbl("T1", "zz"), tbl("T2", "g1"), tbl("T3", "aa"), tbl("T4", "zz"), tbl("T5")];
  assert.equal(unknownAreaIdsKey(tables, undefined), "", "nothing can be unknown before the list loads");
  assert.equal(unknownAreaIdsKey([tbl("T2", "g1"), tbl("T5")], AREAS), "");
  assert.equal(unknownAreaIdsKey(tables, AREAS), "aa,zz");
  assert.equal(unknownAreaIdsKey(tables, []), "aa,g1,zz", "with an empty list every referenced id is unknown");
});

// -- copy -------------------------------------------------------------------
test("tablesInArea, tableCountText and areaSummaryText", () => {
  const tables = [tbl("T1", "g1"), tbl("T2", "r1"), tbl("T3", "g1")];
  assert.deepEqual(tablesInArea(tables, "g1").map((t) => t.tableNo), ["T1", "T3"]);
  assert.deepEqual(tablesInArea(tables, "ghost"), []);
  assert.equal(tableCountText(1), "1 table");
  assert.equal(tableCountText(0), "0 tables");
  assert.equal(tableCountText(4), "4 tables");
  assert.equal(areaSummaryText(4, 2), "4 tables · 2 occupied");
  assert.equal(areaSummaryText(1, 0), "1 table · 0 occupied");
});

test("areaInUseMessage: exact singular and plural copy", () => {
  assert.equal(areaInUseMessage(1), "This area still has 1 table. Move it to another area first.");
  assert.equal(areaInUseMessage(2), "This area still has 2 tables. Move them to another area first.");
});

// -- the area picker --------------------------------------------------------
test("initialAreaChoice: the table's own area id (even one the list does not hold), else 'none'", () => {
  assert.equal(initialAreaChoice(tbl("T1", "g1")), "g1");
  assert.equal(initialAreaChoice(tbl("T1", "ghost")), "ghost", "dangling detection happens at submit, not here");
  assert.equal(initialAreaChoice(tbl("T1")), NO_AREA_CHOICE);
  assert.equal(initialAreaChoice(undefined), NO_AREA_CHOICE);
});

test("the two picker sentinels can never be an ObjectId, so they cannot collide with an area", () => {
  assert.notEqual(NO_AREA_CHOICE, NEW_AREA_CHOICE);
  for (const sentinel of [NO_AREA_CHOICE, NEW_AREA_CHOICE]) assert.ok(!/^[0-9a-f]{24}$/.test(sentinel));
});

test("resolveAreaChoice: none / existing / removed", () => {
  assert.deepEqual(resolveAreaChoice(NO_AREA_CHOICE, "", AREAS), { kind: "none" });
  assert.deepEqual(resolveAreaChoice("g1", "", AREAS), { kind: "existing", id: "g1" });
  assert.deepEqual(resolveAreaChoice("ghost", "", AREAS), { kind: "invalid", message: AREA_REMOVED_MESSAGE });
  assert.equal(AREA_REMOVED_MESSAGE, "That area was removed. Pick another area.");
  assert.deepEqual(resolveAreaChoice("g1", "", undefined), { kind: "existing", id: "g1" }, "an unloaded list cannot call an id removed");
});

test("resolveAreaChoice: a just-created area is existing even before the list catches up (C-4)", () => {
  const created = { id: "new1", name: "Patio" };
  assert.deepEqual(resolveAreaChoice("new1", "", AREAS, created), { kind: "existing", id: "new1" });
  assert.deepEqual(resolveAreaChoice("new1", "", AREAS), { kind: "invalid", message: AREA_REMOVED_MESSAGE }, "without the created hint it reads as removed");
  assert.deepEqual(resolveAreaChoice(NEW_AREA_CHOICE, " patio ", AREAS, created), { kind: "existing", id: "new1" }, "a retry never re-creates");
});

test("resolveAreaChoice: '+ New area' validates the name, matches case-insensitively and accent-sensitively, else creates", () => {
  assert.deepEqual(resolveAreaChoice(NEW_AREA_CHOICE, "  Patio  ", AREAS), { kind: "create", name: "Patio" });
  assert.deepEqual(resolveAreaChoice(NEW_AREA_CHOICE, "GARDEN", AREAS), { kind: "existing", id: "g1" });
  assert.deepEqual(resolveAreaChoice(NEW_AREA_CHOICE, "garden", AREAS), { kind: "existing", id: "g1" });
  assert.deepEqual(resolveAreaChoice(NEW_AREA_CHOICE, "Café", [area("c1", "Cafe")]), { kind: "create", name: "Café" }, "an accent makes it a different name");
  assert.deepEqual(resolveAreaChoice(NEW_AREA_CHOICE, "Garden", undefined), { kind: "create", name: "Garden" });
  assert.deepEqual(resolveAreaChoice(NEW_AREA_CHOICE, "   ", AREAS), { kind: "invalid", message: AREA_NAME_NEEDED_MESSAGE });
  const tooLong = resolveAreaChoice(NEW_AREA_CHOICE, "x".repeat(25), AREAS);
  assert.deepEqual(tooLong, { kind: "invalid", message: "Keep it to 24 characters or fewer" });
});

test("areaPatchOf: unchanged -> {}, cleared -> {areaId:null}, moved -> {areaId:id}", () => {
  assert.deepEqual(areaPatchOf(NO_AREA_CHOICE, null), {});
  assert.deepEqual(areaPatchOf("g1", "g1"), {});
  assert.deepEqual(areaPatchOf("g1", null), { areaId: null });
  assert.deepEqual(areaPatchOf("ghost", null), { areaId: null }, "clearing a dangling id is allowed");
  assert.deepEqual(areaPatchOf(NO_AREA_CHOICE, "g1"), { areaId: "g1" });
  assert.deepEqual(areaPatchOf("g1", "r1"), { areaId: "r1" });
  assert.ok(Object.hasOwn(areaPatchOf("g1", null), "areaId"), "null must be an own key so JSON carries it to the $unset");
});

// -- source pins ------------------------------------------------------------
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = stripComments(readFileSync(path.join(REPO_ROOT, "apps/cafe/lib/table-areas.ts"), "utf8"));

test("PIN: lib/table-areas.ts is client-safe - no model, db or mongoose value import", () => {
  assert.ok(src.includes("export function groupByArea"), "positive landmark: the grouping lives here");
  assert.ok(!/from\s+["']mongoose["']/.test(src));
  assert.ok(!/from\s+["']@\/(models|lib\/db)/.test(src));
});

test("PIN: the file stays under the 300-line ceiling", () => {
  const lines = readFileSync(path.join(REPO_ROOT, "apps/cafe/lib/table-areas.ts"), "utf8").split("\n").length;
  assert.ok(lines <= 300, `lib/table-areas.ts is ${lines} lines`);
});
