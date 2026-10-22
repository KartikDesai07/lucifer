"use client";

import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { POS_CARD_GRID_CLASS, POS_TOOLBAR_CLASS, POS_LIST_CLASS } from "@/lib/pos-layout";
import { useSettings } from "@/hooks/use-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { ALL_CATEGORIES, CategorySheet, type CategoryPickerProps } from "@/components/pos/CategorySidebar";
import { CARD_SHELL_CLASS, PRICE_HEIGHT_CLASS, PRICE_STRIP_CLASS, ProductCard } from "@/components/pos/ProductCard";
import { useCategoryMap } from "@/hooks/use-category-map";
import { useMenuFreshness } from "@/hooks/use-menu-freshness";
import { categoryNameOf, sortProductsByCategoryOrder } from "@/lib/category-map";
import { groupProductsByCategory } from "@/lib/pos-category-groups";
import { categoryHueMap } from "@/lib/pos-categories";
import type { Category, Product } from "@/types";

interface ProductGridProps {
  products: Product[];
  selectedCategory: string;
  // A price button's add (owner Q5): the product and the tapped button's variation.
  onProductClick: (product: Product, variation?: string) => void;
  // Opens the modifier modal for ANY product (even one with no modifiers) so
  // staff can attach a note or a non-default qty to an otherwise plain item:
  // the card's name, and the "Choose" button of an item with more than three sizes.
  onProductOptions: (product: Product) => void;
  // Per-product qty already in the cart — the tile's "yes, it went in" signal
  // on touch layouts where the cart is off-screen. Owned by the page, derived
  // from the cart lines.
  qtyByProduct?: Record<string, number>;
  // A send is in flight: the tiles are inert (no line can join a request that
  // already left), while the list itself still scrolls.
  disabled?: boolean;
  // The page's category picker: the toolbar's Category button + sheet below 1100px share it with the column.
  categoryPicker: CategoryPickerProps;
}

// The HTML's search box (values 3.1): flex 1, 36px, 0 10px, 1px --border, radius 8, on --surface; the 15px magnifier
// 8px from the field, which is 14px (16px below 720px, ruling R36), no focus look; the "/" chip from 720px (11px
// --text-3, 1px --border, radius 4, 0 5px, line-height 16px). Chrome's own clear button is hidden (the HTML's field has
// none; U0's staff search does the same).
const SEARCH_BOX_CLASS = "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-border bg-card px-2.5";
const SEARCH_INPUT_CLASS =
  "min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px text-[14px] leading-[normal] text-foreground outline-none placeholder:text-subtle-foreground max-tab:text-base [&::-webkit-search-cancel-button]:appearance-none";
const SLASH_CHIP_CLASS =
  "hidden rounded-[4px] border border-border px-[5px] text-[11px] leading-4 text-subtle-foreground tab:inline";

// The HTML's group heading (values 4.1): the 8px dot, the name and the count 8px apart, 13.5px/600; 4px above (it
// collapses through the section onto the list's padding) and 10px above the cards.
const GROUP_HEADING_CLASS = "mt-1 mb-2.5 flex items-center gap-2 text-[13.5px] font-semibold text-foreground";
// The HTML's no-results line (values 3.1): centred, 14px --text-2, 64px above and below — also our empty category and
// the load error (design 6.3).
const MENU_MESSAGE_CLASS = "py-16 text-center text-[14px] text-muted-foreground";

const NO_CATEGORIES: Category[] = [];
const IGNORE_SEARCH = () => {};

interface MenuToolbarProps {
  search: string;
  onSearchChange: (search: string) => void;
  categoryPicker: CategoryPickerProps;
  // While the products load: the search box and the Category button show, and take no input.
  loading?: boolean;
  // The row's right end: the spoken item count, or "Couldn't refresh · Try again".
  status?: ReactNode;
}

/** The HTML's toolbar (values 3.1): sticky at the top of the menu column, the list scrolls under it. */
function MenuToolbar({ search, onSearchChange, categoryPicker, loading = false, status }: MenuToolbarProps) {
  return (
    <div data-ui="pos-toolbar" className={POS_TOOLBAR_CLASS}>
      <div data-ui="pos-toolbar-row" className="flex items-center gap-2">
        <label data-ui="pos-search-box" className={SEARCH_BOX_CLASS}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            className="flex-none text-subtle-foreground"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          {/* type="search" gives the phone keyboard a Search key; data-ui is what the "/" key focuses (U1 Task 5). */}
          <input
            type="search"
            data-ui="pos-search"
            enterKeyHint="search"
            autoComplete="off"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={loading}
            placeholder="Search items"
            aria-label="Search items"
            className={SEARCH_INPUT_CLASS}
          />
          <span aria-hidden="true" data-ui="pos-search-slash" className={SLASH_CHIP_CLASS}>
            /
          </span>
        </label>
        {status}
      </div>
      <CategorySheet {...categoryPicker} disabled={loading} />
    </div>
  );
}

/** A group's dot (values 4.1): the category's own hue from the column (Task 2's rows), --text-3 for "Other". */
function GroupDot({ hue }: { hue: string | null }) {
  return (
    <span
      aria-hidden="true"
      data-ui="pos-group-dot"
      className={cn("size-2 flex-none rounded-[50%]", hue === null && "bg-subtle-foreground")}
      style={hue === null ? undefined : { background: hue }}
    />
  );
}

// Category-filtered, name-searchable menu of the HTML's item cards (U1 Task 3, values 4.1-4.6): one grid in the Normal
// layout, the HTML's groups in "By category" (owner Q8). A price adds through the parent, the name opens its modal.
export function ProductGrid({
  products,
  selectedCategory,
  onProductClick,
  onProductOptions,
  qtyByProduct,
  disabled = false,
  categoryPicker,
}: ProductGridProps) {
  const [search, setSearch] = useState("");
  // Menu B2 — re-reads the menu when New Order opens / is focused again; the
  // grid stays up when a refresh fails (only the count slot below changes).
  const { refreshFailed, retry } = useMenuFreshness();
  const { map: categoryMap, isLoading: categoriesLoading } = useCategoryMap();
  // Absent (a pre-existing Settings doc) reads as "normal" — same lean-doc
  // discipline as every other optional Settings field.
  const byCategory = useSettings().data?.posLayout === "byCategory";
  // Each group's dot is its category's dot in the column (by its place among all the categories).
  const categories = categoryPicker.categories ?? NO_CATEGORIES;
  const hues = useMemo(() => categoryHueMap(categories), [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = products.filter((p) => {
      const inCategory =
        selectedCategory === ALL_CATEGORIES || p.categoryId === selectedCategory;
      const matches = q === "" || p.name.toLowerCase().includes(q);
      return inCategory && matches;
    });
    // The category map loads independently of the product list (separate
    // bootstrap keys), so it can still be empty on the very first paint even
    // though products already arrived. Grouping by order now would put every
    // tile under the UNCATEGORIZED fallback, then jump once the map lands —
    // hold the server's own {name:1} order (already what `products` arrives
    // in) for that one render instead of sorting against an empty map.
    if (categoriesLoading) return matching;
    // Grouped by the category's own display `order` (never its name — order
    // preserves the operator's hand arrangement from the Categories screen),
    // then by product name inside each group. The rule itself lives in
    // lib/category-map.ts so it can be unit-tested as pure data.
    return sortProductsByCategoryOrder(matching, categoryMap);
  }, [products, selectedCategory, search, categoryMap, categoriesLoading]);

  // "By category" (owner decision, UI batch 1 §H): the SAME `filtered` list
  // (already in category-order — see the comment above) split into
  // contiguous per-category runs. One category selected or a search active
  // narrows `filtered` first, so this naturally yields one heading for a
  // single-category view. Skipped entirely in "normal" mode/while categories
  // are loading — a flat grid needs no groups computed.
  const groups = useMemo(
    () => (byCategory && !categoriesLoading ? groupProductsByCategory(filtered, categoryMap) : null),
    [byCategory, categoriesLoading, filtered, categoryMap],
  );

  return (
    <>
      {/* What the category + search filter shows, read to screen readers (design 6.3: the counts show in the category
          list and the group headings); when a menu refresh failed but the grid still has data, "Couldn't refresh · Try
          again" shows at the row's right where the HTML's diet filter sits (13px --bad-i link; its 44px hit area
          overhangs the 36px row). The span leaves the row while it holds only the spoken count. */}
      <MenuToolbar
        search={search}
        onSearchChange={setSearch}
        categoryPicker={categoryPicker}
        status={
          <span aria-live="polite" className="sr-only has-[button]:not-sr-only has-[button]:flex-none">
            {refreshFailed ? (
              <button
                type="button"
                data-ui="pos-menu-retry"
                className={cn("-my-1 min-h-11 whitespace-nowrap bg-transparent px-1 text-[13px] font-medium text-status-bad-ink", BRAND_PRESS_CLASS)}
                onClick={retry}
              >
                Couldn&apos;t refresh · Try again
              </button>
            ) : (
              <>
                {filtered.length} {filtered.length === 1 ? "item" : "items"}
              </>
            )}
          </span>
        }
      />

      {/* The HTML's list wrapper (values 3.1 listPad); main (the menu column) is the one scroller. */}
      <div data-ui="pos-list" className={POS_LIST_CLASS}>
        {filtered.length === 0 ? (
          <p data-ui="pos-menu-message" className={MENU_MESSAGE_CLASS}>
            {search.trim() === "" ? "No products found" : `No results for “${search}”`}
          </p>
        ) : groups ? (
          groups.map((group) => (
            <section key={group.categoryId ?? "other"} data-ui="pos-group" className="mb-6">
              {/* role=heading + aria-level (not a literal <h3>): this list
                  sits inside a page that already has its own heading
                  hierarchy, so the level is asserted rather than assumed. */}
              <div
                role="heading"
                aria-level={3}
                aria-label={`${group.heading}, ${group.items.length} ${group.items.length === 1 ? "item" : "items"}`}
                data-ui="pos-group-heading"
                className={GROUP_HEADING_CLASS}
              >
                <GroupDot hue={group.categoryId === null ? null : (hues.get(group.categoryId) ?? null)} />
                {group.heading}
                <span data-ui="pos-group-count" className="font-normal text-subtle-foreground">
                  {group.items.length}
                </span>
              </div>
              <div className={cn(POS_CARD_GRID_CLASS, disabled && "opacity-50")} inert={disabled}>
                {group.items.map((product) => (
                  <ProductCard
                    key={product._id}
                    product={product}
                    // Every tile already sits under its own category's
                    // heading here — repeating the name on the tile too
                    // would just say the same thing twice.
                    showCategory={false}
                    categoryLabel={categoryNameOf(categoryMap, product.categoryId)}
                    qty={qtyByProduct?.[product._id] ?? 0}
                    onAdd={onProductClick}
                    onOptions={onProductOptions}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className={cn(POS_CARD_GRID_CLASS, disabled && "opacity-50")} inert={disabled}>
            {filtered.map((product) => (
              <ProductCard
                key={product._id}
                product={product}
                // Browsing "All" mixes every category together, so each tile
                // says which one it belongs to. Inside a category that line
                // would repeat the rail selection on every tile — drop it.
                showCategory={selectedCategory === ALL_CATEGORIES}
                categoryLabel={categoryNameOf(categoryMap, product.categoryId)}
                qty={qtyByProduct?.[product._id] ?? 0}
                onAdd={onProductClick}
                onOptions={onProductOptions}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// How many loading cards fill the first screen of the grid.
const SKELETON_CARDS = 12;

/** A loading card (design 6.3): the real card's shell with bars as tall as the name (19px) and the tag (16px), 2px
 *  apart, over its price strip, so it is the card's 117px (123px below 1100px) and nothing jumps when the menu lands. */
function CardSkeleton() {
  return (
    <div aria-hidden="true" data-ui="pos-card-skeleton" className={cn(CARD_SHELL_CLASS, "border-border")}>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-[19px] w-3/5" />
        <Skeleton className="h-4 w-2/5" />
      </div>
      <div className={PRICE_STRIP_CLASS}>
        <div className={PRICE_HEIGHT_CLASS} />
      </div>
    </div>
  );
}

// Loading placeholder for the grid above (moved here from pos/page.tsx in CR1.5 Slice 2, line-budget extraction): the
// toolbar as it will stand (no input until the products arrive), then HTML-shaped cards in the same grid — with a
// heading's room first in "By category", where the first group's heading will sit.
export function GridSkeleton({ categoryPicker }: { categoryPicker: CategoryPickerProps }) {
  const byCategory = useSettings().data?.posLayout === "byCategory";
  return (
    <>
      <MenuToolbar search="" onSearchChange={IGNORE_SEARCH} categoryPicker={categoryPicker} loading />
      <div data-ui="pos-list" aria-busy="true" className={POS_LIST_CLASS}>
        {byCategory && <Skeleton aria-hidden="true" className={cn(GROUP_HEADING_CLASS, "h-[18px] w-40")} />}
        <div className={POS_CARD_GRID_CLASS}>
          {Array.from({ length: SKELETON_CARDS }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </>
  );
}

/** The page's load error (design 6.3): "Failed to load products. Refresh to retry." in the HTML's no-results look. */
export function MenuLoadError() {
  return (
    <div data-ui="pos-list" className={POS_LIST_CLASS}>
      <p data-ui="pos-menu-message" className={MENU_MESSAGE_CLASS}>
        Failed to load products. Refresh to retry.
      </p>
    </div>
  );
}
