"use client";

import { Plus } from "lucide-react";

import { effectiveUnitPrice } from "@pos/shared/public";
import { inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PublicInitialTile } from "@/components/public/PublicInitialTile";
import { PUB_CARD_CLASS } from "@/components/public/public-ui";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";

// S4 — "Goes well with your order" cross-sell strip inside the cart drawer
// (CR2.2b §17.D). Extracted from PublicCart.tsx purely for the ~300-line file
// cap; PublicOrderFlow still owns WHAT is suggested (≤3 top-sellers, simple
// items only, never something already in the cart) and the add handler —
// this component only renders. Baymard: relevance over padding — an empty
// list renders NOTHING, never an empty shell.

// Card art size — the smallest tile on the diner surface: a cross-sell chip
// earns less visual weight than a menu tile (80) or an offer tile (64).
const SUGGESTION_TILE_SIZE = 48;

function PublicSuggestionChip({ item, onAdd }: { item: PublicMenuProduct; onAdd: (item: PublicMenuProduct) => void }) {
  const price = effectiveUnitPrice(item.price, item.discount);
  return (
    <div className={cn(PUB_CARD_CLASS, "flex w-40 shrink-0 items-center gap-2 p-2")}>
      <PublicInitialTile name={item.name} tintKey={item.category} imageRef={item.image} size={SUGGESTION_TILE_SIZE} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium leading-tight">{item.name}</p>
        <p className="text-xs font-semibold tabular-nums">{inr(price)}</p>
      </div>
      <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => onAdd(item)} aria-label={`Add ${item.name}`}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function PublicSuggestionChips({
  suggestions,
  onAdd,
}: {
  suggestions: PublicMenuProduct[];
  onAdd: (item: PublicMenuProduct) => void;
}) {
  // 0 chips is a valid, deliberate state; no empty shell.
  if (suggestions.length === 0) return null;
  return (
    <div className="space-y-2 px-4">
      <p className="text-sm font-medium">Goes well with your order</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {suggestions.map((item) => (
          <PublicSuggestionChip key={item.id} item={item} onAdd={onAdd} />
        ))}
      </div>
    </div>
  );
}
