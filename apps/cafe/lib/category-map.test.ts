import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCategoryMap, categoryNameOf, sortProductsByCategoryOrder } from "./category-map";
import { UNCATEGORIZED } from "@pos/shared/constants";
import type { Category } from "@/types";

// CB-DL-2 D-A5: Product only carries a categoryId now, so every reader needs
// this pure client-side join helper to show a name. DB-free by design — pure
// functions, no React/Mongoose — behavior only, no source pins here (those
// live in lib/category-readers-pins.test.ts).

function category(overrides: Partial<Category> = {}): Category {
  return {
    _id: "64f0000000000000000000c1",
    name: "Beverages",
    order: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("buildCategoryMap: keys the map by _id, resolvable via categoryNameOf for a known id", () => {
  const map = buildCategoryMap([category()]);
  assert.equal(map.size, 1, "one category in, one entry out");
  assert.equal(
    categoryNameOf(map, "64f0000000000000000000c1"),
    "Beverages",
    "a known id must resolve to its category's name",
  );
});

test("categoryNameOf: an unknown id (no matching category — deleted or never-migrated) falls back to UNCATEGORIZED", () => {
  const map = buildCategoryMap([category({ _id: "64f0000000000000000000c1", name: "Beverages" })]);
  assert.equal(
    categoryNameOf(map, "64f0000000000000000000ff"),
    UNCATEGORIZED,
    "an id with no matching entry must resolve to UNCATEGORIZED, not undefined/blank",
  );
});

test("categoryNameOf: an undefined categoryId falls back to UNCATEGORIZED without touching the map", () => {
  const map = buildCategoryMap([category()]);
  assert.equal(
    categoryNameOf(map, undefined),
    UNCATEGORIZED,
    "a missing categoryId (product.categoryId undefined) must resolve to UNCATEGORIZED",
  );
});

test("buildCategoryMap: an empty categories list produces an empty map, and categoryNameOf still falls back to UNCATEGORIZED for any id", () => {
  const map = buildCategoryMap([]);
  assert.equal(map.size, 0, "an empty categories list must build an empty map");
  assert.equal(
    categoryNameOf(map, "64f0000000000000000000c1"),
    UNCATEGORIZED,
    "any id against an empty map must resolve to UNCATEGORIZED",
  );
});

test("buildCategoryMap: duplicate _id entries — the LAST one in the input array wins (Map constructor semantics: a later [key, value] pair overwrites an earlier one for the same key)", () => {
  const map = buildCategoryMap([
    category({ _id: "64f0000000000000000000c1", name: "Old Name" }),
    category({ _id: "64f0000000000000000000c1", name: "New Name" }),
  ]);
  assert.equal(map.size, 1, "duplicate ids must collapse to one map entry, not two");
  assert.equal(
    categoryNameOf(map, "64f0000000000000000000c1"),
    "New Name",
    "on a duplicate _id, buildCategoryMap keeps the LAST category object seen — this is what the code does (new Map(array.map(...)) is last-wins by JS Map semantics), not a chosen business rule",
  );
});

// ── C18: the POS grid's category grouping (behaviour, not source text) ──
// CB-DL-2 moved the server's PRODUCT_LIST sort to {name:1}, which dropped the
// grid's grouping. These pin the RULE that restores it; the wiring (that
// ProductGrid actually calls it) is pinned in category-readers-pins.test.ts.

const DRINKS = category({ _id: "64f0000000000000000000d1", name: "Drinks", order: 2 });
const FOOD = category({ _id: "64f0000000000000000000f1", name: "Food", order: 1 });

function product(name: string, categoryId?: string) {
  return { _id: `p-${name}`, name, categoryId };
}

test("sortProductsByCategoryOrder: groups by the category's display order, NOT by the category name", () => {
  // "Drinks" sorts before "Food" alphabetically, but the operator put Food
  // first (order 1). The grouping must follow the operator, not the alphabet.
  const map = buildCategoryMap([DRINKS, FOOD]);
  const sorted = sortProductsByCategoryOrder(
    [product("Cola", DRINKS._id), product("Burger", FOOD._id)],
    map,
  );
  assert.deepEqual(
    sorted.map((p) => p.name),
    ["Burger", "Cola"],
    "Food (order 1) must group before Drinks (order 2) even though 'Drinks' < 'Food' alphabetically",
  );
});

// The test above cannot tell category grouping apart from a plain alphabetical
// sort — "Burger" precedes "Cola" under BOTH rules. This one makes the two
// orderings DISAGREE: the product in the first category group is the one whose
// name sorts last, so a flat name sort produces the opposite sequence.
test("sortProductsByCategoryOrder: category order BEATS product name when the two disagree", () => {
  const map = buildCategoryMap([DRINKS, FOOD]);
  const sorted = sortProductsByCategoryOrder(
    // "Apple juice" is in Drinks (order 2); "Zinger burger" is in Food
    // (order 1). Alphabetically Apple < Zinger, but Food groups first.
    [product("Apple juice", DRINKS._id), product("Zinger burger", FOOD._id)],
    map,
  );
  assert.deepEqual(
    sorted.map((p) => p.name),
    ["Zinger burger", "Apple juice"],
    "the Food group (order 1) must come first even though its product name sorts LAST alphabetically — a flat name sort would return the reverse",
  );
});

test("sortProductsByCategoryOrder: products inside one category tie-break by name", () => {
  const map = buildCategoryMap([FOOD]);
  const sorted = sortProductsByCategoryOrder(
    [product("Samosa", FOOD._id), product("Bhaji", FOOD._id), product("Dosa", FOOD._id)],
    map,
  );
  assert.deepEqual(sorted.map((p) => p.name), ["Bhaji", "Dosa", "Samosa"], "one group must be ordered by product name");
});

test("sortProductsByCategoryOrder: a product whose category is missing or unresolvable sorts AFTER every real group", () => {
  const map = buildCategoryMap([FOOD, DRINKS]);
  // Names chosen so alphabetical order is the OPPOSITE of the expected order:
  // the ungrouped products sort FIRST by name ("Aaa"/"Bbb") but must land
  // LAST; the grouped ones sort last by name but must come first.
  const sorted = sortProductsByCategoryOrder(
    [
      product("Aaa mystery", "64f000000000000000000dead"), // resolves to nothing
      product("Bbb no category", undefined),
      product("Yyy burger", FOOD._id),
      product("Zzz cola", DRINKS._id),
    ],
    map,
  );
  assert.deepEqual(
    sorted.slice(0, 2).map((p) => p.name),
    ["Yyy burger", "Zzz cola"],
    "real groups must come first in category order, even though their names sort AFTER the ungrouped ones",
  );
  assert.deepEqual(
    sorted.slice(2).map((p) => p.name),
    ["Aaa mystery", "Bbb no category"],
    "unresolvable and absent categories must fall to the end, tie-broken by name — never jump to the front on an alphabetical sort",
  );
});

test("sortProductsByCategoryOrder: does not mutate the input array", () => {
  const map = buildCategoryMap([FOOD, DRINKS]);
  const input = [product("Cola", DRINKS._id), product("Burger", FOOD._id)];
  const before = input.map((p) => p.name);
  sortProductsByCategoryOrder(input, map);
  assert.deepEqual(input.map((p) => p.name), before, "the caller's array must be left untouched (the grid memo reuses it)");
});
