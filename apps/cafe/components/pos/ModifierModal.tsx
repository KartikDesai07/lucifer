"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { effectivePrice } from "@/hooks/use-cart";
import { inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Product } from "@/types";

export interface AddToCartOpts {
  modifiers: string[];
  instructions: string;
  qty: number;
  // The variation name the operator picked, required (below) whenever the
  // product carries any — absent for a product sold one way only.
  variation?: string;
}

interface ModifierModalProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (product: Product, opts: AddToCartOpts) => void;
}

// Opens for products that carry modifiers (add-ons) or whenever item notes are
// wanted. Modifiers are plain labels — they don't change the price (the model
// has no per-modifier price); only qty drives the line total.
export function ModifierModal({
  product,
  open,
  onOpenChange,
  onConfirm,
}: ModifierModalProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [qty, setQty] = useState(1);
  // Undefined = nothing picked yet. A variation item has no meaningful
  // default (Small vs Large) — seeding this with variations[0] would let the
  // confirm button fire right away and silently bill the cheapest size, so it
  // starts empty and confirm stays disabled below until the operator taps one.
  const [variation, setVariation] = useState<string | undefined>(undefined);

  // Reset the form each time a new product is opened.
  useEffect(() => {
    if (open) {
      setSelected([]);
      setInstructions("");
      setQty(1);
      setVariation(undefined);
    }
  }, [open, product?._id]);

  if (!product) return null;

  const hasVariations = (product.variations?.length ?? 0) > 0;
  const chosenVariation = variation
    ? product.variations?.find((v) => v.name === variation)
    : undefined;
  // Before a size is picked there is no unit price to show — falling back to
  // the base `price` here would look exactly like the silent default this
  // modal must not offer, so it stays `null` until a variation is chosen.
  const unit = chosenVariation
    ? effectivePrice({ price: chosenVariation.price, discount: product.discount })
    : hasVariations
      ? null
      : effectivePrice(product);
  const confirmDisabled = hasVariations && !variation;

  const toggle = (modifier: string, checked: boolean) => {
    setSelected((prev) =>
      checked ? [...prev, modifier] : prev.filter((m) => m !== modifier),
    );
  };

  const confirm = () => {
    onConfirm(product, {
      modifiers: selected,
      instructions: instructions.trim(),
      qty,
      variation,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
          <DialogDescription>
            {unit === null
              ? "Pick a variation to continue."
              : `${inr(unit)} each — choose add-ons and quantity.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {hasVariations && (
            <div className="space-y-2">
              <Label>Variation (required)</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {product.variations!.map((v) => {
                  const active = v.name === variation;
                  const price = effectivePrice({
                    price: v.price,
                    discount: product.discount,
                  });
                  return (
                    <button
                      key={v.name}
                      type="button"
                      onClick={() => setVariation(v.name)}
                      className={cn(
                        "rounded-md border py-2 text-sm font-semibold transition-colors",
                        active
                          ? "border-primary bg-accent ring-2 ring-primary ring-offset-1"
                          : "hover:border-primary hover:bg-accent",
                      )}
                    >
                      {v.name}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {inr(price)}
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
                  <label
                    key={modifier}
                    className="flex items-center gap-2 text-sm"
                  >
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
            <Label htmlFor="item-instructions">Instructions (optional)</Label>
            <Textarea
              id="item-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. less spicy, no onions"
              rows={2}
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
                onClick={() => setQty((q) => q + 1)}
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={confirm}
            disabled={confirmDisabled}
            className="w-full sm:w-auto"
          >
            {unit === null ? "Pick a variation" : `Add ${qty} — ${inr(unit * qty)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
