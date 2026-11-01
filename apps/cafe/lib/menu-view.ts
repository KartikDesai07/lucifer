// The Menu screens' words and counts (U5 Task 1; the HTML's Menu: values 2 header line, 3 rail counts, 4.4 filter words,
// 4.6 title row, 4.7 empty box; design 6.1, 6.3, 6.8). Pure: no React, so node tests import it.
import { isOutOfStock, type MenuStatusFilter } from "@/lib/menu-items";
import type { Category, Product } from "@/types";

const countLabel = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The header's second line (values 2): "{n} items · {m} categories[ · {k} sold out]". */
export function menuHeaderLine(c: { items: number; categories: number; soldOut: number }): string {
  const line = `${countLabel(c.items, "item")} · ${countLabel(c.categories, "category", "categories")}`;
  return c.soldOut > 0 ? `${line} · ${c.soldOut} sold out` : line;
}

/** What the header line counts from the ACTIVE list (design 6.1): its items and its sold-out items; null while the list
 *  is not known (the page then says "Loading items…"). */
export function menuHeaderCounts(active: readonly Product[] | undefined): { items: number; soldOut: number } | null {
  if (!active) return null;
  return { items: active.length, soldOut: active.filter(isOutOfStock).length };
}

/** The header line while the list loads. */
export const MENU_LOADING_LINE = "Loading items…";

/** The filter select's words (values 4.4); the title row lower-cases them (values 4.6). */
export const MENU_FILTER_LABELS: Record<MenuStatusFilter, string> = {
  all: "All items",
  "in-stock": "In stock",
  "out-of-stock": "Sold out",
  hidden: "Hidden on QR menu",
  archived: "Archived",
};

/** The title row's count (values 4.6): "{n} item(s)" and " · {filter}" when the filter is not All. */
export function menuTitleCount(n: number, filter: MenuStatusFilter): string {
  const count = countLabel(n, "item");
  return filter === "all" ? count : `${count} · ${MENU_FILTER_LABELS[filter].toLowerCase()}`;
}

export interface MenuCategoryCounts {
  /** Per category id: its items and its sold-out items in the list on screen (0, never missing, for an empty one). */
  byId: Map<string, { items: number; soldOut: number }>;
  all: number;
  allSoldOut: number;
}

/** The rail's, the select's and the chips' counts, from the list on screen (the active list, or the archived one in the
 *  Archived view: the numbers always match the rows the page can show). */
export function categoryCounts(products: readonly Product[], categories: readonly Pick<Category, "_id">[]): MenuCategoryCounts {
  const byId = new Map<string, { items: number; soldOut: number }>(categories.map((c) => [c._id, { items: 0, soldOut: 0 }]));
  let allSoldOut = 0;
  for (const p of products) {
    const out = isOutOfStock(p);
    if (out) allSoldOut += 1;
    const row = byId.get(p.categoryId);
    if (!row) continue;
    row.items += 1;
    if (out) row.soldOut += 1;
  }
  return { byId, all: products.length, allSoldOut };
}

/** The refresh strip (design 6.8, U4 I1): only on a failed or paused read while the page has data to keep showing. */
export function menuStripShows(input: { hasData: boolean; isError: boolean; isPaused: boolean }): boolean {
  return input.hasData && (input.isError || input.isPaused);
}

export const MENU_STRIP_MESSAGE = "Couldn't refresh the menu. Showing the last update.";

/** The HTML's filtered-empty words (values 4.7): the query typed (trimmed, curly quotes) or "No items here". */
export function menuEmptyTitle(query: string): string {
  const q = query.trim();
  return q ? `No items match “${q}”` : "No items here";
}
export const MENU_EMPTY_SUB = "Try another search or filter.";
