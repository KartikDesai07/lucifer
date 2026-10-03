import { test } from "node:test";
import assert from "node:assert/strict";

import { createCategorySchema, reorderCategoriesSchema, updateCategorySchema } from "./category.schema";
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

// ── Printing Phase 2 (spec §6.2): the category's kitchen station ────────────

test("createCategorySchema: stationId is optional with no default (absent = the default station)", () => {
  const r = createCategorySchema.safeParse({ name: "Drinks" });
  assert.equal(r.success, true);
  assert.ok(r.success && !("stationId" in r.data), "no stationId key unless one is chosen");
  assert.equal(createCategorySchema.safeParse({ name: "Drinks", stationId: ID1 }).success, true);
  assert.equal(createCategorySchema.safeParse({ name: "Drinks", stationId: "Bar" }).success, false, "only a station id");
});

test("updateCategorySchema: stationId:null means back to the default station; absent leaves it alone", () => {
  const cleared = updateCategorySchema.safeParse({ stationId: null });
  assert.equal(cleared.success && cleared.data.stationId, null);
  const renamed = updateCategorySchema.safeParse({ name: "Hot drinks" });
  assert.ok(renamed.success && !("stationId" in renamed.data), "a rename never touches the station");
});
