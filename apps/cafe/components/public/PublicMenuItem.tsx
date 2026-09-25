import { Minus, Plus } from "lucide-react";
import { effectiveUnitPrice } from "@pos/shared/public";
import { inr, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PublicInitialTile } from "@/components/public/PublicInitialTile";
import { PUB_TINT_CLASS } from "@/components/public/public-ui";

// Wire shape returned by GET /api/public/menu — a hand-typed mirror of
// lib/public-menu.ts's PublicMenuItem, kept LOCAL rather than imported. That
// module shapes a lean Mongoose doc, so nothing under components/public/**
// may reach for it (not even a type-only import) per the CR2 threat model:
// no driver, not even its types, on a diner's phone.
export interface PublicMenuVariation {
  name: string;
  price: number;
}

export interface PublicMenuProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  // Named sizes this item sells in — ABSENT when it's sold one way only.
  // Present means the tile shows a min–max range instead of one price
  // (SLICE 4 §3), same idea as ProductGrid's admin tile, reimplemented here.
  variations?: PublicMenuVariation[];
  discount: number;
  available: boolean;
  image: string;
  modifiers: string[];
}

export interface PublicMenuCategoryInfo {
  name: string;
  order: number;
}

// Delegates to @pos/shared/public's effectiveUnitPrice — the same formula
// hooks/use-cart.ts's effectivePrice() now delegates to, and the one the
// server prices a diner's order at (CR2.2). That module is pure and
// client-safe (no Mongoose, no Node APIs), so importing it here still keeps
// this file's pin intact: ZERO imports of @/models, mongoose, or TanStack.
function effectivePublicPrice(price: number, discount: number): number {
  return effectiveUnitPrice(price, discount);
}

interface PublicMenuItemProps {
  product: PublicMenuProduct;
  // This product's total cart qty (summed across lines) — 0 shows the ADD
  // pill, >0 shows the [− n +] stepper. Owned by PublicOrderFlow.
  qty: number;
  // SLICE 8 / CR2.2b: raise the tap to PublicOrderFlow, which owns the cart
  // and decides simple direct-add vs. opening PublicItemSheet. Absent, the
  // tile stays browse-only, same as CR2.1.
  onIncrement?: (product: PublicMenuProduct) => void;
  onDecrement?: (productId: string) => void;
}

// CR2.2b (Blinkit-pattern stepper) — the ADD pill and the [− n +] stepper
// share this exact box so the morph between them is a pure in-place swap,
// never a layout shift. ≥44px tall per the touch-target rule.
const CONTROL_FOOTPRINT = "ml-auto h-11 w-28";

// One diner-facing menu tile: photo, name, price (or a size range), modifier
// labels, and an Add/stepper control. A sold-out item keeps the same tile
// with a Sold-out badge and NO control, never hidden (a diner mid-scroll must
// not see items vanish) and never tappable.
export function PublicMenuItem({ product, qty, onIncrement, onDecrement }: PublicMenuItemProps) {
  const soldOut = !product.available;
  const variationPrices = product.variations?.map((v) =>
    effectivePublicPrice(v.price, product.discount),
  );
  const priceRange =
    variationPrices && variationPrices.length > 0
      ? { min: Math.min(...variationPrices), max: Math.max(...variationPrices) }
      : null;
  const price = effectivePublicPrice(product.price, product.discount);
  const hasDiscount = product.discount > 0 && !priceRange;

  return (
    <div
      className={cn(
        "flex gap-pub-gap rounded-lg border bg-card p-pub-pad shadow-sm",
        soldOut && "opacity-60",
      )}
    >
      <PublicInitialTile
        name={product.name}
        tintKey={product.category}
        imageRef={product.image}
        size={80}
        muted={soldOut}
      />

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
        <div>
          <h3 className="break-words text-base font-semibold leading-tight font-pub-display">
            {product.name}
          </h3>
          {/* Diner-facing add-on labels — no veg/non-veg field exists on the
              schema yet, so this is deliberately the only descriptor line. */}
          {product.modifiers.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add-ons: {product.modifiers.join(", ")}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {priceRange ? (
            <span className="text-base font-bold tabular-nums">
              {inr(priceRange.min)} – {inr(priceRange.max)}
            </span>
          ) : (
            <>
              <span className="text-base font-bold tabular-nums">{inr(price)}</span>
              {hasDiscount && (
                <>
                  <span className="text-xs tabular-nums text-muted-foreground line-through">
                    {inr(product.price)}
                  </span>
                  <span className={cn(PUB_TINT_CLASS, "rounded-full px-1.5 py-0.5 text-[10px] font-medium")}>
                    {product.discount}% off
                  </span>
                </>
              )}
            </>
          )}
          {soldOut && (
            <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
              Sold out
            </Badge>
          )}
          {!soldOut && qty === 0 && onIncrement && (
            <Button
              type="button"
              className={cn(CONTROL_FOOTPRINT, "gap-1 bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95")}
              onClick={() => onIncrement(product)}
              aria-label={`Add ${product.name}`}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          )}
          {!soldOut && qty > 0 && onIncrement && onDecrement && (
            <div
              className={cn(
                CONTROL_FOOTPRINT,
                "flex items-center justify-between rounded-md border border-primary bg-primary/10",
              )}
            >
              <button
                type="button"
                onClick={() => onDecrement(product.id)}
                aria-label={`Decrease ${product.name} quantity`}
                className="grid h-11 w-11 place-items-center rounded active:scale-95"
              >
                <Minus className="h-4 w-4" />
              </button>
              {/* key={qty} remounts the digit on every change so the zoom-in
                  replays — the same animate-in zoom-in-95 idiom the bottom
                  cart bar uses; this morph IS the feedback, replacing the old
                  600ms "Added" flash. */}
              <span
                key={qty}
                className="w-5 text-center text-sm font-semibold tabular-nums animate-in zoom-in-95 duration-300"
              >
                {qty}
              </span>
              <button
                type="button"
                onClick={() => onIncrement(product)}
                aria-label={`Increase ${product.name} quantity`}
                className="grid h-11 w-11 place-items-center rounded active:scale-95"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
