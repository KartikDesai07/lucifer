"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { effectivePrice } from "@/hooks/use-cart";
import { inr } from "@/lib/utils";
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

  // Reset the form each time a new product is opened.
  useEffect(() => {
    if (open) {
      setSelected([]);
      setInstructions("");
      setQty(1);
    }
  }, [open, product?._id]);

  if (!product) return null;

  const unit = effectivePrice(product);

  const toggle = (modifier: string, checked: boolean) => {
    setSelected((prev) =>
      checked ? [...prev, modifier] : prev.filter((m) => m !== modifier),
    );
  };

  const confirm = () => {
    onConfirm(product, { modifiers: selected, instructions: instructions.trim(), qty });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
          <DialogDescription>
            {inr(unit)} each — choose add-ons and quantity.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
          <Button onClick={confirm} className="w-full sm:w-auto">
            Add {qty} — {inr(unit * qty)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
