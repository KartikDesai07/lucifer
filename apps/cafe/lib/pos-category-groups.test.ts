import { test } from "node:test";
import assert from "node:assert/strict";

import { groupProductsByCategory, OTHER_CATEGORY_HEADING } from "./pos-category-groups";
import { buildCategoryMap, sortProductsByCategoryOrder } from "./category-map";
import type { Category } from "@/types";

// UI batch 1 §H — grouping is a pure split of sortProductsByCategoryOrder's
// own output, so every test here sorts first (as ProductGrid will) and then
// groups, matching the real call shape rather than hand-ordering fixtures.

function cat(id: string, name: string, order: number): Category {
  return { _id: id, name, order, createdAt: "", updatedAt: "" };
}

function product(name: string, categoryId?: string) {
  return { name, categoryId };
}

test("groups by Category.order, not category name", () => {
  const categories = [cat("c-b", "Beverages", 1), cat("c-a", "Appetizers", 0)];
  const map = buildCategoryMap(categories);
  const products = [product("Coke", "c-b"), product("Fries", "c-a")];

  const sorted = sortProductsByCategoryOrder(products, map);
  const groups = groupProductsByCategory(sorted, map);

  assert.deepEqual(
    groups.map((g) => g.heading),
    ["Appetizers", "Beverages"],
    "Appetizers (order 0) must come before Beverages (order 1), even though B < B alphabetically would disagree here",
  );
});

test("an empty category (no matching products) is never emitted", () => {
  const categories = [cat("c-a", "Appetizers", 0), cat("c-b", "Beverages", 1)];
  const map = buildCategoryMap(categories);
  const products = [product("Fries", "c-a")];

  const sorted = sortProductsByCategoryOrder(products, map);
  const groups = groupProductsByCategory(sorted, map);

  assert.deepEqual(groups.map((g) => g.heading), ["Appetizers"]);
});

test("items with no resolvable category land in a trailing 'Other' group, after every real category", () => {
  const categories = [cat("c-a", "Appetizers", 0)];
  const map = buildCategoryMap(categories);
  const products = [product("Mystery Item"), product("Fries", "c-a"), product("Deleted-cat Item", "gone")];

  const sorted = sortProductsByCategoryOrder(products, map);
  const groups = groupProductsByCategory(sorted, map);

  assert.deepEqual(groups.map((g) => g.heading), ["Appetizers", OTHER_CATEGORY_HEADING]);
  const other = groups[groups.length - 1]!;
  assert.equal(other.categoryId, null);
  // Both an absent categoryId and an unresolved one land in the SAME "Other"
  // run, sorted by name within it (localeCompare: "Deleted" < "Mystery").
  assert.deepEqual(
    other.items.map((p) => p.name),
    ["Deleted-cat Item", "Mystery Item"],
  );
});

test("items inside one category keep today's within-category order (name, from sortProductsByCategoryOrder)", () => {
  const categories = [cat("c-a", "Appetizers", 0)];
  const map = buildCategoryMap(categories);
  const products = [product("Zucchini", "c-a"), product("Apple", "c-a"), product("Mango", "c-a")];

  const sorted = sortProductsByCategoryOrder(products, map);
  const groups = groupProductsByCategory(sorted, map);

  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]!.items.map((p) => p.name),
    ["Apple", "Mango", "Zucchini"],
  );
});

test("a single-category filter (or a search match) — the caller passes only the matching products — still yields one heading + its items", () => {
  const categories = [cat("c-a", "Appetizers", 0), cat("c-b", "Beverages", 1)];
  const map = buildCategoryMap(categories);
  // Simulates the page already having filtered down to one category's items
  // (selectedCategory !== ALL) or a search match spanning only one category.
  const filtered = [product("Fries", "c-a"), product("Nachos", "c-a")];

  const sorted = sortProductsByCategoryOrder(filtered, map);
  const groups = groupProductsByCategory(sorted, map);

  assert.equal(groups.length, 1, "only the matching category's heading should appear");
  assert.equal(groups[0]!.heading, "Appetizers");
  assert.deepEqual(
    groups[0]!.items.map((p) => p.name),
    ["Fries", "Nachos"],
  );
});

test("a search match spanning several categories still yields one heading per matched category, each carrying only its matches", () => {
  const categories = [cat("c-a", "Appetizers", 0), cat("c-b", "Beverages", 1)];
  const map = buildCategoryMap(categories);
  // e.g. searching "cola" matched one item in each of two categories.
  const filtered = [product("Cola Chicken", "c-a"), product("Cola", "c-b")];

  const sorted = sortProductsByCategoryOrder(filtered, map);
  const groups = groupProductsByCategory(sorted, map);

  assert.deepEqual(groups.map((g) => g.heading), ["Appetizers", "Beverages"]);
  assert.equal(groups[0]!.items.length, 1);
  assert.equal(groups[1]!.items.length, 1);
});

test("an empty product list yields no groups at all", () => {
  const map = buildCategoryMap([]);
  assert.deepEqual(groupProductsByCategory([], map), []);
});

// Review finding (2026-09-29, arbitrated against lib/category-map.ts): two
// categories sharing an `order` — the schema default is 0 for every category —
// made the product-name tie-break interleave them, so a run-split repeated a
// heading and split its items. One heading per category, in the Categories-
// screen order (order, then name), is the contract.
test("categories that share an order keep ONE heading each, ordered by name like the Categories screen", () => {
  const categories = [cat("c-s", "Snacks", 0), cat("c-c", "Coffee", 0)];
  const map = buildCategoryMap(categories);
  const products = [product("Americano", "c-c"), product("Brownie", "c-s"), product("Cappuccino", "c-c")];

  const groups = groupProductsByCategory(sortProductsByCategoryOrder(products, map), map);

  assert.deepEqual(groups.map((g) => g.heading), ["Coffee", "Snacks"]);
  assert.deepEqual(groups[0].items.map((p) => p.name), ["Americano", "Cappuccino"]);
  assert.equal(new Set(groups.map((g) => g.categoryId)).size, groups.length, "every group key is unique");
});

test("a real category that happens to be NAMED 'Uncategorized' is its own group, never merged into Other", () => {
  const categories = [cat("c-u", "Uncategorized", 0), cat("c-t", "Tea", 1)];
  const map = buildCategoryMap(categories);
  const products = [product("Mystery box", "c-u"), product("Chai", "c-t"), product("Orphan", "missing-id")];

  const groups = groupProductsByCategory(sortProductsByCategoryOrder(products, map), map);

  assert.deepEqual(groups.map((g) => [g.categoryId, g.heading]), [["c-u", "Uncategorized"], ["c-t", "Tea"], [null, OTHER_CATEGORY_HEADING]]);
});

test("tied categories are ordered by NAME, not by which one's first product sorts first", () => {
  // "Apple crumble" (Snacks) sorts before "Black coffee" (Coffee), so bucket
  // insertion order is Snacks, Coffee — the Categories screen lists Coffee first.
  const categories = [cat("c-s", "Snacks", 0), cat("c-c", "Coffee", 0)];
  const map = buildCategoryMap(categories);
  const products = [product("Apple crumble", "c-s"), product("Black coffee", "c-c")];
  const groups = groupProductsByCategory(sortProductsByCategoryOrder(products, map), map);
  assert.deepEqual(groups.map((g) => g.heading), ["Coffee", "Snacks"]);
});
