import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CB-DL-2 T1a -- categoryId link migration, route/spec side. Product now
// links to a Category by `categoryId` only (models/Product.ts); a rename no
// longer needs to cascade onto every product, and the category delete route
// must refuse when products still reference it (rather than the old rename
// cascade). This file pins:
//   1. PUT /api/categories/[id] no longer runs a Product.updateMany cascade;
//   2. DELETE /api/categories/[id] guards via Product.countDocuments and the
//      exact 409 message;
//   3. the route no longer imports UNCATEGORIZED;
//   4. lib/masters.ts's PRODUCT_LIST spec no longer sorts by category;
//   5. the products/import route's product $set writes categoryId, not
//      category, plus the Category re-read that resolves the CSV's name
//      column to an id.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readStripped = (rel: string): string => stripComments(readSrc(rel));

const CATEGORY_ID_ROUTE = "apps/cafe/app/api/categories/[id]/route.ts";
const MASTERS = "apps/cafe/lib/masters.ts";
const IMPORT_ROUTE = "apps/cafe/app/api/products/import/route.ts";

// Needles built by concatenation (testing.md rule): a literal here could trip
// this file's own scan or a sibling banned-string sweep.
const PRODUCT_DOT = "Product" + ".";
const UPDATE_MANY_CALL = PRODUCT_DOT + "updateMany";
const CACHE_DEL_CATEGORIES = 'cache.del("categories")';
const COUNT_DOCUMENTS_CATEGORY_ID = PRODUCT_DOT + "countDocuments({ categoryId";
// Menu redesign (owner, 2026-09-30): the 409 copy now says "items", not
// "products" -- the whole Menu screen's wording changed from "product" to
// "item" (R21).
const DELETE_GUARD_MESSAGE =
  "This category still has ${count} items. Move them to another category first.";

test("PIN: PUT /api/categories/[id] runs no Product.updateMany cascade -- a rename touches nothing on the product side now that products link by categoryId, not a denormalized name", () => {
  const src = readStripped(CATEGORY_ID_ROUTE);

  // Positive landmarks first (vision guard): the PUT export and its own
  // cache invalidation must both still be present, or the negative pin below
  // could be vacuously true because the file was misread/gutted.
  assert.match(src, /export async function PUT\(/, "the route must still export PUT");
  assert.ok(src.includes(CACHE_DEL_CATEGORIES), 'PUT must still invalidate the "categories" cache key on save');

  assert.ok(
    !src.includes(UPDATE_MANY_CALL),
    "PUT must not run a Product.updateMany cascade -- products link by categoryId only, so a rename needs no product-side write",
  );
});

test("PIN: DELETE /api/categories/[id] guards on Product.countDocuments({ categoryId: ... }) and returns the exact 409 message naming the product count", () => {
  const src = readStripped(CATEGORY_ID_ROUTE);

  // Positive landmark: the DELETE export itself.
  assert.match(src, /export async function DELETE\(/, "the route must still export DELETE");

  assert.ok(
    src.includes(COUNT_DOCUMENTS_CATEGORY_ID),
    "DELETE must guard with Product.countDocuments({ categoryId: ... }) before deleting a category",
  );
  assert.ok(
    src.includes(DELETE_GUARD_MESSAGE),
    "DELETE must return the exact message template naming ${count} products, telling the operator to move them first",
  );
  assert.match(
    src,
    /count > 0[\s\S]{0,200}409/,
    "the guard's failure branch must return 409 (a conflict, not a bad request)",
  );
});

test("PIN: app/api/categories/[id]/route.ts no longer imports UNCATEGORIZED -- that sentinel belonged to the old rename-cascade path", () => {
  const src = readStripped(CATEGORY_ID_ROUTE);
  // Positive landmark: the file must still import something real from the
  // models it depends on, proving this isn't reading an empty/broken file.
  assert.match(src, /import\s*\{\s*Category\s*\}\s*from\s*"@\/models\/Category"/, "the route must still import the Category model");
  assert.ok(!src.includes("UNCATEGORIZED"), "the route must not import or reference UNCATEGORIZED");
});

test("PIN: lib/masters.ts's PRODUCT_LIST no longer sorts by category -- categoryId carries no display name to sort by server-side", () => {
  const src = readStripped(MASTERS);
  const specStart = src.indexOf("export const PRODUCT_LIST");
  assert.ok(specStart >= 0, "PRODUCT_LIST must still be declared in lib/masters.ts");
  const specEnd = src.indexOf("};", specStart);
  const spec = src.slice(specStart, specEnd + 2);

  // Positive landmark: the spec must still sort by name.
  assert.match(spec, /sort:\s*\{ name: 1 \}/, "PRODUCT_LIST must sort by name");
  assert.ok(
    !/sort:\s*\{[^}]*category/.test(spec),
    "PRODUCT_LIST's sort must not reference category at all",
  );
});

test("PIN: the products/import route's product $set writes categoryId (not category), and resolves the CSV's category NAME column via a Category.find({ name: { $in: ... } }) re-read", () => {
  const src = readSrc(IMPORT_ROUTE); // raw source -- this route has no comments near the block that would need stripping

  const productOpsStart = src.indexOf("const productOps");
  assert.ok(productOpsStart >= 0, "the product bulkWrite ops must be built as productOps");
  const setStart = src.indexOf("$set: {", productOpsStart);
  assert.ok(setStart > productOpsStart, "the $set block must follow productOps");
  const setEnd = src.indexOf("}", setStart);
  const setBlock = src.slice(setStart, setEnd + 1);

  // Positive landmark: the $set block must still be a real, non-empty block
  // that writes other known fields, or the negative pin below is vacuous.
  assert.match(setBlock, /price:\s*e\.data\.price/, "the $set block must still write price -- vision guard for the categoryId pin below");

  assert.match(setBlock, /categoryId:\s*idByName\.get\(e\.data\.category\)/, "the $set block must write categoryId: idByName.get(e.data.category)");
  assert.ok(
    !/\bcategory:/.test(setBlock),
    "the $set block must not carry a `category:` key any more -- the CSV name is resolved to categoryId before the write",
  );

  assert.ok(
    src.includes("Category.find({ name: { $in:"),
    "the import route must re-read Category.find({ name: { $in: ... } }) to resolve each row's category NAME to an id",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// C12 (arbiter-confirmed) — the category DELETE's countDocuments -> deleteOne
// window can strand a product on a dangling categoryId; nothing on the
// product WRITE side validated that categoryId names a live category. This
// pin asserts POST /api/products supplies the validate: hook wired to the new
// category-exists check, paired with positive landmarks that this is really
// the products route (the createCollectionRoute factory call and the create
// schema line), so the negative absence this replaces can't pass vacuously.
// ══════════════════════════════════════════════════════════════════════════

const PRODUCTS_ROUTE = "apps/cafe/app/api/products/route.ts";
const CATEGORY_ADMIN_LIB = "apps/cafe/lib/category-admin.ts";

test("PIN: POST /api/products wires createCollectionRoute's validate: hook to checkCategoryExists, so a categoryId naming no live category is rejected before create", () => {
  const src = readStripped(PRODUCTS_ROUTE);

  // Positive landmarks: this really is the products route, built on the
  // factory, with the create schema still wired in.
  assert.match(src, /createCollectionRoute\(\{/, "the route must still be built via createCollectionRoute({ ... })");
  assert.match(src, /createSchema:\s*createProductSchema/, "the route must still wire createSchema: createProductSchema");

  assert.match(
    src,
    /import\s*\{\s*checkCategoryExists\s*\}\s*from\s*"@\/lib\/category-admin"/,
    "the route must import checkCategoryExists from @/lib/category-admin",
  );
  assert.match(
    src,
    /validate:\s*\(data\)\s*=>\s*checkCategoryExists\(data\.categoryId\)/,
    "the route must wire validate: (data) => checkCategoryExists(data.categoryId)",
  );
});

test("PIN: checkCategoryExists resolves null when the category exists and a plain-English message when it does not, via an indexed _id existence check (no populate)", () => {
  const src = readStripped(CATEGORY_ADMIN_LIB);

  assert.match(src, /export async function checkCategoryExists\(/, "checkCategoryExists must be exported");
  assert.match(
    src,
    /Category\.exists\(\{\s*_id:\s*categoryId\s*\}\)/,
    "checkCategoryExists must use Category.exists({ _id: categoryId }) -- an indexed existence check, one round trip, no populate",
  );
  assert.ok(!src.includes(".populate("), "checkCategoryExists must not use populate() -- an existence check needs no document body");
  assert.match(
    src,
    /return\s+exists\s*\?\s*null\s*:\s*"Select a valid category\."/,
    "checkCategoryExists must resolve null on a live category and the exact plain-English message otherwise",
  );
});

// C16 and C17's pins (categories page delete/rename copy; ProductsTable's
// archived Edit action) were removed here as part of the Menu redesign
// (2026-09-30) -- both source files are being rewritten by slices C and B
// respectively, and their replacement pins live in those slices' own test
// files (lib/menu-categories-paths.test.ts, lib/menu-items-paths.test.ts).
