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
const DELETE_GUARD_MESSAGE =
  "This category still has ${count} products. Move them to another category first.";

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

// ══════════════════════════════════════════════════════════════════════════
// C16 (arbiter-confirmed) — the categories page's delete/rename copy must
// match the shipped rule (a hard 409 refusal), not the pre-DL-2 cascade.
// ══════════════════════════════════════════════════════════════════════════

const CATEGORIES_PAGE = "apps/cafe/app/(dashboard)/categories/page.tsx";

test("PIN: the categories page's delete confirm copy states the shipped rule (no products left, move them first), not the old Uncategorized cascade", () => {
  const src = readStripped(CATEGORIES_PAGE);

  // Positive landmark: the delete confirm dialog itself must still exist.
  assert.match(src, /title="Delete category\?"/, "the delete ConfirmDialog must still exist");

  assert.ok(
    !/moved to .{0,4}Uncategorized/i.test(src),
    "the delete confirm copy must no longer say products are moved to Uncategorized",
  );
  assert.match(
    src,
    /category can only be deleted once it has no products/i,
    "the delete confirm copy must state the shipped rule in plain English",
  );
});

test("PIN: the categories page's rename copy says something true (products keep their link, the new name shows everywhere), not that renaming updates all products", () => {
  const src = readStripped(CATEGORIES_PAGE);

  // Positive landmark: the rename/add dialog's description branch must exist.
  assert.match(src, /editing\s*\?\s*"/, "the rename/add DialogDescription's ternary must still exist");

  assert.ok(
    !/updates this category on all its products/i.test(src),
    "the rename copy must no longer claim renaming updates this category on all its products -- products link by categoryId only, nothing to update",
  );
  assert.match(
    src,
    /keep their link.{0,40}new name shows everywhere/i,
    "the rename copy must say products keep their link to the category, so the new name shows everywhere",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// C17 (arbiter-confirmed) — the 409 guard counts ALL products (archived
// included), but the archived ProductsTable view rendered no Edit control,
// stranding the operator with products they were told to move but couldn't
// reach. Fix: render Edit in the archived branch too.
// ══════════════════════════════════════════════════════════════════════════

const PRODUCTS_TABLE = "apps/cafe/components/products/ProductsTable.tsx";

test("PIN: ProductsTable renders an Edit action in the ARCHIVED branch too, so an archived product (still counted by the category 409 guard) can be re-homed to another category", () => {
  const src = readStripped(PRODUCTS_TABLE);

  // Positive landmark: the archived branch's Restore action must still be
  // there -- proves this is reading the real archived-branch JSX, not a
  // vacuous match against an empty/gutted file.
  assert.match(src, /onClick=\{\(\) => onRestore\(product\._id\)\}/, "the archived branch must still render its Restore action");

  // Anchor on the actions column's own wrapper (unique to it -- the
  // Availability column earlier in the file has its own, unrelated
  // `{archived ? (...) : (...)}` ternary, which a bare indexOf("{archived ? (")
  // would find FIRST and silently scope every assertion below to the wrong
  // branch).
  const actionsColumnStart = src.indexOf('className="flex justify-end gap-1"');
  assert.ok(actionsColumnStart >= 0, "the actions column's wrapper div must still exist");
  const archivedBranchStart = src.indexOf("{archived ? (", actionsColumnStart);
  assert.ok(archivedBranchStart >= 0, "the products table must still branch on `archived` for its actions column");
  const archivedBranchEnd = src.indexOf(") : (", archivedBranchStart);
  assert.ok(archivedBranchEnd > archivedBranchStart, "the archived branch must be followed by the non-archived branch");
  const archivedBranch = src.slice(archivedBranchStart, archivedBranchEnd);

  assert.match(
    archivedBranch,
    /onClick=\{\(\) => onEdit\(product\)\}/,
    "the archived branch must render an Edit action (onClick={() => onEdit(product)}) alongside Restore -- without it an archived product counted by the category 409 guard can never be moved to another category",
  );
});
