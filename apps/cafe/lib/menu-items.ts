// Pure logic for the Items page (Menu redesign, 2026-09-30): status filters,
// search/category filtering, per-status counts, the row sub-line, and price
// display. NO React, NO @/hooks/use-cart import (that hook is POS-cart-scoped
// and this module must stay importable from a plain node:test file).
import { effectiveUnitPrice } from "@pos/shared/public";
import { categoryNameOf } from "@/lib/category-map";
import type { Category, Product } from "@/types";

export const MENU_STATUS_FILTERS = ["all", "out-of-stock", "hidden", "archived"] as const;
export type MenuStatusFilter = (typeof MENU_STATUS_FILTERS)[number];

export function isMenuStatusFilter(value: unknown): value is MenuStatusFilter {
  return (MENU_STATUS_FILTERS as readonly string[]).includes(value as string);
}

// Same rule as the dashboard "needs attention" strip (lib/dashboard/live.ts):
// out of stock = active AND available===false.
export function isOutOfStock(p: Product): boolean {
  return p.isActive !== false && p.available === false;
}

// Hidden from the public QR menu — publicVisible is omit-empty (absent/true =
// shown), so only an explicit false counts.
export function isHiddenFromQr(p: Product): boolean {
  return p.publicVisible === false;
}

interface FilterInput {
  search: string;
  categoryId: string | null; // null = all categories
  status: MenuStatusFilter;
}

// Search + category match a row regardless of status; status narrows on top.
// `archived` status is meaningless against the active list — the Items page
// only applies it while viewing the archived query, where every row already
// qualifies (see statusCounts below for the same split).
function matchesSearchAndCategory(p: Product, input: Pick<FilterInput, "search" | "categoryId">): boolean {
  const q = input.search.trim().toLowerCase();
  const matchesSearch = q === "" || p.name.toLowerCase().includes(q);
  const matchesCategory = input.categoryId === null || p.categoryId === input.categoryId;
  return matchesSearch && matchesCategory;
}

function matchesStatus(p: Product, status: MenuStatusFilter): boolean {
  if (status === "all") return true;
  if (status === "out-of-stock") return isOutOfStock(p);
  if (status === "hidden") return isHiddenFromQr(p);
  // "archived" is applied at the query level (the Items page swaps to the
  // archived list), never as a client-side isActive filter here.
  return true;
}

// `products` is whichever list is currently loaded (active or archived) — the
// page decides which query to filter, this function only narrows it further.
export function filterItems(products: readonly Product[], input: FilterInput): Product[] {
  return products.filter((p) => matchesSearchAndCategory(p, input) && matchesStatus(p, input.status));
}

export interface MenuStatusCounts {
  all: number;
  outOfStock: number;
  hidden: number;
}

// Counts follow the search + category filters (so they always describe what
// "All" would currently show), but never the status filter itself — each
// count is of the OTHER statuses reachable from here.
export function statusCounts(products: readonly Product[], search: string, categoryId: string | null): MenuStatusCounts {
  const scoped = products.filter((p) => matchesSearchAndCategory(p, { search, categoryId }));
  return {
    all: scoped.length,
    outOfStock: scoped.filter(isOutOfStock).length,
    hidden: scoped.filter(isHiddenFromQr).length,
  };
}

// R11 — the effective (discounted) price per size. A variations item shows
// the min-max RANGE of each size's effective price; a plain item shows one
// effective price. `raw` is the pre-discount figure(s) to strike through when
// discount > 0 — callers render `raw` struck out only when `discount > 0`.
export interface MenuItemPriceDisplay {
  min: number;
  max: number;
  raw: { min: number; max: number };
  hasRange: boolean;
  discount: number;
}

export function priceDisplayOf(product: Product): MenuItemPriceDisplay {
  const variations = product.variations ?? [];
  if (variations.length > 0) {
    const effective = variations.map((v) => effectiveUnitPrice(v.price, product.discount));
    const raw = variations.map((v) => v.price);
    return {
      min: Math.min(...effective),
      max: Math.max(...effective),
      raw: { min: Math.min(...raw), max: Math.max(...raw) },
      hasRange: true,
      discount: product.discount,
    };
  }
  const effective = effectiveUnitPrice(product.price, product.discount);
  return {
    min: effective,
    max: effective,
    raw: { min: product.price, max: product.price },
    hasRange: false,
    discount: product.discount,
  };
}

// The row sub-line: category-less context under the name — size count and
// modifier count, e.g. "3 sizes · 2 modifiers" (the editor field and the
// approved M1 preview both say "modifiers", never "add-ons"). Omits a clause
// that doesn't apply; returns "" (never a dangling separator) when neither
// applies.
export function itemSubLine(product: Product): string {
  const parts: string[] = [];
  const sizeCount = product.variations?.length ?? 0;
  if (sizeCount > 0) parts.push(`${sizeCount} size${sizeCount === 1 ? "" : "s"}`);
  if (product.modifiers.length > 0) {
    parts.push(`${product.modifiers.length} modifier${product.modifiers.length === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export function categoryLabelOf(map: Map<string, Category>, categoryId: string): string {
  return categoryNameOf(map, categoryId);
}
