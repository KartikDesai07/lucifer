import type { Category } from "@/types";

// UI batch 1 §H — "By category" New Order grid grouping (pure, unit-tested).
// Every product joins its own category's group, and the groups come out in
// the Categories-screen order: Category.order, then the category name — the
// same { order: 1, name: 1 } the categories master list is read with
// (lib/masters.ts CATEGORY_LIST). Bucketing by category, not by contiguous
// runs of the product sort, is what keeps one heading per category when two
// categories share an `order` (the schema default is 0 for every category, so
// ties are the common case): sortProductsByCategoryOrder breaks those ties by
// PRODUCT name, which interleaves the two categories. Items inside a group
// keep the order they were passed in (today's grid order). A product whose
// category does not resolve joins one trailing "Other" group.

export interface PosCategoryGroup<T> {
  categoryId: string | null; // null for the trailing "Other" (uncategorised) group
  heading: string; // the category's name, or OTHER_CATEGORY_HEADING
  items: T[];
}

// The heading shown for products with no resolvable category — plain English,
// distinct from the tile-level UNCATEGORIZED fallback label.
export const OTHER_CATEGORY_HEADING = "Other";

/** Mongo's default string order is by code unit, not locale — compare the same way. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function groupProductsByCategory<T extends { categoryId?: string; name: string }>(
  products: readonly T[],
  categoryMap: Map<string, Category>,
): PosCategoryGroup<T>[] {
  const byCategory = new Map<string, { meta: Category; items: T[] }>();
  const other: T[] = [];

  for (const product of products) {
    const category = product.categoryId ? categoryMap.get(product.categoryId) : undefined;
    if (!category) {
      other.push(product);
      continue;
    }
    const bucket = byCategory.get(category._id);
    if (bucket) bucket.items.push(product);
    else byCategory.set(category._id, { meta: category, items: [product] });
  }

  const groups: PosCategoryGroup<T>[] = [...byCategory.values()]
    .sort((a, b) => a.meta.order - b.meta.order || byCodeUnit(a.meta.name, b.meta.name))
    .map(({ meta, items }) => ({ categoryId: meta._id, heading: meta.name, items }));
  if (other.length > 0) groups.push({ categoryId: null, heading: OTHER_CATEGORY_HEADING, items: other });
  return groups;
}
