import { categoryNameOf } from "@/lib/category-map";
import type { Category, Product } from "@/types";

// CB-UI2 (owner request 2026-09-23) — column sorting for the Menu list. Pure:
// the page owns the {key, dir} state, this module owns the ORDER, so the rule
// is unit-testable and the table stays presentational.
//
// The default (category, then name) is the "grouped by category" look the page has always had; since U5 (owner Q1) the
// categories come in their ARRANGED order (the Categories screen's drag order, as New Order), not alphabetically.

export const PRODUCT_SORT_KEYS = ["name", "category", "price", "available"] as const;
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

export interface ProductSort {
  key: ProductSortKey;
  dir: SortDirection;
}

export const DEFAULT_PRODUCT_SORT: ProductSort = { key: "category", dir: "asc" };

// A variations product has no single price — it sells across a RANGE, and the
// table prints that range. Sorting keys on the CHEAPEST variation so the
// number a row is ordered by is one the operator can actually see in it.
export function sortPriceOf(product: Product): number {
  const variations = product.variations ?? [];
  if (variations.length === 0) return product.price;
  return Math.min(...variations.map((v) => v.price));
}

// `available` is absent-means-true on this model (only an explicit false marks
// an item "86"), so normalise before comparing — otherwise undefined sorts
// unpredictably against the booleans.
function availableOf(product: Product): number {
  return product.available === false ? 0 : 1;
}

// Every comparison ends in a name tiebreak so equal keys (same category, same
// price, same availability) keep a STABLE, human-readable order rather than
// whatever order the fetch happened to return.
function compareBy(key: ProductSortKey, a: Product, b: Product, categoryMap: Map<string, Category>): number {
  if (key === "name") return a.name.localeCompare(b.name);
  if (key === "price") return sortPriceOf(a) - sortPriceOf(b);
  if (key === "available") return availableOf(a) - availableOf(b);
  // U5 Q1: the default is the categories' ARRANGED order (the operator's drag arrangement, the order New Order shows),
  // an unknown category last; the category NAME only breaks a tie between two categories that share an order.
  const byOrder = categoryOrderOf(a, categoryMap) - categoryOrderOf(b, categoryMap);
  if (byOrder !== 0) return byOrder;
  return categoryNameOf(categoryMap, a.categoryId).localeCompare(categoryNameOf(categoryMap, b.categoryId));
}

const UNKNOWN_CATEGORY_ORDER = Number.MAX_SAFE_INTEGER;
function categoryOrderOf(product: Product, categoryMap: Map<string, Category>): number {
  return categoryMap.get(product.categoryId)?.order ?? UNKNOWN_CATEGORY_ORDER;
}

// Returns a NEW array — never sorts the caller's (a TanStack query's cached
// data array must never be mutated in place).
export function sortProducts(
  products: readonly Product[],
  sort: ProductSort,
  categoryMap: Map<string, Category>,
): Product[] {
  const sign = sort.dir === "desc" ? -1 : 1;
  return [...products].sort((a, b) => {
    const primary = compareBy(sort.key, a, b, categoryMap);
    if (primary !== 0) return primary * sign;
    // The tiebreak is NOT inverted by `dir`: descending price still reads
    // A→Z within one price, which is what an operator scanning a column wants.
    return sort.key === "name" ? 0 : a.name.localeCompare(b.name);
  });
}

// Tapping the active column flips direction; tapping a new one starts it
// ascending (the direction an operator expects from a fresh column).
export function nextProductSort(current: ProductSort, key: ProductSortKey): ProductSort {
  if (current.key !== key) return { key, dir: "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}
