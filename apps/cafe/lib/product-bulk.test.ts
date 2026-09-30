import { test } from "node:test";
import assert from "node:assert/strict";

import { bulkUpdateOf } from "./product-bulk";

// Menu redesign (owner, 2026-09-30) — R9's per-action state filter + $set.
// Pure shaping only; the route (menu-access-pins.test.ts) pins that the
// per-action role check runs BEFORE the updateMany this builds for.

const CATEGORY_ID = "64f0000000000000000000c1";

test("out-of-stock: filters to active, not-already-out-of-stock items; sets available:false", () => {
  const { stateFilter, update } = bulkUpdateOf("out-of-stock");
  assert.deepEqual(stateFilter, { isActive: true, available: { $ne: false } });
  assert.deepEqual(update, { $set: { available: false } });
});

test("in-stock: filters to active, already-out-of-stock items; sets available:true", () => {
  const { stateFilter, update } = bulkUpdateOf("in-stock");
  assert.deepEqual(stateFilter, { isActive: true, available: false });
  assert.deepEqual(update, { $set: { available: true } });
});

test("move: filters to items NOT already in the target category (active or archived); sets categoryId", () => {
  const { stateFilter, update } = bulkUpdateOf("move", CATEGORY_ID);
  assert.deepEqual(stateFilter, { categoryId: { $ne: CATEGORY_ID } });
  assert.deepEqual(update, { $set: { categoryId: CATEGORY_ID } });
  // No isActive term — R9: moving an archived item is how a category gets
  // emptied for delete, so archived items must be reachable too.
  assert.ok(!("isActive" in stateFilter), "move's filter must not exclude archived items");
});

test("archive: filters to currently-active items only; sets isActive:false", () => {
  const { stateFilter, update } = bulkUpdateOf("archive");
  assert.deepEqual(stateFilter, { isActive: true });
  assert.deepEqual(update, { $set: { isActive: false } });
});

test("restore: filters to currently-archived items only; sets isActive:true", () => {
  const { stateFilter, update } = bulkUpdateOf("restore");
  assert.deepEqual(stateFilter, { isActive: false });
  assert.deepEqual(update, { $set: { isActive: true } });
});
