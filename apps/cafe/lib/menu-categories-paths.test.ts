// Source pins for the Categories PAGE (dialogs, copy, admin gating). Menu
// redesign, slice C, 2026-09-30. Same readSrc + stripComments idiom as
// lib/sidebar-paths.test.ts / lib/category-routes-pins.test.ts. This file is
// the C16 replacement: the old copy pins in category-routes-pins.test.ts were
// deleted there (slice A) because the copy itself moved here, reworded from
// "products" to "items" for the Items/Categories split. The reorder hook/
// CategoryArrangeList/CategoryRow pins (G2, G3, N1) split out into
// lib/category-arrange-hook-paths.test.ts once this file grew past the line
// ceiling across three fix rounds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { MENU_SECTIONS } from "@/lib/menu-sections";
import { ADMIN_ROUTES } from "@pos/shared/constants";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readStripped = (rel: string): string => stripComments(readSrc(rel));

const CATEGORIES_PAGE = "apps/cafe/app/(dashboard)/categories/page.tsx";

// ══════════════════════════════════════════════════════════════════════════
// C16 replacement — the delete/rename copy, reworded "products" -> "items"
// (the pins this replaces lived in category-routes-pins.test.ts:182-214,
// deleted there by slice A because the page itself is a full rewrite).
// ══════════════════════════════════════════════════════════════════════════

test("PIN: the categories page's delete copy states the shipped rule in ITEM words, not the old product wording", () => {
  const src = readStripped(CATEGORIES_PAGE);

  // Positive landmark: the delete AlertDialog itself must still exist.
  assert.match(src, /AlertDialogTitle>Delete category\?</, "the delete dialog must still exist");

  assert.ok(!/moved to .{0,4}Uncategorized/i.test(src), "the delete copy must not say items are moved to Uncategorized");
  assert.ok(!/no products/i.test(src), "the delete copy must say ITEMS, not products");
  assert.match(
    src,
    /category can only be deleted once it has no items\. Move its items to another category first\./i,
    "the delete copy must state the shipped rule, worded for items",
  );
});

test("PIN: a category with items left links to the filtered Items page instead of offering a Delete that would only fail", () => {
  const src = readStripped(CATEGORIES_PAGE);
  assert.match(src, /deletingItemCount > 0/, "landmark: the page must compute whether the category being deleted still has items");
  assert.match(
    src,
    /menuItemsHref\(\{\s*categoryId:\s*deleting\._id\b/,
    "the blocked-delete state must link to menuItemsHref({ categoryId }) — the Items page filtered to this category",
  );
  // Only archived items left -> the link opens the Archived view (where they
  // are), and the rendered link really uses that computed href.
  assert.match(src, /status:\s*\(deletingCounts\?\.active \?\? 0\) === 0 \? "archived" : undefined/, "an all-archived category must link to the Archived view");
  assert.match(src, /<Link href=\{deletingItemsHref\}/, "the blocked-delete link must use the computed deletingItemsHref");
  // Vision guard for the negative below: the non-blocked branch must still
  // render a real Delete action, or this pin could pass on a page that never
  // offers Delete at all.
  assert.match(src, /<AlertDialogAction[\s\S]{0,500}\bDelete\s*<\/AlertDialogAction>/, "a non-blocked delete must still render a Delete action");
});

// G16 (arbiter-confirmed): the delete dialog must not guess while either
// item-count query is still in flight or has failed -- Delete stays hidden
// in both cases, not just while items are known to remain.
test("PIN: the delete dialog shows a loading line while either item count is pending, an error line with Try again if either failed, and hides Delete in both cases", () => {
  const src = readStripped(CATEGORIES_PAGE);

  assert.match(
    src,
    /const countsLoading = activeProducts\.isLoading \|\| archivedProducts\.isLoading;/,
    "the page must compute countsLoading from both product queries' isLoading",
  );
  assert.match(
    src,
    /const countsErrored = activeProducts\.isError \|\| archivedProducts\.isError;/,
    "the page must compute countsErrored from both product queries' isError",
  );
  assert.match(src, /Checking items…/, "a pending count check must say so in plain English");
  assert.match(
    src,
    /Couldn&apos;t check this category&apos;s items/,
    "a failed count check must say so, distinct from the pending line",
  );
  // The failed line's Try again must actually refetch BOTH queries, not just
  // one -- either could be the one that failed.
  const refetchBothStart = src.indexOf("const refetchCounts = () => {");
  assert.ok(refetchBothStart >= 0, "landmark: a combined refetch callback must exist");
  const refetchBothEnd = src.indexOf("};", refetchBothStart);
  const refetchBothBody = src.slice(refetchBothStart, refetchBothEnd);
  assert.match(refetchBothBody, /activeProducts\.refetch\(\)/, "refetchCounts must refetch the active products query");
  assert.match(refetchBothBody, /archivedProducts\.refetch\(\)/, "refetchCounts must refetch the archived products query");

  // Delete itself must be gated on both flags, alongside the existing
  // countsReady/deletingItemCount checks -- vision-guarded by requiring the
  // whole conjunction to appear as one expression, so a partial edit that
  // drops one clause fails this pin.
  assert.match(
    src,
    /\{countsReady && !countsLoading && !countsErrored && !countsOffline && !\(deleting && deletingItemCount > 0\) && \(/,
    "the Delete action must be gated on countsReady, !countsLoading, !countsErrored and !countsOffline, on top of the existing item-count check",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// N6 (arbiter-confirmed) -- a paused (offline) query with no data yet is
// neither isLoading (fetchStatus is "paused", not "fetching") nor isError (it
// never got an answer to fail), so it fell through to "no items" silently:
// no Delete, and no explanation why.
// ══════════════════════════════════════════════════════════════════════════

test("PIN: the delete dialog shows an offline notice when either item count is a paused query with no data, distinct from loading/error", () => {
  const src = readStripped(CATEGORIES_PAGE);

  assert.match(
    src,
    /const isPausedNoData = \(q: \{ fetchStatus: string; data: unknown \}\) => q\.fetchStatus === "paused" && q\.data === undefined;/,
    "the page must define a helper checking fetchStatus === 'paused' with no data yet",
  );
  assert.match(
    src,
    /const countsOffline = !countsErrored && \(isPausedNoData\(activeProducts\) \|\| isPausedNoData\(archivedProducts\)\);/,
    "countsOffline must check both product queries and exclude the errored case",
  );
  assert.match(src, /You&apos;re offline — can&apos;t check this category&apos;s items right now\./, "the offline branch must say so in plain English");

  // Vision guard: the offline branch must sit in the same loading/errored/
  // offline/blocked ternary chain, after loading and errored (so a paused
  // query with data already cached still falls through past this branch to
  // the normal blocked/open states) and before the "items remain" branch.
  const loadingIdx = src.indexOf("Checking items…");
  const erroredIdx = src.indexOf("Couldn&apos;t check this category&apos;s items");
  const offlineIdx = src.indexOf("You&apos;re offline");
  const blockedIdx = src.indexOf("This category still has");
  assert.ok(
    loadingIdx >= 0 && erroredIdx > loadingIdx && offlineIdx > erroredIdx && blockedIdx > offlineIdx,
    "the four branches must appear in order: loading, errored, offline, then items-remain",
  );
});

test("PIN: the categories page's rename copy says items keep their link, not that renaming updates all products", () => {
  const src = readStripped(CATEGORIES_PAGE);

  assert.match(src, /editing\s*\?\s*"/, "the rename/add DialogDescription's ternary must still exist");
  assert.ok(
    !/updates this category on all its (products|items)/i.test(src),
    "the rename copy must not claim renaming updates the category on every item",
  );
  assert.match(
    src,
    /items keep their link.{0,40}new name shows everywhere/i,
    "the rename copy must say items keep their link to this category, so the new name shows everywhere",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// AdminGuard + MENU_SECTIONS/ADMIN_ROUTES parity.
// ══════════════════════════════════════════════════════════════════════════

test("PIN: the Categories page is wrapped in AdminGuard", () => {
  const src = readStripped(CATEGORIES_PAGE);
  assert.match(src, /import\s*\{\s*AdminGuard\s*\}\s*from\s*"@\/components\/shared\/AdminGuard"/, "the page must import AdminGuard");
  assert.match(src, /<AdminGuard>/, "the default export must render inside <AdminGuard>");
});

test("PIN: MENU_SECTIONS' adminOnly set is exactly ADMIN_ROUTES intersected with the menu hrefs -- Categories in both, Items in neither", () => {
  const menuHrefs = new Set(MENU_SECTIONS.map((s) => s.href));
  const adminMenuHrefs = new Set((ADMIN_ROUTES as readonly string[]).filter((r) => menuHrefs.has(r)));
  const sectionAdminHrefs = new Set(MENU_SECTIONS.filter((s) => s.adminOnly).map((s) => s.href));
  assert.deepEqual(sectionAdminHrefs, adminMenuHrefs, "MENU_SECTIONS.adminOnly must match ADMIN_ROUTES exactly, for every menu href");
  assert.ok(sectionAdminHrefs.has("/categories"), "vision guard: /categories must actually be admin-only in MENU_SECTIONS");
  assert.ok(!sectionAdminHrefs.has("/products"), "vision guard: /products (Items) must not be admin-only");
});

// ══════════════════════════════════════════════════════════════════════════
// Create uses nextCategoryOrder (max + 1), not list.length.
// ══════════════════════════════════════════════════════════════════════════

// Changed in Phase 2 Session 2D: a new category may carry its kitchen station after its order; skip-KOT then added the noKot spread.
test("PIN: a new category's order comes from nextCategoryOrder(list), not list.length", () => {
  const src = readStripped(CATEGORIES_PAGE);
  assert.match(
    src,
    /createCategory\.mutateAsync\(\{\s*name:\s*trimmed,\s*order:\s*nextCategoryOrder\(list\)(,\s*\.\.\.\(stationId !== "" \? \{ stationId \} : \{\}\))?(,\s*\.\.\.\(noKot \? \{ noKot \} : \{\}\))?\s*\}\)/,
    "create must send order: nextCategoryOrder(list)",
  );
  assert.ok(!/order:\s*list\.length/.test(src), "create must not send order: list.length (collides after a delete)");
});

// Skip-KOT smoke s12 (2026-10-08): the shadcn Badge behind NoKotTag renders a <div>, and a <div> inside a <p> is invalid
// HTML that React reports as a hydration error on /categories. Every element that holds the tag must be a non-<p> box.
test("PIN: the No KOT tag never sits inside a <p> (Badge is a <div>: hydration error)", () => {
  const files = ["apps/cafe/components/menu/CategoryRow.tsx", "apps/cafe/components/menu/ItemCards.tsx", "apps/cafe/components/menu/ItemsTable.tsx"];
  for (const rel of files) {
    const src = readStripped(rel);
    const at = src.indexOf("<NoKotTag");
    assert.ok(at !== -1, `landmark: ${rel} renders the tag`);
    const before = src.slice(0, at);
    const openP = before.lastIndexOf("<p");
    const closeP = before.lastIndexOf("</p>");
    const insideP = openP !== -1 && openP > closeP && /^<p[\s>]/.test(before.slice(openP));
    assert.equal(insideP, false, `${rel}: <NoKotTag> must not be a descendant of a <p>`);
  }
});
