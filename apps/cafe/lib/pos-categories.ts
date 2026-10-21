// The /pos category rows (U1 Task 2; the owner's HTML Order screen, values 2.1-2.3 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.3; owner Q15). Pure, so both presentations (the
// category column from 1100px and the toolbar's "Category" sheet below it) draw the same rows and the rules are tested
// without a renderer (lib/pos-categories.test.ts).
//
// The HTML lists "All items", "Popular" and its five menu sections with headings, a dot in each section's hue and no
// count on a category. We have no "Popular" and no sections (data, design 6.3), so the rows are "All items" with the
// count of every product /pos shows, then our categories in their own order (the categories query's {order, name}),
// each with its product count (owner Q15) and an 8px dot in the HTML's five hues in turn (decoration, not data).
import type { Category, Product } from "@/types";

/** The value "All items" selects (the grid shows every category). */
export const ALL_CATEGORIES = "All";

/** The HTML's words for every item (owner Q1). */
export const ALL_ITEMS_LABEL = "All items";

/** The HTML's section hues (values 2.3 SEC_HUE: Starters, Mains, Sides, Drinks, Desserts), given to our categories in
 *  turn by their position. */
export const POS_CATEGORY_HUES = ["#E8590C", "#C92A2A", "#D19A00", "#1C7ED6", "#AE3EC9"] as const;

/** One row of the list: `key` is what a pick selects (ALL_CATEGORIES or the category's _id); `hue` is null for
 *  "All items" (no dot). */
export interface CategoryRow {
  key: string;
  name: string;
  count: number;
  hue: string | null;
}

/** The rows for the find text `query`: with no query, "All items" (every product) then every category; with one, only
 *  the categories whose name contains it (any case; the HTML's trimmed, lower-cased `cq`), "All items" left out, each
 *  keeping the hue of its place among all the categories so a filter never recolours a row. No match: no rows. */
export function categoryRows(
  categories: readonly Pick<Category, "_id" | "name">[],
  products: readonly Pick<Product, "categoryId">[],
  query: string,
): CategoryRow[] {
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
  const q = query.trim().toLowerCase();
  const rows: CategoryRow[] = [];
  if (q === "") rows.push({ key: ALL_CATEGORIES, name: ALL_ITEMS_LABEL, count: products.length, hue: null });
  categories.forEach((c, i) => {
    if (q !== "" && !c.name.toLowerCase().includes(q)) return;
    rows.push({
      key: c._id,
      name: c.name,
      count: counts.get(c._id) ?? 0,
      hue: POS_CATEGORY_HUES[i % POS_CATEGORY_HUES.length],
    });
  });
  return rows;
}

/** The "Category" button's value (values 3.1 curCatName): "All items", or the chosen category's name. An id that is no
 *  longer in the list (or a list still loading) reads as "All items". */
export function selectedCategoryName(
  categories: readonly Pick<Category, "_id" | "name">[] | undefined,
  selected: string,
): string {
  if (selected === ALL_CATEGORIES) return ALL_ITEMS_LABEL;
  return categories?.find((c) => c._id === selected)?.name ?? ALL_ITEMS_LABEL;
}
