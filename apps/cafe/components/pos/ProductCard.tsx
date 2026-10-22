"use client";

import { memo, useId } from "react";
import Image from "next/image";

import { productImageUrl } from "@/lib/images";
import { cardNameDescribedBy, cardTag, priceButtonTitle, priceButtonsFor, priceText } from "@/lib/pos-price-buttons";
import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import type { Product } from "@/types";

// The owner's HTML item card (U1 Task 3; values 4.1-4.6 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 6.4; owner Q5-Q7): the item's photo (only when it has one), the name button (it opens the options modal), the
// tag line and the price strip (a tap on a price adds at once: lib/pos-price-buttons.ts). No veg mark (owner Q7): the
// name starts where the HTML's mark sits.

/** The card (values 4.1): --surface, a 1px border, radius 14, 12px padding, its parts 10px apart. GridSkeleton draws
 *  the same shell, so a loading card has the real card's 117px (123px below 1100px). */
export const CARD_SHELL_CLASS = "flex flex-col gap-2.5 rounded-[14px] border bg-card p-3 text-foreground";
/** The price strip (values 4.1): --surface-2, radius 8, 2px padding and gap. */
export const PRICE_STRIP_CLASS = "grid gap-0.5 rounded-[8px] bg-surface-2 p-0.5";
/** values 0.3 priceH: a price button is 40px from 1100px, 46px below. */
export const PRICE_HEIGHT_CLASS = "h-10 max-desk:h-[46px]";

/** The size a photo is asked for where the store resizes on delivery (Cloudinary; R2 photos come pre-sized): the
 *  widest card's photo box (340px on a phone) at twice the pixels. Scaled to fit (no crop there): the box's
 *  object-cover crops it once, to the box's own shape. */
export const CARD_PHOTO_PX = 680;

// The HTML's motion (values 4.1): transform .28s on its easing, box-shadow .28s, border-color .2s; on hover the card
// lifts 2px over a soft shadow (only where the device hovers, ruling R14; the hover shadow replaces the in-cart ring, as
// the HTML's !important hover rule does).
const CARD_MOTION_CLASS =
  "[transition:transform_.28s_cubic-bezier(.2,.8,.2,1),box-shadow_.28s,border-color_.2s] motion-reduce:transition-none hover:[transform:translateY(-2px)] hover:[box-shadow:0_10px_26px_rgba(0,0,0,.08)]";
// In the cart (values 4.2): the accent border and a 1px accent ring.
const IN_CART_CLASS = "border-primary [box-shadow:0_0_0_1px_var(--primary)]";
// The name button (values 4.1) and the price buttons take no touch while disabled: a disabled button still matches
// :active in Chromium, and the touch layer ([data-pos-touch], app/globals.css) would dim it under a finger; a mouse
// still gets the HTML's not-allowed pointer.
const NAME_BUTTON_CLASS =
  "flex w-full cursor-pointer items-start gap-2 bg-transparent p-0 text-left disabled:cursor-not-allowed pointer-coarse:disabled:pointer-events-none";
// The qty badge (values 4.1): 20px, radius 10, 0 6px, the accent with 12px/600 --on-accent figures; the HTML's pop.
const BADGE_CLASS =
  "flex h-5 min-w-5 flex-none items-center justify-center rounded-[10px] bg-primary px-1.5 text-[12px] font-semibold text-primary-foreground motion-safe:animate-html-pop";
// A price button (values 4.1, 0.5): the UA's 1px 6px padding, radius 6, line-height 1.15; hover --surface with a hairline
// shadow, pressed --accent-t.
const PRICE_BUTTON_CLASS =
  "flex min-w-0 cursor-pointer flex-col items-center justify-center rounded-[6px] bg-transparent px-1.5 py-px leading-[1.15] text-foreground hover:bg-card hover:[box-shadow:0_1px_2px_rgba(0,0,0,.1)] not-disabled:active:bg-accent disabled:cursor-not-allowed pointer-coarse:disabled:pointer-events-none";
// values 4.2 cols: one column per button (at most three).
const STRIP_COLUMNS = ["grid-cols-1", "grid-cols-2", "grid-cols-3"] as const;

interface ProductCardProps {
  product: Product;
  showCategory: boolean;
  categoryLabel: string;
  qty: number;
  // Both callbacks receive the product — the card binds itself, so the grid can
  // pass ONE stable function to every tile and React.memo can bail out. onAdd
  // also gets the tapped price button's variation (none for an item sold one way).
  onAdd: (product: Product, variation?: string) => void;
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
  onAdd,
  onOptions,
}: ProductCardProps) {
  const badgeId = useId();
  const tagId = useId();
  // Legacy products (pre-`available`) read as available; only an explicit
  // `available:false` ("86") disables ordering.
  const outOfStock = product.available === false;
  const inCart = qty > 0;
  const photo = productImageUrl(product.image, CARD_PHOTO_PX, { fit: true });
  const tag = cardTag(product, { showCategory, categoryLabel });
  const buttons = priceButtonsFor(product);

  return (
    <div
      data-ui="pos-card"
      className={cn(CARD_SHELL_CLASS, CARD_MOTION_CLASS, inCart ? IN_CART_CLASS : "border-border", outOfStock && "opacity-45")}
    >
      {photo && (
        <div
          data-ui="pos-card-photo"
          className={cn("relative h-28 overflow-hidden rounded-[10px] bg-surface-2 max-tab:h-24", outOfStock && "[filter:grayscale(1)]")}
        >
          <Image src={photo} alt="" fill sizes="(max-width: 719px) 100vw, 340px" className="object-cover" />
        </div>
      )}
      <button
        type="button"
        data-ui="pos-card-name"
        disabled={outOfStock}
        onClick={() => onOptions(product)}
        aria-label={`${product.name}: Add with note or quantity`}
        aria-describedby={cardNameDescribedBy({ tagId, badgeId, tag: tag.text, inCart })}
        className={cn(NAME_BUTTON_CLASS, BRAND_PRESS_CLASS)}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span title={product.name} className="truncate text-[14.5px] font-medium tracking-[-0.005em]">
            {product.name}
          </span>
          <span id={tagId} data-ui="pos-card-tag" className={cn("truncate text-[12px]", tag.tone === "bad" ? "text-status-bad-ink" : "text-muted-foreground")}>
            {tag.text}
          </span>
        </span>
        {inCart && (
          <span id={badgeId} data-ui="pos-card-badge" aria-label={`${qty} in cart`} className={BADGE_CLASS}>
            {qty}
          </span>
        )}
      </button>
      <div data-ui="pos-price-strip" className={cn(PRICE_STRIP_CLASS, STRIP_COLUMNS[buttons.length - 1])}>
        {buttons.map((b) => (
          <button
            key={b.variation ?? b.label}
            type="button"
            data-ui="pos-price-button"
            disabled={outOfStock}
            title={priceButtonTitle(product.name, b)}
            onClick={() => (b.opensOptions ? onOptions(product) : onAdd(product, b.variation))}
            className={cn(PRICE_BUTTON_CLASS, PRICE_HEIGHT_CLASS, BRAND_PRESS_CLASS)}
          >
            <span className="max-w-full truncate text-[10.5px] text-muted-foreground">{b.label}</span>
            <span className="max-w-full truncate text-[13.5px] font-semibold">{priceText(b)}</span>
          </button>
        ))}
      </div>
    </div>
  );
});
