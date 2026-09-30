// Tables B2 grep-gate (ruling C-5): screens never read a table's area link
// themselves. Grouping lives in lib/table-areas.ts (groupTablesByArea,
// tableAreaIdOf, composeAreaOrder, tablesInArea) and the table form is the one
// UI writer, so a second hand-rolled "which area is this table in" rule can never
// drift from the one the Floor, Setup, New Order and Move table all share.
// The Floor files are gated in tables-floor-paths.test.ts; the surfaces that
// must show no areas at all are gated in table-areas-picker-paths.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

// The identifier, whole-word, in any idiomatic form (t.areaId, { areaId },
// areaId ?? …, !areaId). Built by concatenation so this file's own source is
// never a match for a scan that reads it.
const LINK_FIELD = new RegExp("\\b" + "area" + "Id" + "\\b");

// [file, positive landmark proving the file really groups through the helpers]
const GATED: ReadonlyArray<readonly [string, string]> = [
  ["apps/cafe/components/pos/TableSelector.tsx", "useTableAreas("],
  ["apps/cafe/components/orders/MoveTablePicker.tsx", "groupTablesByArea("],
  ["apps/cafe/components/orders/MoveTableDialog.tsx", "<MoveTablePicker"],
  ["apps/cafe/app/(dashboard)/tables/setup/page.tsx", "useTableAreas("],
  ["apps/cafe/components/tables/TableSetupList.tsx", "composeAreaOrder("],
  ["apps/cafe/components/tables/TableSetupRow.tsx", "useSortable("],
  ["apps/cafe/components/tables/AreasSheet.tsx", "tablesInArea("],
  ["apps/cafe/components/tables/AreaArrangeList.tsx", "tablesInArea("],
  ["apps/cafe/components/tables/AreaRow.tsx", "useSortable("],
];

test("the gated list is non-empty", () => {
  assert.ok(GATED.length >= 9);
});

for (const [file, landmark] of GATED) {
  test(`GATE: ${path.basename(file)} groups through lib/table-areas and never reads the area link itself`, () => {
    const src = read(file);
    assert.ok(src.includes(landmark), `landmark ${landmark} must be present in ${file}`);
    assert.ok(!LINK_FIELD.test(src), `${file} must not read the table's area link directly — use the lib/table-areas helpers`);
  });
}

test("GATE sanity: the needle catches the idiomatic forms and the helper file really does use the field", () => {
  for (const form of ["t.areaId", "{ areaId }", "areaId ?? x", "!table.areaId"]) assert.ok(LINK_FIELD.test(form), form);
  assert.ok(!LINK_FIELD.test("tableAreaIdOf(t)"), "the helper's own name is not a match");
  assert.ok(LINK_FIELD.test(read("apps/cafe/lib/table-areas.ts")), "landmark: lib/table-areas.ts reads the field (the one place allowed)");
});
