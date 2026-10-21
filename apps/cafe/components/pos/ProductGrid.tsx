"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import {
  POS_GRID_CLASS_SIDEBAR_EXPANDED,
  POS_GRID_CLASS_SIDEBAR_COLLAPSED,
  POS_TOOLBAR_CLASS,
  POS_LIST_CLASS,
} from "@/lib/pos-layout";
import { useSidebar } from "@/components/ui/sidebar";
import { useSettings } from "@/hooks/use-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { ALL_CATEGORIES, CategorySheet, type CategoryPickerProps } from "@/components/pos/CategorySidebar";
import { ProductCard } from "@/components/pos/ProductCard";
import { useCategoryMap } from "@/hooks/use-category-map";
import { useMenuFreshness } from "@/hooks/use-menu-freshness";
import { categoryNameOf, sortProductsByCategoryOrder } from "@/lib/category-map";
import { groupProductsByCategory } from "@/lib/pos-category-groups";
import type { Product } from "@/types";

// Column count = viewport breakpoints keyed by the sidebar's state — together
// they fix the grid pane's real width. CB-1b chose this over a container
// query believing the staff tablet lacked them; CB-1c proved the tablet is a
// modern engine, and the tiers stay because they are plain data the layout
// pins can verify (lib/pos-layout.ts). The sidebar state comes from
// SidebarProvider (expanded on the server and the first client render; the
// remembered collapse is read after mount), so the two agree on the class —
// and both states share one tier table, so the class never changes anyway.
function useGridClass(): string {
  const { state } = useSidebar();
  return state === "collapsed"
    ? POS_GRID_CLASS_SIDEBAR_COLLAPSED
    : POS_GRID_CLASS_SIDEBAR_EXPANDED;
}

// Same value as a concrete height, so the skeleton grid does not jump when the
// real products land. Keep the two in step with TILE_MIN_HEIGHT in ./ProductCard.
const SKELETON_HEIGHT = "h-[6.5rem]";

interface ProductGridProps {
  products: Product[];
  selectedCategory: string;
  onProductClick: (product: Product) => void;
  // Opens the modifier modal for ANY product (even one with no modifiers) so
  // staff can attach a note or a non-default qty to an otherwise plain item.
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

// Category-filtered, name-searchable product grid. Clicking a tile delegates to
// the parent (which opens the modifier modal or adds straight to the cart).
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
  const gridClass = useGridClass();
  // Menu B2 — re-reads the menu when New Order opens / is focused again; the
  // grid stays up when a refresh fails (only the count slot below changes).
  const { refreshFailed, retry } = useMenuFreshness();
  const { map: categoryMap, isLoading: categoriesLoading } = useCategoryMap();
  // Absent (a pre-existing Settings doc) reads as "normal" — same lean-doc
  // discipline as every other optional Settings field.
  const byCategory = useSettings().data?.posLayout === "byCategory";

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
      {/* The HTML's toolbar (values 3.1): sticky at the top of the menu column, the list scrolls under it. */}
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
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items"
              aria-label="Search items"
              className={SEARCH_INPUT_CLASS}
            />
            <span aria-hidden="true" data-ui="pos-search-slash" className={SLASH_CHIP_CLASS}>
              /
            </span>
          </label>
          {/* What the category + search filter shows, read to screen readers (design 6.3: the counts show in the
              category list); when a menu refresh failed but the grid still has data, "Couldn't refresh · Try again"
              shows here, at the row's right where the HTML's diet filter sits (13px --bad-i link; its 44px hit area
              overhangs the 36px row). The span leaves the row while it holds only the spoken count. */}
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
        </div>
        <CategorySheet {...categoryPicker} />
      </div>

      {/* The HTML's list wrapper (values 3.1 listPad); main (the menu column) is the one scroller. */}
      <div data-ui="pos-list" className={POS_LIST_CLASS}>
        {filtered.length === 0 ? (
          <EmptyState
            title="No products found"
            description="Try a different category or search term."
          />
        ) : groups ? (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.categoryId ?? "other"}>
                {/* role=heading + aria-level (not a literal <h3>): this list
                    sits inside a page that already has its own heading
                    hierarchy, so the level is asserted rather than assumed. */}
                <div
                  role="heading"
                  aria-level={3}
                  className="mb-2 border-b pb-1 text-sm font-semibold text-muted-foreground"
                >
                  {group.heading}
                </div>
                <div className={cn(gridClass, disabled && "opacity-50")} inert={disabled}>
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
                      onClick={onProductClick}
                      onOptions={onProductOptions}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={cn(gridClass, disabled && "opacity-50")} inert={disabled}>
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
                onClick={onProductClick}
                onOptions={onProductOptions}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Loading placeholder for the grid above — moved here from pos/page.tsx (CR1.5
// Slice 2, line-budget extraction) since it mirrors exactly this grid's layout,
// column count included (same sidebar-keyed class, so it does not jump).
export function GridSkeleton() {
  const gridClass = useGridClass();
  return (
    <div className={cn(gridClass, POS_LIST_CLASS)}>
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className={cn(SKELETON_HEIGHT, "w-full")} />
      ))}
    </div>
  );
}
