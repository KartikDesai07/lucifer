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

const SELECTOR_GRID = 'cn("grid grid-cols-4 gap-2 overflow-y-auto", POS_DIALOG_LIST_CAP_CLASS)';
const PICKER_GRID = 'cn("grid grid-cols-3 gap-2 overflow-y-auto", POS_MOVE_TABLE_LIST_CAP_CLASS)';
const USE_TABLE_AREAS = "useTable" + "Areas(";

test("PIN: TableSelector keeps its pinned grid literal ONCE and puts col-span-4 area headings inside it, grouped by the shared helpers", () => {
  const src = code(TABLE_SELECTOR);
  assert.equal(count(src, SELECTOR_GRID), 1, "the capped grid literal must appear exactly once");
  assert.equal(count(src, USE_TABLE_AREAS), 1, "TableSelector must call useTableAreas( once");
  assert.match(src, /groupTablesByArea\(tables \?\? \[\], areas\.data\)/, "landmark: grouping goes through groupTablesByArea");
  assert.match(src, /showAreaHeadings\(groups\)/, "headings are gated by showAreaHeadings");
  assert.match(
    src,
    /<h3 className="col-span-4 truncate pt-1 text-sm font-semibold first:pt-0" title=\{g\.name\}>/,
    "the area heading must span all 4 columns, truncate, and carry the full name as a title",
  );
  const gridAt = src.indexOf(SELECTOR_GRID);
  const headingAt = src.indexOf('className="col-span-4');
  const gridEnd = src.indexOf("</div>", gridAt);
  assert.ok(gridAt >= 0 && headingAt > gridAt && headingAt < gridEnd, "the heading must sit INSIDE the capped grid");
  assert.match(src, /\(tables \?\? \[\]\)\.map\(renderTile\)/, "no headings = the flat map, unchanged");
  assert.equal(count(src, "tablePickAction" + "("), 1, "the shared pick rule stays called once");
});

test("PIN: MoveTablePicker groups with col-span-3 headings inside the pinned grid and returns a fragment", () => {
  const src = code(MOVE_TABLE_PICKER);
  assert.equal(count(src, PICKER_GRID), 1, "the capped grid literal must appear exactly once");
  assert.equal(count(src, USE_TABLE_AREAS), 1, "the picker must call useTableAreas( once");
  assert.match(src, /groupTablesByArea\(tables \?\? \[\], areas\.data\)/, "landmark: grouping goes through groupTablesByArea");
  assert.match(src, /showAreaHeadings\(groups\)/, "headings are gated by showAreaHeadings");
  assert.match(
    src,
    /<h3 className="col-span-3 truncate pt-1 text-sm font-semibold first:pt-0" title=\{g\.name\}>/,
    "the area heading must span all 3 columns, truncate, and carry the full name as a title",
  );
  const gridAt = src.indexOf(PICKER_GRID);
  const headingAt = src.indexOf('className="col-span-3');
  const gridEnd = src.indexOf("</div>", gridAt);
  assert.ok(gridAt >= 0 && headingAt > gridAt && headingAt < gridEnd, "the heading must sit INSIDE the capped grid");
  assert.match(src, /\(tables \?\? \[\]\)\.map\(renderTile\)/, "no headings = the flat map, unchanged");
  // A fragment: the first thing return( opens is <>, not a wrapper element.
  assert.match(src, /return \(\s*<>\s*<div className=\{cn\("grid grid-cols-3/, "the picker must return a fragment, not a wrapper div");
  assert.match(
    src,
    /\{!isAssign && \(\s*<Button[^>]*onClick=\{onUnseat\}[^>]*>\s*Remove from table\s*<\/Button>/,
    "Remove from table shows only when the tab has a table, and fires onUnseat",
  );
  assert.match(src, /<Button variant="outline" disabled=\{busy\} onClick=\{onCancel\}>\s*Cancel/, "Cancel fires onCancel");
  assert.match(src, /isFreeTable\(t\)/, "free tables come from the shared isFreeTable");
  assert.ok(!src.includes("function isFree("), "the private isFree copy moved to lib/table-status");
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
  assert.ok(!src.includes("grid grid-cols-3"), "the grid moved to MoveTablePicker");
  assert.ok(!src.includes("POS_MOVE_TABLE_LIST_CAP_CLASS"), "the dialog no longer imports the list cap class");
});

test("PIN: area headings appear ONLY on New Order and Move table - not on the diner chooser, QR stickers, Dashboard floor panel, or reservations", () => {
  const files: Array<[string, string]> = [
    ["apps/cafe/components/public/TableChooser.tsx", "tableNo"],
    ["apps/cafe/components/dashboard/LiveFloorPanel.tsx", "tableNo"],
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
