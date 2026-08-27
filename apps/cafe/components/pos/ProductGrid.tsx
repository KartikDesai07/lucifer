"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { NotebookPen, Search } from "lucide-react";

import { effectivePrice } from "@/hooks/use-cart";
import { productImageUrl } from "@/lib/images";
import { inr, cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ALL_CATEGORIES } from "@/components/pos/CategorySidebar";
import type { Product } from "@/types";

// Tile thumbnail edge, CSS px. Requested at 2x so the Cloudinary branch (which
// transforms on delivery) stays sharp on a retina counter screen.
const THUMB_PX = 40;

// Tile height FLOOR, not a fixed height: the worst case (two-line name + the
// category sub-line + the price row) measures ~101px at the default type
// scale, so a fixed 88px tile would have clipped the price under
// overflow-hidden. Cards take their row's height from `h-full`, which is what
// actually lines a row up; this floor only stops a one-word tile collapsing.
const TILE_MIN_HEIGHT = "min-h-[6.5rem]";

// Same value as a concrete height, so the skeleton grid does not jump when the
// real products land. Keep the two in step.
const SKELETON_HEIGHT = "h-[6.5rem]";

const GRID_CLASS = "grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4";

interface ProductGridProps {
  products: Product[];
  selectedCategory: string;
  onProductClick: (product: Product) => void;
  // Opens the modifier modal for ANY product (even one with no modifiers) so
  // staff can attach a note or a non-default qty to an otherwise plain item.
  onProductOptions: (product: Product) => void;
}

// Category-filtered, name-searchable product grid. Clicking a tile delegates to
// the parent (which opens the modifier modal or adds straight to the cart).
export function ProductGrid({
  products,
  selectedCategory,
  onProductClick,
  onProductOptions,
}: ProductGridProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const inCategory =
        selectedCategory === ALL_CATEGORIES || p.category === selectedCategory;
      const matches = q === "" || p.name.toLowerCase().includes(q);
      return inCategory && matches;
    });
  }, [products, selectedCategory, search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState
            title="No products found"
            description="Try a different category or search term."
          />
        ) : (
          <div className={GRID_CLASS}>
            {filtered.map((product) => (
              <div key={product._id} className="relative">
                <ProductCard
                  product={product}
                  // Browsing "All" mixes every category together, so each tile
                  // says which one it belongs to. Inside a category that line
                  // would repeat the rail selection on every tile — drop it.
                  showCategory={selectedCategory === ALL_CATEGORIES}
                  onClick={() => onProductClick(product)}
                />
                {/* Sibling of the card's own <button>, never nested inside it —
                    a <button> inside a <button> is invalid and unclickable. */}
                <button
                  type="button"
                  onClick={() => onProductOptions(product)}
                  disabled={product.available === false}
                  aria-label="Add with note or quantity"
                  title="Add with note or quantity"
                  className="absolute right-1 top-1 z-10 rounded-full bg-background/90 p-1 text-muted-foreground shadow-sm ring-1 ring-border hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
                >
                  <NotebookPen className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Loading placeholder for the grid above — moved here from pos/page.tsx (CR1.5
// Slice 2, line-budget extraction) since it mirrors exactly this grid's layout.
export function GridSkeleton() {
  return (
    <div className={cn(GRID_CLASS, "min-h-0 flex-1 content-start")}>
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className={cn(SKELETON_HEIGHT, "w-full")} />
      ))}
    </div>
  );
}

function ProductCard({
  product,
  showCategory,
  onClick,
}: {
  product: Product;
  showCategory: boolean;
  onClick: () => void;
}) {
  const url = productImageUrl(product.image, THUMB_PX * 2);
  // Legacy products (pre-`available`) read as available; only an explicit
  // `available:false` ("86") disables ordering.
  const outOfStock = product.available === false;
  const price = effectivePrice(product);
  const hasDiscount = product.discount > 0;
  const hasOptions = product.modifiers.length > 0;
  // A variation item bills at whichever size the operator picks in the modal,
  // never at this tile's base `price` — showing the min–max range up front
  // (same figures the modal offers) keeps the number here from surprising
  // anyone once the line lands in the cart.
  const variationPrices = product.variations?.map((v) =>
    effectivePrice({ price: v.price, discount: product.discount }),
  );
  const priceRange =
    variationPrices && variationPrices.length > 0
      ? { min: Math.min(...variationPrices), max: Math.max(...variationPrices) }
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={outOfStock}
      className={cn(
        // w-full/h-full are load-bearing: a <button> sizes to its own CONTENT
        // even as a flex container, so without them each tile took the width of
        // its product name and the grid came out ragged, with the notes button
        // stranded outside the card it belongs to. h-full makes every tile in a
        // row adopt that row's height, so the bottom edges line up.
        "flex h-full w-full flex-col justify-between gap-1.5 overflow-hidden rounded-lg border bg-card p-2.5 text-left shadow-sm transition-colors",
        TILE_MIN_HEIGHT,
        outOfStock
          ? "cursor-not-allowed opacity-60"
          : "hover:border-primary hover:bg-accent",
      )}
    >
      <span className="flex w-full min-w-0 items-start gap-2">
        {url ? (
          <Image
            src={url}
            alt=""
            width={THUMB_PX}
            height={THUMB_PX}
            className="h-10 w-10 shrink-0 rounded-md object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-muted text-base font-semibold text-muted-foreground"
          >
            {product.name.charAt(0).toUpperCase()}
          </span>
        )}
        {/* pr-5 reserves the top-right corner for the notes button, which is
            positioned over this card by the grid cell above. */}
        <span className="min-w-0 flex-1 pr-5">
          <span
            className="line-clamp-2 break-words text-sm font-semibold leading-tight"
            title={product.name}
          >
            {product.name}
          </span>
          {showCategory && (
            <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
              {product.category}
            </span>
          )}
        </span>
      </span>

      <span className="flex w-full items-center gap-1.5">
        {priceRange ? (
          <span className="text-base font-bold tabular-nums">
            {inr(priceRange.min)} – {inr(priceRange.max)}
          </span>
        ) : (
          <>
            <span className="text-base font-bold tabular-nums">{inr(price)}</span>
            {hasDiscount && (
              <span className="text-xs tabular-nums text-muted-foreground line-through">
                {inr(product.price)}
              </span>
            )}
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {outOfStock ? (
            <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
              Out of stock
            </Badge>
          ) : (
            <>
              {/* A tap on these opens the add-ons modal instead of dropping the
                  item straight into the cart — say so on the tile. */}
              {hasOptions && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  Options
                </Badge>
              )}
              {hasDiscount && (
                <Badge className="px-1.5 py-0 text-[10px]">
                  {product.discount}% off
                </Badge>
              )}
            </>
          )}
        </span>
      </span>
    </button>
  );
}
