"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Search } from "lucide-react";

import { effectivePrice } from "@/hooks/use-cart";
import { productImageUrl } from "@/lib/images";
import { inr, cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ALL_CATEGORIES } from "@/components/pos/CategorySidebar";
import type { Product } from "@/types";

interface ProductGridProps {
  products: Product[];
  selectedCategory: string;
  onProductClick: (product: Product) => void;
}

// Category-filtered, name-searchable product grid. Clicking a tile delegates to
// the parent (which opens the modifier modal or adds straight to the cart).
export function ProductGrid({
  products,
  selectedCategory,
  onProductClick,
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
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="pl-8"
          aria-label="Search products"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState
            title="No products found"
            description="Try a different category or search term."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((product) => (
              <ProductCard
                key={product._id}
                product={product}
                onClick={() => onProductClick(product)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({
  product,
  onClick,
}: {
  product: Product;
  onClick: () => void;
}) {
  const url = productImageUrl(product.image, 200);
  // Legacy products (pre-`available`) read as available; only an explicit
  // `available:false` ("86") disables ordering.
  const outOfStock = product.available === false;
  const price = effectivePrice(product);
  const hasDiscount = product.discount > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={outOfStock}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-colors",
        outOfStock
          ? "cursor-not-allowed opacity-60"
          : "hover:border-primary hover:bg-accent",
      )}
    >
      <div className="relative aspect-square w-full bg-muted">
        {url ? (
          <Image
            src={url}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, 200px"
            className="object-cover"
          />
        ) : (
          <div className="grid h-full place-items-center text-2xl font-semibold text-muted-foreground">
            {product.name.charAt(0).toUpperCase()}
          </div>
        )}
        {outOfStock && (
          <Badge
            variant="destructive"
            className="absolute right-1 top-1 px-1.5 py-0 text-[10px]"
          >
            Out of stock
          </Badge>
        )}
        {!outOfStock && hasDiscount && (
          <Badge className="absolute left-1 top-1 px-1.5 py-0 text-[10px]">
            {product.discount}% off
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        <span className="line-clamp-2 text-sm font-medium leading-tight">
          {product.name}
        </span>
        <span className="flex items-baseline gap-1">
          <span className="text-sm font-semibold">{inr(price)}</span>
          {hasDiscount && (
            <span className="text-xs text-muted-foreground line-through">
              {inr(product.price)}
            </span>
          )}
        </span>
      </div>
    </button>
  );
}
