// Tables B2 (Areas), slice D - raw-source pins for where area headings show on
// the New Order table picker and the Move table dialog, and where they must NOT.
// Same readSrc + stripComments idiom as lib/pos-layout-paths.test.ts. Every
// negative pin carries a positive landmark in the SAME test (testing.md); every
// needle that would match this file's own text is built by concatenation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const TABLE_SELECTOR = "apps/cafe/components/pos/TableSelector.tsx";
const MOVE_TABLE_DIALOG = "apps/cafe/components/orders/MoveTableDialog.tsx";
const MOVE_TABLE_PICKER = "apps/cafe/components/orders/MoveTablePicker.tsx";
const TABLE_SHEET = "apps/cafe/components/pos/TableSheet.tsx";
const TABLE_SHEET_LIB = "apps/cafe/lib/table-sheet.ts";

const USE_TABLE_AREAS = "useTable" + "Areas(";
// Each named area: TableArea (its name, "{n} free" and the grid) over the area's own tiles, in the area's order.
const AREA_BLOCK =
  /<TableArea key=\{g\.key\} name=\{g\.name\} free=\{freeTileCount\(g\.items\.map\(\(t\) => tileOf\(t\)\.kind\)\)\}>\s*\{g\.items\.map\(renderTile\)\}\s*<\/TableArea>/;
// No named area: one grid of every table, in the cafe's order.
const FLAT_GRID = '<div data-ui="tp-grid" className={TABLE_GRID_CLASS}>{(tables ?? []).map(renderTile)}</div>';

// U1 Task 11 (values 9.1; design 6.12): both pickers are the owner's HTML "Choose a table" sheet. An area is TableArea
// (components/pos/TableSheet.tsx): its name and "{n} free" over the HTML's auto-fill grid, minmax(92px, 1fr). So the
// capped `grid grid-cols-4` / `grid grid-cols-3` literals and the `<h3 col-span-N>` headings went ON PURPOSE (reason: the
// HTML's auto-fill grid, and its sheet caps the panel, not the list); the grouping, its gate and its order stay.
test("PIN: TableSelector groups its tiles under TableArea by the shared helpers, and stays flat when no area is named", () => {
  const src = code(TABLE_SELECTOR);
  assert.equal(count(src, USE_TABLE_AREAS), 1, "TableSelector must call useTableAreas( once");
  assert.match(src, /groupTablesByArea\(tables \?\? \[\], areas\.data\)/, "landmark: grouping goes through groupTablesByArea");
  assert.match(src, /showAreaHeadings\(groups\)/, "headings are gated by showAreaHeadings");
  assert.match(src, AREA_BLOCK, "each named area: its heading over its own tiles");
  assert.ok(src.includes(FLAT_GRID), "no headings = the flat map, unchanged");
  assert.equal(count(src, "selectorTile" + "("), 1, "the shared tile rule (lib/table-sheet.ts) stays called once");
  for (const gone of ["grid grid-" + "cols-4", "col-span-" + "4", "POS_DIALOG_LIST_" + "CAP_CLASS"]) {
    assert.ok(!src.includes(gone), `TableSelector must not carry ${gone}: the HTML's auto-fill grid in a capped panel`);
  }
});

test("PIN: TableArea draws the HTML's area: the name (truncated, its full name as a title) and '{n} free' over the grid", () => {
  const src = code(TABLE_SHEET);
  const start = src.indexOf("export function TableArea(");
  assert.ok(start >= 0, "landmark: TableSheet.tsx exports TableArea");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  const headAt = body.indexOf('data-ui="tp-area-head"');
  const gridAt = body.indexOf('data-ui="tp-grid"');
  assert.ok(headAt >= 0 && gridAt > headAt, "the heading sits over the grid, inside the area");
  assert.match(body, /<span className="min-w-0 truncate" title=\{name\}>\s*\{name\}\s*<\/span>/, "a long area name truncates and keeps its full name as a title");
  assert.match(body, /\{freeText\(free\)\}/, "the HTML's '{n} free' (upper-cased by its style)");
  assert.match(body, /className=\{TABLE_GRID_CLASS\}>\s*\{children\}/, "the tiles in the area's grid");
});

test("PIN: MoveTablePicker groups the same way and returns a fragment: the legend, the areas, then its foot", () => {
  const src = code(MOVE_TABLE_PICKER);
  assert.equal(count(src, USE_TABLE_AREAS), 1, "the picker must call useTableAreas( once");
  assert.match(src, /groupTablesByArea\(tables \?\? \[\], areas\.data\)/, "landmark: grouping goes through groupTablesByArea");
  assert.match(src, /showAreaHeadings\(groups\)/, "headings are gated by showAreaHeadings");
  assert.match(src, AREA_BLOCK, "each named area: its heading over its own tiles");
  assert.ok(src.includes(FLAT_GRID), "no headings = the flat map, unchanged");
  // A fragment: the first thing return( opens is <>, not a wrapper element, so its parts are the panel's own rows.
  assert.match(src, /return \(\s*<>\s*<TableLegend items=\{MOVE_LEGEND\} \/>/, "the picker must return a fragment, not a wrapper div");
  assert.match(
    src,
    /\{!isAssign && \(\s*<button[^>]*onClick=\{onUnseat\}[^>]*>\s*Remove from table\s*<\/button>/,
    "Remove from table shows only when the tab has a table, and fires onUnseat",
  );
  assert.match(src, /<button[^>]*disabled=\{busy\}\s+onClick=\{onCancel\}[^>]*>\s*Cancel\s*<\/button>/, "Cancel fires onCancel (locked while the move is in flight)");
  assert.equal(count(src, "moveTile" + "("), 1, "the shared move rule (lib/table-sheet.ts) stays called once");
  assert.match(code(TABLE_SHEET_LIB), /isFreeTable\(table\)/, "free tables come from the shared isFreeTable");
  for (const src2 of [src, code(TABLE_SHEET_LIB)]) assert.ok(!src2.includes("function " + "isFree("), "the private isFree copy moved to lib/table-status");
  for (const gone of ["grid grid-" + "cols-3", "col-span-" + "3", "POS_MOVE_TABLE_" + "LIST_CAP_CLASS"]) {
    assert.ok(!src.includes(gone), `MoveTablePicker must not carry ${gone}: the HTML's auto-fill grid in a capped panel`);
  }
});

test("PIN: MoveTableDialog renders <MoveTablePicker exactly once and no longer carries the grid itself", () => {
  const src = code(MOVE_TABLE_DIALOG);
  assert.equal(
    [...src.matchAll(/<MoveTablePicker\b/g)].length,
    1,
    "the dialog must render the picker exactly once",
  );
  assert.match(src, /import \{ MoveTablePicker \} from "@\/components\/orders\/MoveTablePicker";/, "landmark: the picker import");
  assert.match(src, /tables=\{tables\.data\}/, "the picker is fed the dialog's own useTables() result");
  assert.match(src, /onCancel=\{\(\) => onOpenChange\(false\)\}/, "Cancel closes the dialog");
  assert.match(src, /onUnseat=\{armUnseat\}/, "Remove from table still arms the confirm step");
  assert.equal(count(src, "useTables" + "("), 1, "useTables() stays in the dialog");
  for (const gone of ["TABLE_GRID_" + "CLASS", "<Table" + "Area", "grid grid-" + "cols-3", "POS_MOVE_TABLE_" + "LIST_CAP_CLASS"]) {
    assert.ok(!src.includes(gone), `the grid lives in MoveTablePicker, not the dialog (${gone})`);
  }
});

// U0 match Task 7 (values 3.6, design 5.5): the dashboard's Live tables card is the owner's HTML card, whose tiles sit
// under zone labels = our areas, so the Dashboard floor panel left this list (its own pin follows).
test("PIN: area headings appear ONLY on New Order, Move table and the dashboard's Live tables - not on the diner chooser, QR stickers, or reservations", () => {
  const files: Array<[string, string]> = [
    ["apps/cafe/components/public/TableChooser.tsx", "tableNo"],
    ["apps/cafe/app/(dashboard)/tables/qr/page.tsx", "useTables("],
    ["apps/cafe/components/tables/QrSheet.tsx", "tableNo"],
    ["apps/cafe/components/reservations/ReservationFormSheet.tsx", "tableNo"],
  ];
  // Needles built by concatenation so this file's own text is not a match.
  const banned = ["use" + "Areas", "use" + "TableAreas", "area" + "Id"];
  for (const [rel, landmark] of files) {
    const src = code(rel);
    assert.ok(src.includes(landmark), `landmark: ${rel} must still contain ${landmark}`);
    for (const needle of banned) {
      assert.ok(!src.includes(needle), `${rel} must not contain ${needle} - areas stay off this screen`);
    }
  }
});

test("PIN: the dashboard's Live tables group their tiles by area through the shared groupTablesByArea, fed by useTableAreas", () => {
  // Fix round 1: the model moved to lib/dashboard/live-tables.ts; the panel draws it.
  assert.ok(code("apps/cafe/components/dashboard/LiveFloorPanel.tsx").includes("liveTablesModel("), "landmark: the panel draws the Live tables model");
  const panel = code("apps/cafe/lib/dashboard/live-tables.ts");
  assert.match(panel, /groupTablesByArea\(tables, areas\)/, "the panel groups through the one grouping helper");
  assert.ok(panel.includes("NO_AREA_KEY"), "the no-area group is recognised by its shared key");
  const page = code("apps/cafe/app/(dashboard)/page.tsx");
  assert.equal(count(page, USE_TABLE_AREAS), 1, "the dashboard reads the areas once, healing like the Floor (useTableAreas)");
});
