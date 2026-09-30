import { test } from "node:test";
import assert from "node:assert/strict";

import { sameIdSet, categoryReorderOps, CATEGORY_LIST_CHANGED_ERROR } from "./category-order";

// Menu redesign (owner, 2026-09-30) — PATCH /api/categories's pure helpers.
// Pure shaping/comparison only; the route (category-routes-pins.test.ts /
// menu-access-pins.test.ts) pins the 409 wiring around these.

const A = "64f000000000000000000001";
const B = "64f000000000000000000002";
const C = "64f000000000000000000003";

// ── sameIdSet ────────────────────────────────────────────────────────────────

test("sameIdSet: identical arrays (same order) are equal", () => {
  assert.equal(sameIdSet([A, B, C], [A, B, C]), true);
});

test("sameIdSet: same ids in a DIFFERENT order are still equal — this is a SET comparison", () => {
  assert.equal(sameIdSet([A, B, C], [C, A, B]), true);
});

test("sameIdSet: a partial list (missing one id) is NOT equal", () => {
  assert.equal(sameIdSet([A, B], [A, B, C]), false);
});

test("sameIdSet: an extra/unknown id is NOT equal", () => {
  assert.equal(sameIdSet([A, B, C], [A, B]), false);
});

test("sameIdSet: two empty arrays are equal", () => {
  assert.equal(sameIdSet([], []), true);
});

test("sameIdSet: same length but a swapped-out id is NOT equal", () => {
  assert.equal(sameIdSet([A, B], [A, C]), false);
});

// ── categoryReorderOps ───────────────────────────────────────────────────────

test("categoryReorderOps: renumbers 0..n-1 by array position, one updateOne per id", () => {
  const ops = categoryReorderOps([C, A, B]);
  assert.deepEqual(ops, [
    { updateOne: { filter: { _id: C }, update: { $set: { order: 0 } } } },
    { updateOne: { filter: { _id: A }, update: { $set: { order: 1 } } } },
    { updateOne: { filter: { _id: B }, update: { $set: { order: 2 } } } },
  ]);
});

test("categoryReorderOps: an empty list produces no ops", () => {
  assert.deepEqual(categoryReorderOps([]), []);
});

test("categoryReorderOps: a single id gets order 0", () => {
  assert.deepEqual(categoryReorderOps([A]), [
    { updateOne: { filter: { _id: A }, update: { $set: { order: 0 } } } },
  ]);
});

// ── CATEGORY_LIST_CHANGED_ERROR (R22) ───────────────────────────────────────

test("CATEGORY_LIST_CHANGED_ERROR is the exact R22 copy", () => {
  assert.equal(
    CATEGORY_LIST_CHANGED_ERROR,
    "The category list changed on another screen. It has been refreshed — arrange again.",
  );
});
