import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Menu redesign (owner, 2026-09-30) — server access pins, slice A. Every
// assertion here reads the ACTUAL route/lib source, not a re-implementation
// of the rule, so a source edit that silently drops a guard fails this file.
// Each negative pin is paired with a positive landmark (testing.md rule).
//
// Mutation-tested by hand (temporarily break the named source line, watch
// the exact test go red, restore) before this file was reported done:
//   - products/route.ts: removed writeGuard -> POST guard pin failed.
//   - products/[id]/route.ts: removed staffUpdateFields -> staff pin failed.
//   - crud-route.ts: swapped the staffUpdateFields ternary for unconditional
//     runGuard(config.guard) -> the "PUT calls requireAuth() on the staff-
//     scoped side" pin failed (that call site only exists when
//     staffUpdateFields is set; otherwise PUT falls back to
//     runGuard(writeGuard ?? guard), per G1).
//   - categories/route.ts PATCH: removed sameIdSet check -> 409 pin failed.
//   - products/bulk/route.ts: moved the role check after connectDB() ->
//     the "check runs before updateMany" ordering pin failed.
//   - products/import/route.ts: added `icon` to the $set object literal ->
//     the "$set has no icon" pin failed.
//   - every route: removed a PUBLIC_MENU_CACHE_KEY invalidation line -> that
//     route's own invalidation pin failed.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readStripped = (rel: string): string => stripComments(readSrc(rel));

const CRUD_ROUTE = "apps/cafe/lib/crud-route.ts";
const PRODUCTS_ROUTE = "apps/cafe/app/api/products/route.ts";
const PRODUCT_ITEM_ROUTE = "apps/cafe/app/api/products/[id]/route.ts";
const PRODUCTS_IMPORT_ROUTE = "apps/cafe/app/api/products/import/route.ts";
const PRODUCTS_BULK_ROUTE = "apps/cafe/app/api/products/bulk/route.ts";
const CATEGORIES_ROUTE = "apps/cafe/app/api/categories/route.ts";
const CATEGORY_ITEM_ROUTE = "apps/cafe/app/api/categories/[id]/route.ts";
const UPLOAD_ROUTE = "apps/cafe/app/api/upload/route.ts";

// Needle built by concatenation (testing.md rule): a literal would risk
// matching this file's own text under a banned-string scan elsewhere.
const CACHE_KEY_NEEDLE = "PUBLIC_MENU" + "_CACHE_KEY";

// ── crud-route.ts: R1's exact PUT semantics ─────────────────────────────────

// G1 fix: the earlier version of this pin claimed PUT must call requireAuth()
// UNCONDITIONALLY — that was the bug (BLOCKER, arbitrated): it 403'd every
// non-admin PUT on an entity with no staffUpdateFields (reservations, events).
// The correct, current contract is conditional — see the "PIN G1" test below
// for the fallback branch; this test only pins the staff-scoped SIDE (when
// staffUpdateFields IS set, PUT must call requireAuth(), not runGuard).
test("PIN: createItemRoute's PUT handler calls requireAuth() (not runGuard) on the staff-scoped side, when staffUpdateFields is set — a non-admin session must still reach the staff-scoped check", () => {
  const src = readStripped(CRUD_ROUTE);
  const putStart = src.indexOf("async function PUT(");
  assert.ok(putStart >= 0, "createItemRoute must still export a PUT handler");
  const putEnd = src.indexOf("async function DELETE(", putStart);
  assert.ok(putEnd > putStart, "PUT must be followed by DELETE");
  const putBody = src.slice(putStart, putEnd);

  assert.match(putBody, /config\.staffUpdateFields\s*\?\s*await requireAuth\(\)/, "PUT's staff-scoped side must call requireAuth() when staffUpdateFields is set");
});

test("PIN: createItemRoute's PUT handler refuses a non-admin whose parsed keys are not a subset of staffUpdateFields, via isStaffScopedUpdate, with 403 'Admin access required'", () => {
  const src = readStripped(CRUD_ROUTE);
  const putStart = src.indexOf("async function PUT(");
  const putEnd = src.indexOf("async function DELETE(", putStart);
  const putBody = src.slice(putStart, putEnd);

  assert.match(putBody, /config\.staffUpdateFields\s*&&\s*authed\.session\.user\.role !== "admin"/, "PUT must branch on staffUpdateFields being set AND the session role");
  assert.match(
    putBody,
    /isStaffScopedUpdate\(parsed\.data,\s*config\.staffUpdateFields\)/,
    "the non-admin branch must call isStaffScopedUpdate(parsed.data, config.staffUpdateFields)",
  );
  assert.match(putBody, /failure\("Admin access required",\s*403\)/, "the refusal must be the exact 403 message requireAdmin uses");
});

// G1 (arbitrated FIX — was a BLOCKER): the staff-scoped R1 discipline must
// apply ONLY to an entity that opts in via staffUpdateFields. Reservations and
// events (createItemRoute with no staffUpdateFields) never opted in, so their
// PUT must keep the ORIGINAL runGuard(writeGuard ?? guard) — the earlier
// version ran requireAuth() unconditionally for EVERY entity, which 403'd
// every non-admin PUT (Seat button, reservation status, event edits) since
// none of them set staffUpdateFields.
test("PIN G1: createItemRoute's PUT falls back to runGuard(writeGuard ?? guard) when staffUpdateFields is NOT set — the original behaviour every other entity (reservations, events, tables, customers, staff) still relies on", () => {
  const src = readStripped(CRUD_ROUTE);
  const putStart = src.indexOf("async function PUT(");
  const putEnd = src.indexOf("async function DELETE(", putStart);
  const putBody = src.slice(putStart, putEnd);

  // Positive landmark: the staff-scoped branch (R1) must still be there.
  assert.match(putBody, /await requireAuth\(\)/, "vision guard: the staff-scoped requireAuth() branch must still exist");

  assert.match(
    putBody,
    /config\.staffUpdateFields\s*\?\s*await requireAuth\(\)\s*:\s*await runGuard\(config\.writeGuard \?\? config\.guard\)/,
    "PUT's auth check must be conditional on config.staffUpdateFields, falling back to runGuard(writeGuard ?? guard) when it is unset",
  );
});

test("PIN: createItemRoute's DELETE handler guards with writeGuard ?? guard (admin-capable), and clearCaches receives invalidateKeys", () => {
  const src = readStripped(CRUD_ROUTE);
  const deleteStart = src.indexOf("async function DELETE(");
  assert.ok(deleteStart >= 0, "createItemRoute must still export DELETE");
  const deleteBody = src.slice(deleteStart);

  assert.match(deleteBody, /runGuard\(config\.writeGuard \?\? config\.guard\)/, "DELETE must guard with writeGuard ?? guard");
  assert.match(deleteBody, /clearCaches\(config\.cacheKey,\s*config\.invalidateKeys\)/, "DELETE must clear the entity cache plus any invalidateKeys on success");
});

test("PIN: createCollectionRoute's POST handler guards with writeGuard ?? guard and clears invalidateKeys", () => {
  const src = readStripped(CRUD_ROUTE);
  const postStart = src.indexOf("async function POST(");
  assert.ok(postStart >= 0, "createCollectionRoute must still export POST");
  const postEnd = src.indexOf("return { GET, POST };", postStart);
  const postBody = src.slice(postStart, postEnd);

  assert.match(postBody, /runGuard\(config\.writeGuard \?\? config\.guard\)/, "POST must guard with writeGuard ?? guard");
  assert.match(postBody, /clearCaches\(config\.cacheKey,\s*config\.invalidateKeys\)/, "POST must clear the entity cache plus any invalidateKeys on success");
});

// ── products/route.ts: POST is admin-only, invalidates the public menu ─────

test("PIN: POST /api/products (create) is admin-only and invalidates the public menu cache", () => {
  const src = readStripped(PRODUCTS_ROUTE);
  assert.match(src, /createCollectionRoute\(\{/, "vision guard: this must be the createCollectionRoute call");
  assert.match(src, /writeGuard:\s*"admin"/, "POST /api/products must set writeGuard: \"admin\"");
  assert.ok(src.includes(CACHE_KEY_NEEDLE), "POST /api/products must invalidate the public menu cache on create");
});

// G17 — the products routes' generated crud-route messages ("Item not found",
// "Failed to X item") must read "item"/"items", matching the renamed Items
// screen, never the retired "product"/"products" wording.
test("PIN G17: both products routes' entity label is { singular: 'item', plural: 'items' }, not 'product'/'products'", () => {
  for (const rel of [PRODUCTS_ROUTE, PRODUCT_ITEM_ROUTE]) {
    const src = readStripped(rel);
    assert.match(src, /entity:\s*\{\s*singular:\s*"item",\s*plural:\s*"items"\s*\}/, `${rel} must declare entity: { singular: "item", plural: "items" }`);
    assert.ok(!/singular:\s*"product"/.test(src), `${rel} must not declare entity.singular as "product" any more`);
  }
});

// ── products/[id]/route.ts: PUT staff-scoped, DELETE admin, icon $unset ────

test("PIN: PUT/DELETE /api/products/[id] are wired to admin writeGuard + STAFF_PRODUCT_FIELDS, and icon is in nullClearsFields", () => {
  const src = readStripped(PRODUCT_ITEM_ROUTE);
  assert.match(src, /createItemRoute\(\{/, "vision guard: this must be the createItemRoute call");
  assert.match(src, /writeGuard:\s*"admin"/, "must set writeGuard: \"admin\" (covers DELETE; PUT's own auth is staff-scoped in crud-route.ts because this route also sets staffUpdateFields — G1)");
  assert.match(src, /staffUpdateFields:\s*STAFF_PRODUCT_FIELDS/, "must wire staffUpdateFields: STAFF_PRODUCT_FIELDS");
  assert.match(src, /nullClearsFields:\s*\[[^\]]*"icon"[^\]]*\]/, "nullClearsFields must include \"icon\" so icon:null becomes $unset");
  assert.ok(src.includes(CACHE_KEY_NEEDLE), "must invalidate the public menu cache on every write");
});

// ── products/import/route.ts: admin-only, $set has no icon, cache cleared ──

test("PIN: POST /api/products/import requires admin (not merely requireAuth)", () => {
  const src = readStripped(PRODUCTS_IMPORT_ROUTE);
  const postStart = src.indexOf("export async function POST(");
  assert.ok(postStart >= 0, "the import route must still export POST");
  const authLine = src.slice(postStart, postStart + 300);
  assert.match(authLine, /requireAdmin\(\)/, "the import route's POST must call requireAdmin()");
  assert.ok(!/requireAuth\(\)/.test(authLine), "the import route's auth check must not still be requireAuth()");
});

test("PIN: the import route's product $set carries no `icon` key — this omission is what preserves a stored icon across a re-import", () => {
  const src = readSrc(PRODUCTS_IMPORT_ROUTE);
  const productOpsStart = src.indexOf("const productOps");
  assert.ok(productOpsStart >= 0, "the product bulkWrite ops must be built as productOps");
  const setStart = src.indexOf("$set: {", productOpsStart);
  const setEnd = src.indexOf("},", setStart);
  const setBlock = src.slice(setStart, setEnd + 1);

  // Positive landmark (vision guard): the $set block must still be real and
  // non-empty, anchored on a field the import route has always written.
  assert.match(setBlock, /price:\s*e\.data\.price/, "vision guard: the $set block must still write price");
  assert.ok(!/\bicon\b/.test(setBlock), "the import $set must never mention icon — a re-import must not clear a chosen icon");
});

test("PIN: a real (non-dry-run) import invalidates the public menu cache alongside the products cache", () => {
  const src = readStripped(PRODUCTS_IMPORT_ROUTE);
  const productOpsIf = src.indexOf("if (productOps.length > 0)");
  assert.ok(productOpsIf >= 0, "the commit branch must guard on productOps.length > 0");
  const block = src.slice(productOpsIf, productOpsIf + 400);
  assert.ok(block.includes('cache.del("products")'), 'vision guard: the commit branch must still clear cache.del("products")');
  assert.ok(block.includes(CACHE_KEY_NEEDLE), "the commit branch must also clear the public menu cache");
});

// ── products/bulk/route.ts: staff-action gate BEFORE the write ─────────────

test("PIN: POST /api/products/bulk checks isStaffBulkAction BEFORE connectDB()/updateMany, so a refused action writes nothing", () => {
  const src = readStripped(PRODUCTS_BULK_ROUTE);
  const roleCheckIdx = src.indexOf("isStaffBulkAction(action)");
  const connectIdx = src.indexOf("connectDB()");
  const updateManyIdx = src.indexOf("updateMany(");
  assert.ok(roleCheckIdx >= 0, "the route must call isStaffBulkAction(action)");
  assert.ok(connectIdx > roleCheckIdx, "connectDB() must run AFTER the role check");
  assert.ok(updateManyIdx > connectIdx, "updateMany must run after connectDB (vision guard on ordering)");
});

test("PIN: POST /api/products/bulk's move branch checks checkCategoryExists BEFORE the updateMany, returning 400 on a missing category", () => {
  const src = readStripped(PRODUCTS_BULK_ROUTE);
  const checkIdx = src.indexOf("checkCategoryExists(categoryId)");
  const updateManyIdx = src.indexOf("updateMany(");
  assert.ok(checkIdx >= 0, "the route must call checkCategoryExists(categoryId)");
  assert.ok(updateManyIdx > checkIdx, "updateMany must run after the category-exists check");
  assert.match(src, /if \(invalid\) return failure\(invalid, 400\)/, "a missing category must return 400");
});

test("PIN: POST /api/products/bulk clears both the products cache and the public menu cache", () => {
  const src = readStripped(PRODUCTS_BULK_ROUTE);
  assert.ok(src.includes('cache.del("products")'), "vision guard: bulk must still clear the products cache");
  assert.ok(src.includes(CACHE_KEY_NEEDLE), "bulk must also clear the public menu cache");
});

// ── categories/route.ts: POST admin, PATCH 409 on a stale/partial list ─────

test("PIN: POST /api/categories is admin-only via writeGuard, and PATCH exists and guards with requireAdmin", () => {
  const src = readStripped(CATEGORIES_ROUTE);
  assert.match(src, /writeGuard:\s*"admin"/, "POST /api/categories must set writeGuard: \"admin\"");
  const patchStart = src.indexOf("export async function PATCH(");
  assert.ok(patchStart >= 0, "the categories route must export PATCH");
  const patchBody = src.slice(patchStart);
  assert.match(patchBody, /requireAdmin\(\)/, "PATCH must call requireAdmin()");
});

test("PIN: PATCH /api/categories returns 409 CATEGORY_LIST_CHANGED_ERROR via sameIdSet BEFORE any bulkWrite, and clears both caches on success", () => {
  const src = readStripped(CATEGORIES_ROUTE);
  const patchStart = src.indexOf("export async function PATCH(");
  const patchBody = src.slice(patchStart);

  const sameIdSetIdx = patchBody.indexOf("sameIdSet(");
  const bulkWriteIdx = patchBody.indexOf("bulkWrite(");
  assert.ok(sameIdSetIdx >= 0, "PATCH must call sameIdSet(...)");
  assert.ok(bulkWriteIdx > sameIdSetIdx, "bulkWrite must run AFTER the sameIdSet check (existence + ordering)");

  assert.match(patchBody, /return failure\(CATEGORY_LIST_CHANGED_ERROR,\s*409\)/, "a mismatched id set must return 409 CATEGORY_LIST_CHANGED_ERROR");
  assert.ok(patchBody.includes('cache.del(CACHE_KEY)'), "PATCH must clear the categories cache");
  assert.ok(patchBody.includes(CACHE_KEY_NEEDLE), "PATCH must also clear the public menu cache");
});

test("PIN: GET /api/categories supports an uncached ?fresh=1 read via listFilter", () => {
  const src = readStripped(CATEGORIES_ROUTE);
  assert.match(src, /sp\.get\("fresh"\) === "1"/, "GET must offer a ?fresh=1 uncached read (R12)");
});

// ── categories/[id]/route.ts: PUT admin-only, DELETE "items" copy ──────────

test("PIN: PUT /api/categories/[id] requires admin (not merely requireAuth)", () => {
  const src = readStripped(CATEGORY_ITEM_ROUTE);
  const putStart = src.indexOf("export async function PUT(");
  assert.ok(putStart >= 0, "the route must still export PUT");
  const authLine = src.slice(putStart, putStart + 200);
  assert.match(authLine, /requireAdmin\(\)/, "PUT must call requireAdmin()");
});

test("PIN G7: DELETE /api/categories/[id] requires admin", () => {
  const src = readStripped(CATEGORY_ITEM_ROUTE);
  const deleteStart = src.indexOf("export async function DELETE(");
  assert.ok(deleteStart >= 0, "the route must still export DELETE");
  const authLine = src.slice(deleteStart, deleteStart + 200);
  assert.match(authLine, /requireAdmin\(\)/, "DELETE must call requireAdmin()");
});

test("PIN: DELETE /api/categories/[id]'s 409 guard message says 'items', not 'products', and PUT/DELETE both invalidate the public menu cache", () => {
  const src = readStripped(CATEGORY_ITEM_ROUTE);
  assert.match(
    src,
    /This category still has \$\{count\} items\. Move them to another category first\./,
    "the 409 message must say 'items' (R21 — the Menu screen's wording change)",
  );
  assert.ok(!/\$\{count\} products\./.test(src), "the old 'products' wording must be gone");
  // Both writers of this file must clear the public menu cache — count >= 2.
  const hits = src.split(CACHE_KEY_NEEDLE).length - 1;
  assert.ok(hits >= 2, `PUT and DELETE must each invalidate the public menu cache (found ${hits} references)`);
});

// ── upload/route.ts: POST admin-only ───────────────────────────────────────

test("PIN: POST /api/upload requires admin", () => {
  const src = readStripped(UPLOAD_ROUTE);
  const postStart = src.indexOf("export async function POST(");
  assert.ok(postStart >= 0, "the upload route must still export POST");
  const deleteStart = src.indexOf("export async function DELETE(");
  const postBody = src.slice(postStart, deleteStart);
  assert.match(postBody, /requireAdmin\(\)/, "POST must call requireAdmin()");
});
