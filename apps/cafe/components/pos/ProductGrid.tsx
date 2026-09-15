"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  POS_GRID_CLASS_SIDEBAR_EXPANDED,
  POS_GRID_CLASS_SIDEBAR_COLLAPSED,
} from "@/lib/pos-layout";
import { useSidebar } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ALL_CATEGORIES } from "@/components/pos/CategorySidebar";
import { ProductCard } from "@/components/pos/ProductCard";
import { useCategoryMap } from "@/hooks/use-category-map";
import { categoryNameOf, sortProductsByCategoryOrder } from "@/lib/category-map";
import type { Product } from "@/types";

// Column count = viewport breakpoints keyed by the sidebar's state — together
// they fix the grid pane's real width. CB-1b chose this over a container
// query believing the staff tablet lacked them; CB-1c proved the tablet is a
// modern engine, and the tiers stay because they are plain data the layout
// pins can verify (lib/pos-layout.ts). The sidebar state comes from
// SidebarProvider (defaultOpen, cookie never read), so the server and the
// first client render agree on the class.
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
}

// Category-filtered, name-searchable product grid. Clicking a tile delegates to
// the parent (which opens the modifier modal or adds straight to the cart).
export function ProductGrid({
  products,
  selectedCategory,
  onProductClick,
  onProductOptions,
  qtyByProduct,
}: ProductGridProps) {
  const [search, setSearch] = useState("");
  const gridClass = useGridClass();
  const { map: categoryMap, isLoading: categoriesLoading } = useCategoryMap();

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          {/* type="search" gives the phone keyboard a Search key and the
              native clear affordance; Input already renders text-base below
              md, so this does not trigger iOS's focus-zoom. */}
          <Input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="pl-8"
            aria-label="Search products"
          />
        </div>
        {/* Standing count of what the category + search filter is showing, so a
            short grid reads as "that is all there is" and not "it failed". */}
        <span
          aria-live="polite"
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {filtered.length} {filtered.length === 1 ? "item" : "items"}
        </span>
      </div>

      {/* The only scroller on the screen. No overscroll-contain: when the root
          is taller than a short viewport (landscape phone, min-h floor) a drag
          past the grid's end must chain to the document so the rest of the
          page stays reachable. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState
            title="No products found"
            description="Try a different category or search term."
          />
        ) : (
          <div className={gridClass}>
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
    </div>
  );
}

// Loading placeholder for the grid above — moved here from pos/page.tsx (CR1.5
// Slice 2, line-budget extraction) since it mirrors exactly this grid's layout,
// column count included (same sidebar-keyed class, so it does not jump).
export function GridSkeleton() {
  const gridClass = useGridClass();
  return (
    <div className={cn(gridClass, "min-h-0 flex-1 content-start")}>
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className={cn(SKELETON_HEIGHT, "w-full")} />
      ))}
    </div>
  );
}
