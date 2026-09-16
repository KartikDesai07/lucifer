"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { effectiveUnitPrice, PUBLIC_NOTE_MAX_LEN, PUBLIC_ORDER_MAX_QTY } from "@pos/shared/public";
import { inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";

// What PublicOrderFlow needs back to build a cart line — mirrors
// ModifierModal's AddToCartOpts (hooks/use-cart.ts) but scoped to the public
// surface's own bounds (PUBLIC_ORDER_MAX_QTY, PUBLIC_NOTE_MAX_LEN).
export interface PublicAddToCartOpts {
  variation?: string;
  modifiers: string[];
  instructions?: string;
  qty: number;
}

interface PublicItemSheetProps {
  product: PublicMenuProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (product: PublicMenuProduct, opts: PublicAddToCartOpts) => void;
}

// Opens only for items PublicOrderFlow decided need a choice — a variation, a
// modifier, or just a note/qty beyond the default. Simple items never reach
// this component: they're added straight from the tile (SLICE 8's Add
// control) with qty 1 and nothing else.
export function PublicItemSheet({
  product,
  open,
  onOpenChange,
  onConfirm,
}: PublicItemSheetProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [qty, setQty] = useState(1);
  // Undefined = nothing picked yet — a variation item has no safe default
  // (Small vs Large), so Add stays disabled until the diner taps one, same
  // discipline as ModifierModal.
  const [variation, setVariation] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setSelected([]);
      setInstructions("");
      setQty(1);
      setVariation(undefined);
    }
  }, [open, product?.id]);

  if (!product) return null;

  const hasVariations = (product.variations?.length ?? 0) > 0;
  const chosenVariation = variation
    ? product.variations?.find((v) => v.name === variation)
    : undefined;
  const unit = chosenVariation
    ? effectiveUnitPrice(chosenVariation.price, product.discount)
    : hasVariations
      ? null
      : effectiveUnitPrice(product.price, product.discount);
  const confirmDisabled = hasVariations && !variation;

  const toggle = (modifier: string, checked: boolean) => {
    setSelected((prev) =>
      checked ? [...prev, modifier] : prev.filter((m) => m !== modifier),
    );
  };

  const confirm = () => {
    const trimmed = instructions.trim();
    onConfirm(product, {
      variation,
      modifiers: selected,
      instructions: trimmed.length > 0 ? trimmed : undefined,
      qty,
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{product.name}</SheetTitle>
          <SheetDescription>
            {unit === null
              ? "Pick a size to continue."
              : `${inr(unit)} each — choose add-ons and quantity.`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {hasVariations && (
            <div className="space-y-2">
              <Label>Size (required)</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {product.variations!.map((v) => {
                  const active = v.name === variation;
                  const vPrice = effectiveUnitPrice(v.price, product.discount);
                  return (
                    <button
                      key={v.name}
                      type="button"
                      onClick={() => setVariation(v.name)}
                      className={cn(
                        "rounded-md border py-2 text-sm font-semibold transition-colors",
                        active
                          ? "border-primary bg-accent text-accent-foreground ring-2 ring-primary ring-offset-1"
                          : "hover:border-primary hover:bg-muted",
                      )}
                    >
                      {v.name}
                      <span className={cn("block text-xs font-normal", !active && "text-muted-foreground")}>
                        {inr(vPrice)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {product.modifiers.length > 0 && (
            <div className="space-y-2">
              <Label>Add-ons</Label>
              <div className="space-y-2">
                {product.modifiers.map((modifier) => (
                  <label key={modifier} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(modifier)}
                      onCheckedChange={(c) => toggle(modifier, c === true)}
                    />
                    {modifier}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="public-item-instructions">Instructions (optional)</Label>
            <Input
              id="public-item-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. less spicy, no onions"
              maxLength={PUBLIC_NOTE_MAX_LEN}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label>Quantity</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-8 text-center text-sm font-semibold">{qty}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setQty((q) => Math.min(PUBLIC_ORDER_MAX_QTY, q + 1))}
                aria-label="Increase quantity"
                disabled={qty >= PUBLIC_ORDER_MAX_QTY}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <SheetFooter>
          <Button onClick={confirm} disabled={confirmDisabled} className="w-full">
            {unit === null ? "Pick a size" : `Add ${qty} — ${inr(unit * qty)}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
