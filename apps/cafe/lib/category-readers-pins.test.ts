import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CB-DL-2 T2: Product only carries `categoryId` now (models/Product.ts);
// `category` as a NAME string must no longer be read off a product anywhere
// in the app/component/lib source, except the small set of diner-shaped
// files that intentionally still carry a resolved `category` NAME field
// (lib/public-menu.ts's PublicMenuItem output, the diner components that
// consume it) and the CSV import path, which keeps a human-typed `category`
// column with no id to fill in. Same walk-the-tree technique as
// public-surface-paths.test.ts, so a NEW reader added later is caught
// automatically, not by a hardcoded file list.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const absOf = (rel: string): string => path.join(REPO_ROOT, rel);

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE_PATTERN = /\.test\.ts$/;

function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walk(abs, out);
    } else if (CODE_FILE_PATTERN.test(entry) && !TEST_FILE_PATTERN.test(entry)) {
      out.push(abs);
    }
  }
}

function relPath(fileAbs: string): string {
  return path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
}

// Exact-file allow-list (not a directory allowance): each of these keeps a
// diner-shape `category` NAME field or a CSV-row `category` column on
// purpose. Asserted to still exist on disk below so this list cannot rot
// into silently exempting a renamed/deleted file forever.
const ALLOWED_FILES = new Set([
  "apps/cafe/components/public/PublicMenu.tsx",
  "apps/cafe/components/public/PublicMenuItem.tsx",
  // S1 split — grouping logic moved out of PublicMenu.tsx verbatim; it reads
  // the same diner-shape `category` NAME field that file was already allowed to.
  "apps/cafe/components/public/public-menu-groups.ts",
  "apps/cafe/components/products/ImportPreviewTable.tsx",
  "apps/cafe/components/settings/AppearancePreview.tsx",
  "apps/cafe/lib/public-menu.ts",
  "apps/cafe/app/api/products/import/route.ts",
]);

// Needles built by concatenation (testing.md rule): a literal here could
// otherwise trip this file's own repo-wide banned-string scan, or a sibling
// scan of THIS test file.
const DOT_CATEGORY = "." + "category";
const CATEGORY_TRIPLE_EQUALS = DOT_CATEGORY + " " + "===";
const CATEGORY_SORT_LITERAL = "category" + ":" + " 1";

// A non-identifier character after `.category` (so `.categoryId`/`.categoryMap`
// never false-positive): whitespace, `,`, `;`, `)`, `]`, `}`, a dot, a quote,
// or end-of-line. Anchored to word boundary on the left too, so `.category`
// can't match inside a longer identifier either.
const CATEGORY_NAME_READ = /\.category(?![A-Za-z0-9_])/;

test("PIN: no product-category NAME read (`.category` as a bare field, `===`, or a `category: 1` sort literal) remains outside the allow-listed diner/CSV files — Product only carries categoryId now (models/Product.ts)", () => {
  const dirs = ["apps/cafe/components", "apps/cafe/lib", "apps/cafe/app"];
  const files: string[] = [];
  for (const dir of dirs) {
    const dirAbs = absOf(dir);
    walk(dirAbs, files);
  }
  assert.ok(files.length > 0, "the scan must walk at least one file — an empty glob would pass this test for the wrong reason");

  let scannedNonAllowlisted = 0;
  for (const fileAbs of files) {
    const rel = relPath(fileAbs);
    if (ALLOWED_FILES.has(rel)) continue;
    scannedNonAllowlisted += 1;
    const src = stripComments(readFileSync(fileAbs, "utf8"));

    // Mutation this catches: a component or route reading `product.category`
    // (or any `x.category`) as a NAME after the categoryId migration — that
    // field no longer exists on the stored/typed Product, so a stale read
    // like this would silently resolve to undefined at runtime with tsc none
    // the wiser (an `any`-typed row, a loosely-typed CSV intermediate, etc).
    assert.ok(
      !CATEGORY_NAME_READ.test(src),
      `${rel} must not read a bare ".category" field — Product only carries categoryId now`,
    );
    assert.ok(
      !src.includes(CATEGORY_TRIPLE_EQUALS),
      `${rel} must not compare "${CATEGORY_TRIPLE_EQUALS}" — that was the old category-NAME filter/sort predicate`,
    );
    assert.ok(
      !src.includes(CATEGORY_SORT_LITERAL),
      `${rel} must not sort/project by the old "${CATEGORY_SORT_LITERAL}" literal`,
    );
  }
  assert.ok(scannedNonAllowlisted > 0, "the scan must have actually checked at least one non-allow-listed file");

  // Vision guard for the allow-list negative-pin machinery itself: each
  // allow-listed file must still exist, or this pin would silently stop
  // checking anything without failing loud.
  for (const rel of ALLOWED_FILES) {
    assert.ok(existsSync(absOf(rel)), `allow-listed file ${rel} must still exist — a moved/renamed file must not silently drop out of this pin's coverage`);
  }
});

// ── Positive landmarks: the categoryId-based readers this migration wired ──

const PRODUCT_GRID = "apps/cafe/components/pos/ProductGrid.tsx";
const PRODUCTS_PAGE = "apps/cafe/app/(dashboard)/products/page.tsx";
const PRODUCT_FORM_SHEET = "apps/cafe/components/products/ProductFormSheet.tsx";
const PRODUCTS_TABLE = "apps/cafe/components/products/ProductsTable.tsx";
const PRODUCT_CARD = "apps/cafe/components/pos/ProductCard.tsx";
const CATEGORY_SIDEBAR = "apps/cafe/components/pos/CategorySidebar.tsx";
const PUBLIC_MENU_ROUTE = "apps/cafe/app/api/public/menu/route.ts";
const USE_CATEGORY_MAP = "apps/cafe/hooks/use-category-map.ts";

test("PIN: ProductGrid filters by p.categoryId === selectedCategory (landmark for the negative sweep above)", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  assert.match(src, /p\.categoryId === selectedCategory/, "ProductGrid.tsx must filter products by p.categoryId === selectedCategory");
});

// C18: PRODUCT_LIST's server sort moved to {name:1} in CB-DL-2, which dropped
// the POS grid's category grouping. The grid must restore it CLIENT-side, and
// it must group by the category's display `order` (the operator's hand
// arrangement on the Categories screen), never by the category NAME.
test("PIN: C18 — ProductGrid groups tiles by the category's display order, then by product name", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));

  // The grouping RULE is behaviourally pinned in lib/category-map.test.ts
  // (sortProductsByCategoryOrder). This pin only guards the WIRING: that the
  // grid actually calls it on the list it renders. A text pin cannot tell a
  // live sort from an unreachable one, so the reachability half matters most.
  assert.match(
    src,
    /return sortProductsByCategoryOrder\(matching, categoryMap\)/,
    "ProductGrid must RETURN the grouped list from its memo — an early return above this would silently restore the flat server order",
  );
  assert.match(
    src,
    /import \{[^}]*sortProductsByCategoryOrder[^}]*\} from "@\/lib\/category-map"/,
    "positive landmark: the grouping helper must still be imported from lib/category-map",
  );
});

// C19: the category map loads on its own bootstrap key, so it can still be
// empty on the first paint while products have already arrived. Sorting
// against an empty map would bucket every tile under the UNCATEGORIZED
// fallback and then visibly jump once the map lands.
test("PIN: C19 — ProductGrid holds the server order for the one render where the category map has not loaded", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  assert.match(
    src,
    /if\s*\(categoriesLoading\)\s*return\s+matching;/,
    "ProductGrid.tsx must return the unsorted server order while the category map is still loading",
  );
  // Positive landmark so the guard cannot pass vacuously on a gutted file.
  assert.match(src, /categoriesLoading/, "categoriesLoading must still be read from the category-map hook");
});

test("PIN: products/page.tsx filters by p.categoryId === category (landmark)", () => {
  const src = stripComments(readSrc(PRODUCTS_PAGE));
  assert.match(src, /p\.categoryId === category/, "products/page.tsx must filter products by p.categoryId === category");
});

test('PIN: ProductFormSheet binds the Select to name="categoryId" (landmark)', () => {
  const src = stripComments(readSrc(PRODUCT_FORM_SHEET));
  assert.match(src, /name="categoryId"/, 'ProductFormSheet.tsx must bind its category Select via name="categoryId"');
});

test("PIN: ProductsTable resolves each row's category via categoryNameOf( (landmark)", () => {
  const src = stripComments(readSrc(PRODUCTS_TABLE));
  assert.match(src, /categoryNameOf\(/, "ProductsTable.tsx must call categoryNameOf( to resolve a row's category display name");
});

test("PIN: ProductCard accepts a categoryLabel prop (landmark)", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  assert.match(src, /categoryLabel/, "ProductCard.tsx must declare/use a categoryLabel prop");
});

test("PIN: CategorySidebar's rail and chips both key their controls by value={c._id} (count 2 — one per presentation)", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  const count = (src.match(/value=\{c\._id\}/g) ?? []).length;
  assert.equal(count, 2, `CategorySidebar.tsx must use value={c._id} exactly twice (CategorySidebar's rail + CategoryChips), found ${count}`);
});

test("PIN: useCategoryMap( has at least 2 real call sites outside hooks/use-category-map.ts itself (wiring, not just compilation)", () => {
  const consumers = [PRODUCT_GRID, PRODUCTS_PAGE];
  let callSiteCount = 0;
  for (const rel of consumers) {
    const src = stripComments(readSrc(rel));
    if (/useCategoryMap\(/.test(src)) callSiteCount += 1;
  }
  assert.ok(callSiteCount >= 2, `useCategoryMap( must have at least 2 real call sites outside its own file, found ${callSiteCount} among ${consumers.join(", ")}`);

  // Vision guard: the hook's own file must still declare/export it, or the
  // call-site count above would be checking a dead import.
  const hookSrc = stripComments(readSrc(USE_CATEGORY_MAP));
  assert.match(hookSrc, /export function useCategoryMap\(/, "hooks/use-category-map.ts must still export useCategoryMap");
});

test('PIN: the public menu route selects "name categoryId ..." and shapes items via toPublicMenuItem(p, categoryNameOf) (landmarks)', () => {
  const src = stripComments(readSrc(PUBLIC_MENU_ROUTE));
  assert.match(src, /\.select\("name categoryId/, 'the public menu route must .select("name categoryId ..." on the Product query');
  assert.match(src, /toPublicMenuItem\(p, categoryNameOf\)/, "the public menu route must call toPublicMenuItem(p, categoryNameOf)");
});
