import { ChevronRight, Plus } from "lucide-react";

import { effectiveUnitPrice } from "@pos/shared/public";
import { inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  PUB_HSCROLL_CLASS,
  PUB_SECTION_HEADING_CLASS,
  PUB_TEXT_LINK_CLASS,
  PUB_TINT_CLASS,
  PUB_TONAL_CARD_CLASS,
} from "@/components/public/public-ui";
import { PublicInitialTile } from "@/components/public/PublicInitialTile";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";

// CB-6D-A — a horizontal row of items, GENERALISED so Home can render it
// twice: once titled "Daily offers" (discounted items, moved here from the
// Menu tab this slice) and once titled "Popular here" (the cafe's top
// sellers). A simple item (no variations, no modifiers) adds straight to the
// cart with one tap; anything else needs the full menu tile (variations/
// modifiers to choose), so it routes to Browse instead of half-adding an
// incomplete line.

interface PublicPopularRowProps {
  title: string;
  items: readonly PublicMenuProduct[];
  onQuickAdd: (product: PublicMenuProduct) => void;
  onBrowseMenu: () => void;
}

function isSimpleItem(product: PublicMenuProduct): boolean {
  return !product.variations?.length && product.modifiers.length === 0;
}

// Price exactly as the menu tile shows it: the LIVE discount applied (the
// same shared effectiveUnitPrice the server bills at), and a size range
// collapsed to its cheapest option — never the raw base price, which would
// disagree with the tile one tap away.
function displayPrice(product: PublicMenuProduct): string {
  const variationPrices = product.variations?.map((v) => effectiveUnitPrice(v.price, product.discount)) ?? [];
  if (variationPrices.length > 0) return `From ${inr(Math.min(...variationPrices))}`;
  return inr(effectiveUnitPrice(product.price, product.discount));
}

export function PublicPopularRow({ title, items, onQuickAdd, onBrowseMenu }: PublicPopularRowProps) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className={PUB_SECTION_HEADING_CLASS}>{title}</p>
        <button type="button" onClick={onBrowseMenu} className={PUB_TEXT_LINK_CLASS}>
          See menu
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className={cn(PUB_HSCROLL_CLASS, "mt-2")}>
        {items.map((item) => (
          <div key={item.id} className={cn(PUB_TONAL_CARD_CLASS, "w-40 shrink-0 snap-start p-3")}>
            <PublicInitialTile name={item.name} tintKey={item.category} imageRef={item.image} size={80} />
            <p className="mt-2 line-clamp-2 text-sm font-medium leading-tight">{item.name}</p>
            {item.discount > 0 ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-bold tabular-nums">{inr(effectiveUnitPrice(item.price, item.discount))}</span>
                <span className="text-xs tabular-nums text-muted-foreground line-through">{inr(item.price)}</span>
                <span className={cn(PUB_TINT_CLASS, "rounded-full px-1.5 py-0.5 text-[10px] font-medium")}>
                  {item.discount}% off
                </span>
              </div>
            ) : (
              <p className="mt-0.5 text-sm font-bold tabular-nums">{displayPrice(item)}</p>
            )}
            {isSimpleItem(item) ? (
              <Button
                size="sm"
                className="mt-1.5 h-11 w-full gap-1 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => onQuickAdd(item)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5 h-11 w-full"
                onClick={onBrowseMenu}
              >
                Options
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
