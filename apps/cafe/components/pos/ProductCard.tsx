"use client";

import { memo } from "react";
import Image from "next/image";
import { NotebookPen } from "lucide-react";

import { effectivePrice } from "@/hooks/use-cart";
import { productImageUrl } from "@/lib/images";
import { inr, cn } from "@/lib/utils";
import {
  POS_TILE_OPTIONS_BUTTON_CLASS,
  POS_TILE_OPTIONS_RESERVE_CLASS,
  POS_PRESS_FEEDBACK_CLASS,
} from "@/lib/pos-layout";
import { Badge } from "@/components/ui/badge";
import type { Product } from "@/types";

// Tile thumbnail edge, CSS px. Requested at 2x so the Cloudinary branch (which
// transforms on delivery) stays sharp on a retina counter screen.
export const THUMB_PX = 40;

// Tile height FLOOR, not a fixed height: the worst case (two-line name + the
// category sub-line + the price row) measures ~101px at the default type
// scale, so a fixed 88px tile would have clipped the price under
// overflow-hidden. Cards take their row's height from `h-full`, which is what
// actually lines a row up; this floor only stops a one-word tile collapsing.
export const TILE_MIN_HEIGHT = "min-h-[6.5rem]";

interface ProductCardProps {
  product: Product;
  showCategory: boolean;
  categoryLabel: string;
  qty: number;
  // Both callbacks receive the product — the card binds itself, so the grid can
  // pass ONE stable function to every tile and React.memo can bail out.
  onClick: (product: Product) => void;
  onOptions: (product: Product) => void;
}

// 128 tiles co-render with every PosPage render (tap / pulse tick / cart
// change) with nothing but a fresh inline onClick changing across 127 of
// them; memo + product-bound callbacks make 127/128 tiles bail out. Props are
// all primitives, the TanStack-shared product object (structural sharing
// keeps identity across refetches), or useCallback'd handlers from
// pos/page.tsx — none of them churn on an unrelated render.
export const ProductCard = memo(function ProductCard({
  product,
  showCategory,
  categoryLabel,
  qty,
  onClick,
  onOptions,
}: ProductCardProps) {
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
    <div className="relative">
      <button
        type="button"
        onClick={() => onClick(product)}
        disabled={outOfStock}
        className={cn(
          // w-full/h-full are load-bearing: a <button> sizes to its own CONTENT
          // even as a flex container, so without them each tile took the width of
          // its product name and the grid came out ragged, with the notes button
          // stranded outside the card it belongs to. h-full makes every tile in a
          // row adopt that row's height, so the bottom edges line up.
          // disabled:pointer-events-none mirrors the options button / shadcn
          // Button: a disabled control CAN match :active in Chromium (probed,
          // review g18), and without it an 86'd tile would flash BRIGHTER
          // (opacity-60 -> active:opacity-80) under the press-feedback token.
          // Known trade-off: it also mutes the name span's title tooltip on a
          // clipped out-of-stock name (desktop hover) — accepted, review r2.
          "flex h-full w-full flex-col justify-between gap-1.5 overflow-hidden rounded-lg border bg-card p-2.5 text-left shadow-sm transition-colors disabled:pointer-events-none",
          POS_PRESS_FEEDBACK_CLASS,
          TILE_MIN_HEIGHT,
          outOfStock
            ? "cursor-not-allowed opacity-60"
            : "hover:border-primary hover:bg-accent",
          qty > 0 && "border-primary",
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
          {/* Reserves the top-right corner for the notes button, which is
              positioned over this card by the grid cell above. */}
          <span className={cn("min-w-0 flex-1", POS_TILE_OPTIONS_RESERVE_CLASS)}>
            <span
              className="line-clamp-2 break-words text-sm font-semibold leading-tight"
              title={product.name}
            >
              {product.name}
            </span>
            {showCategory && (
              <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
                {categoryLabel}
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
      {qty > 0 && (
        <span
          aria-label={`${qty} in cart`}
          className="absolute left-1 top-1 z-10 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums text-primary-foreground"
        >
          {qty}
        </span>
      )}
      {/* Sibling of the card's own <button>, never nested inside it —
          a <button> inside a <button> is invalid and unclickable. */}
      <button
        type="button"
        onClick={() => onOptions(product)}
        disabled={product.available === false}
        aria-label="Add with note or quantity"
        title="Add with note or quantity"
        className={cn(
          POS_TILE_OPTIONS_BUTTON_CLASS,
          "absolute right-1 top-1 z-10 grid place-items-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-0",
        )}
      >
        <NotebookPen className="h-4 w-4" />
      </button>
    </div>
  );
});
