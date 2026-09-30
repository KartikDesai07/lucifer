import { test } from "node:test";
import assert from "node:assert/strict";

import { reorderCategoriesSchema } from "./category.schema";
import { CATEGORY_REORDER_MAX } from "../constants";
import { MAX_IMPORT_ROWS } from "../product-import";

// Menu redesign (owner, 2026-09-30) — the Categories drag-and-drop PATCH body.
// Mirrors table.schema.ts's reorderTablesSchema tests in spirit: min/max/
// duplicate on the ARRAY, strict object.

const ID1 = "64f000000000000000000001";
const ID2 = "64f000000000000000000002";

test("reorderCategoriesSchema accepts a plain {ids} payload", () => {
  const r = reorderCategoriesSchema.safeParse({ ids: [ID1, ID2] });
  assert.equal(r.success, true);
});

test("reorderCategoriesSchema rejects an empty ids array", () => {
  const r = reorderCategoriesSchema.safeParse({ ids: [] });
  assert.equal(r.success, false);
});

test(`reorderCategoriesSchema: exactly CATEGORY_REORDER_MAX (${CATEGORY_REORDER_MAX}) ids parses; one more is rejected`, () => {
  const atMax = Array.from({ length: CATEGORY_REORDER_MAX }, (_, i) => i.toString(16).padStart(24, "0"));
  assert.equal(reorderCategoriesSchema.safeParse({ ids: atMax }).success, true);

  const overMax = [...atMax, "f".repeat(24)];
  assert.equal(reorderCategoriesSchema.safeParse({ ids: overMax }).success, false);
});

test("reorderCategoriesSchema rejects a duplicate id, error path on 'ids'", () => {
  const r = reorderCategoriesSchema.safeParse({ ids: [ID1, ID1] });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(r.error.issues.some((i) => i.path[0] === "ids"));
  }
});

test("reorderCategoriesSchema rejects a malformed id", () => {
  assert.equal(reorderCategoriesSchema.safeParse({ ids: ["not-an-id"] }).success, false);
});

test("reorderCategoriesSchema is strict — an extra key is rejected", () => {
  const r = reorderCategoriesSchema.safeParse({ ids: [ID1], extra: true });
  assert.equal(r.success, false);
});

// A CSV import can create one category per row, and the list must stay
// arrangeable afterwards — CATEGORY_REORDER_MAX must never be smaller than the
// import cap, or a cafe that imports the maximum rows' worth of new
// categories in one file could not arrange the resulting list.
test("CATEGORY_REORDER_MAX >= MAX_IMPORT_ROWS", () => {
  assert.ok(
    CATEGORY_REORDER_MAX >= MAX_IMPORT_ROWS,
    `CATEGORY_REORDER_MAX (${CATEGORY_REORDER_MAX}) must be >= MAX_IMPORT_ROWS (${MAX_IMPORT_ROWS})`,
  );
});
