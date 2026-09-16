import { UNCATEGORIZED } from "@/lib/constants";
import type { Category } from "@/types";

// Pure client-side join helper (CB-DL-2 D-A5): Product only carries a
// `categoryId` now, so every reader needs the live categories list to show a
// name. Kept dependency-free (no React/Mongoose) so it can be unit-tested and
// reused from both hooks and plain functions.

// Keyed by `_id` — the only field a Product's `categoryId` can match against.
export function buildCategoryMap(categories: Category[]): Map<string, Category> {
  return new Map(categories.map((c) => [c._id, c]));
}

// Resolves a product's categoryId to its display name, falling back to the
// shared UNCATEGORIZED constant when the id is missing or matches no known
// category (deleted/never-migrated).
export function categoryNameOf(
  map: Map<string, Category>,
  categoryId: string | undefined,
): string {
  if (!categoryId) return UNCATEGORIZED;
  return map.get(categoryId)?.name ?? UNCATEGORIZED;
}

// Products whose category cannot be resolved sort after every real group
// rather than jumping to the front of the grid.
const UNGROUPED_SORT_ORDER = Number.MAX_SAFE_INTEGER;

// C18: CB-DL-2 moved the server's PRODUCT_LIST sort to {name:1}, which dropped
// the POS grid's category grouping. This restores it client-side, keyed on the
// category's display `order` — the operator's hand arrangement from the
// Categories screen — never on the category NAME, which would re-order that
// arrangement alphabetically. Products inside one group tie-break by name.
// Pure and exported so the grouping rule is testable on its own; the grid
// calls it rather than inlining a comparator a source pin could only
// text-match (a text pin cannot tell a live sort from an unreachable one).
export function sortProductsByCategoryOrder<T extends { categoryId?: string; name: string }>(
  products: readonly T[],
  map: Map<string, Category>,
): T[] {
  return [...products].sort((a, b) => {
    const orderA = (a.categoryId ? map.get(a.categoryId)?.order : undefined) ?? UNGROUPED_SORT_ORDER;
    const orderB = (b.categoryId ? map.get(b.categoryId)?.order : undefined) ?? UNGROUPED_SORT_ORDER;
    return orderA !== orderB ? orderA - orderB : a.name.localeCompare(b.name);
  });
}
