// U1 Task 2 (2026-10-21): the category rows the /pos category column and the "Category" sheet draw (values 2.1-2.3 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.3; owner Q15): "All items" with the count of every
// product /pos shows, then our categories in their own order, each with its product count and a dot in the HTML's five
// hues by its position; "Find category" keeps the matching rows (and their colours) and drops "All items".
import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_ITEMS_LABEL, POS_CATEGORY_HUES, categoryHueMap, categoryRows, selectedCategoryName } from "./pos-categories";

const CATS = [
  { _id: "c-starters", name: "Starters" },
  { _id: "c-pizza", name: "Pizza" },
  { _id: "c-cold", name: "Cold Beverages" },
];
const PRODUCTS = [
  { categoryId: "c-starters" },
  { categoryId: "c-pizza" },
  { categoryId: "c-starters" },
  { categoryId: "c-cold" },
  { categoryId: "c-gone" }, // a category deleted since: counted in "All items" only
];

test("POS_CATEGORY_HUES: the HTML's five section hues, in the HTML's order (Starters, Mains, Sides, Drinks, Desserts)", () => {
  assert.deepEqual([...POS_CATEGORY_HUES], ["#E8590C", "#C92A2A", "#D19A00", "#1C7ED6", "#AE3EC9"], "values 2.3 SEC_HUE, in turn");
  assert.equal(ALL_ITEMS_LABEL, "All items", "the HTML's word for every item (owner Q1)");
});

test("categoryRows: no query gives \"All items\" first (every product, no dot), then each category in order with its count and hue", () => {
  const rows = categoryRows(CATS, PRODUCTS, "");
  assert.deepEqual(
    rows,
    [
      { key: "All", name: "All items", count: 5, hue: null },
      { key: "c-starters", name: "Starters", count: 2, hue: "#E8590C" },
      { key: "c-pizza", name: "Pizza", count: 1, hue: "#C92A2A" },
      { key: "c-cold", name: "Cold Beverages", count: 1, hue: "#D19A00" },
    ],
    "All items counts every product /pos shows; a category counts its own products; hues go by position",
  );
});

test("categoryRows: a category with no products still shows, with 0", () => {
  const rows = categoryRows(CATS, [{ categoryId: "c-pizza" }], "");
  assert.deepEqual(
    rows.map((r) => [r.name, r.count]),
    [["All items", 1], ["Starters", 0], ["Pizza", 1], ["Cold Beverages", 0]],
    "every category is listed, empty ones with a 0 count",
  );
});

test("categoryRows: the hues repeat every five categories", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ _id: `c${i}`, name: `Cat ${i}` }));
  const hues = categoryRows(many, [], "").slice(1).map((r) => r.hue);
  assert.deepEqual(hues, [...POS_CATEGORY_HUES, POS_CATEGORY_HUES[0], POS_CATEGORY_HUES[1]], "the sixth takes the first hue again");
});

test("categoryRows: a query keeps the categories whose name contains it (any case, trimmed), drops \"All items\", keeps their hues", () => {
  assert.deepEqual(
    categoryRows(CATS, PRODUCTS, "pi"),
    [{ key: "c-pizza", name: "Pizza", count: 1, hue: "#C92A2A" }],
    "Pizza keeps its own (second) hue when the list is filtered",
  );
  assert.deepEqual(
    categoryRows(CATS, PRODUCTS, "  CoLD ").map((r) => r.key),
    ["c-cold"],
    "case-insensitive and trimmed, as the HTML's cq",
  );
  assert.deepEqual(
    categoryRows(CATS, PRODUCTS, "ev").map((r) => [r.key, r.hue]),
    [["c-cold", "#D19A00"]],
    "only names containing the letters match (Beverages), with the third hue",
  );
  assert.deepEqual(categoryRows(CATS, PRODUCTS, "s").map((r) => r.key), ["c-starters", "c-cold"], "several matches keep their order");
});

test("categoryRows: a query that matches nothing gives an empty list (the HTML shows no empty text)", () => {
  assert.deepEqual(categoryRows(CATS, PRODUCTS, "zzz"), [], "no row at all");
});

test("categoryRows: a blank query reads as no query", () => {
  assert.equal(categoryRows(CATS, PRODUCTS, "   ")[0]?.name, "All items", "spaces only: the full list with All items first");
});

test("categoryRows: no categories yet gives only \"All items\"", () => {
  assert.deepEqual(categoryRows([], PRODUCTS, ""), [{ key: "All", name: "All items", count: 5, hue: null }], "the loading menu");
});

test("selectedCategoryName: the Category button's value is \"All items\" or the chosen category's name", () => {
  assert.equal(selectedCategoryName(CATS, "All"), "All items", "the HTML's curCatName for All");
  assert.equal(selectedCategoryName(CATS, "c-pizza"), "Pizza", "a category by its id");
  assert.equal(selectedCategoryName(CATS, "c-gone"), "All items", "an id no longer in the list reads as All items");
});

// U1 Task 3 (design 6.4, values 4.1): the "By category" group headings take each category's dot from the same rule, so a
// group's dot is its row's dot in the column.
test("categoryHueMap: each category's hue is its row's hue in the column (by position, repeating every five)", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ _id: `c${i}`, name: `Cat ${i}` }));
  const map = categoryHueMap(many);
  for (const row of categoryRows(many, [], "").slice(1)) {
    assert.equal(map.get(row.key), row.hue, `${row.name}: the group's dot is the row's dot`);
  }
  assert.equal(map.size, 7, "every category has a hue");
  assert.equal(map.get("c-gone"), undefined, "an unknown category has none (the Other group draws --text-3)");
});
