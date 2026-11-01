// The Menu screens' words and counts (U5 Task 1; the HTML's Menu: values 2 header line, 3 rail counts, 4.4 filter words,
// 4.6 title row, 4.7 empty box; design 6.1, 6.3, 6.8). Pure: no React, so node tests import it.
import { isHiddenFromQr, isOutOfStock, priceDisplayOf, type MenuStatusFilter } from "@/lib/menu-items";
import type { Category, Product, ProductBulkResult } from "@/types";

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

// ── The list's rows (U5 Task 2; values 5.2 Price / Name, 7.1 badges, 8 bulk toasts; design 6.4-6.7, 12) ──────────────────

const rupees = (n: number): string => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const priceRange = (min: number, max: number): string => (min === max ? `₹${rupees(min)}` : `₹${rupees(min)}–${rupees(max)}`);

/** The price cell (values 5.2): "₹229", or "₹249–449" for sizes (an en dash, one ₹, equal sizes collapse), Indian grouping;
 *  `struck` is the undiscounted text of a discounted item (today's rule R11, ours: the HTML has no discounts). */
export function menuPriceText(p: Product): { text: string; struck?: string } {
  const d = priceDisplayOf(p);
  const text = priceRange(d.min, d.max);
  return d.discount > 0 ? { text, struck: priceRange(d.raw.min, d.raw.max) } : { text };
}

/** The line under the name (values 5.2): "Single price" (no sizes, or one named Standard), the size names joined by " · ",
 *  or the one size's name, then today's " · {m} modifier(s)". */
export function menuSizesText(p: Product): string {
  const names = (p.variations ?? []).map((v) => v.name);
  const sizes = names.length === 0 || (names.length === 1 && names[0] === "Standard") ? "Single price" : names.join(" · ");
  const m = p.modifiers.length;
  return m > 0 ? `${sizes} · ${countLabel(m, "modifier")}` : sizes;
}

export type MenuItemBadge = "sold-out" | "hidden" | "archived" | "no-kot";

/** The badges a row shows, in the HTML's order (values 7.1) with ours (No KOT) last. `skipsKitchen` is the caller's
 *  `itemSkipsKitchen` (it needs the category map). Popular and New are not drawn: we have no such data (design 9). */
export function menuItemBadges(p: Product, ctx: { archived: boolean; skipsKitchen?: boolean }): MenuItemBadge[] {
  const out: MenuItemBadge[] = [];
  if (isOutOfStock(p)) out.push("sold-out");
  if (isHiddenFromQr(p)) out.push("hidden");
  if (ctx.archived) out.push("archived");
  if (ctx.skipsKitchen) out.push("no-kot");
  return out;
}

/** The bulk toast (design 6.7, 12): the HTML's words for sold out / back in stock (design 12), today's words for the rest, with the counts, which are the items the action applied to
 *  (`matched`), singular right. */
export function bulkToastText(result: ProductBulkResult, action: string = result.action): string {
  const n = result.matched;
  const items = countLabel(n, "item");
  switch (action) {
    case "out-of-stock":
      return `${items} marked sold out`;
    case "in-stock":
      return `${items} back in stock`;
    case "move":
      return `Moved ${items}`;
    case "archive":
      return `Archived ${items}`;
    case "restore":
      return `Restored ${items}`;
    default:
      return `Updated ${items}`;
  }
}

// ── The Categories view (U5 Task 4; values 11, 10; design 6.10, 12) ───────────────────────────────────────────────────

/** A row's meta (values 11): "{n} item(s)[ · {o} sold out][ · {a} archived]", plus " · No KOT" on a phone only (the chip is
 *  not drawn there). */
export function categoryMetaText(c: { items: number; soldOut: number; archived: number; noKot: boolean; phone: boolean }): string {
  let text = countLabel(c.items, "item");
  if (c.soldOut > 0) text += ` · ${c.soldOut} sold out`;
  if (c.archived > 0) text += ` · ${c.archived} archived`;
  if (c.phone && c.noKot) text += " · No KOT";
  return text;
}

/** The category toasts (design 12, values 10 and 11): the HTML's words with the name; the error words stay today's. */
export const categoryAddedToast = (name: string): string => `${name} added · add items to it from Items`;
export const categorySavedToast = (name: string): string => `${name} saved`;
export const categoryDeletedToast = (name: string): string => `${name} deleted`;

/** Per category id: its sold-out items in the active list (the meta's "· n sold out"). */
export function soldOutByCategory(active: readonly Product[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of active) if (isOutOfStock(p)) out.set(p.categoryId, (out.get(p.categoryId) ?? 0) + 1);
  return out;
}

/** /categories' header line: the Menu's (design 6.1) from the active items; "Loading items…" while they or the categories
 *  load; undefined (the shell's default line) when the items read failed on first load, as the Items page (T1 logic-1). */
export function categoriesHeaderLine(input: {
  products: { data: readonly Product[] | undefined; isError: boolean };
  categories: number;
  categoriesLoading: boolean;
}): string | undefined {
  if (input.products.isError && input.products.data === undefined) return undefined;
  const counts = menuHeaderCounts(input.products.data);
  return counts && !input.categoriesLoading ? menuHeaderLine({ ...counts, categories: input.categories }) : MENU_LOADING_LINE;
}
