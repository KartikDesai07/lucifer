"use client";

import { Plus, Trash2 } from "lucide-react";

import { MAX_VARIATIONS } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ProductVariation } from "@/types";

interface VariationInputProps {
  value: ProductVariation[];
  onChange: (next: ProductVariation[]) => void;
}

// Sibling of ModifierInput: a variation isn't a free-text tag, it is a NAME the
// operator must pick at order time and a PRICE that line bills at, so each row
// carries both — rather than the single text field + Enter-to-add idiom.
export function VariationInput({ value, onChange }: VariationInputProps) {
  const update = (index: number, patch: Partial<ProductVariation>) => {
    onChange(value.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const add = () => {
    if (value.length >= MAX_VARIATIONS) return;
    onChange([...value, { name: "", price: 0 }]);
  };

  return (
    <div className="space-y-2">
      {value.map((variation, index) => (
        // No stable id on a variation row (it isn't a document of its own — same
        // {_id:false} reasoning as OrderItem), so the array index is the key,
        // exactly like the rest of this form's array-of-plain-object rows.
        <div key={index} className="flex items-center gap-2">
          <Input
            value={variation.name}
            onChange={(e) => update(index, { name: e.target.value })}
            placeholder="e.g. Small"
            className="flex-1"
            aria-label="Variation name"
          />
          <Input
            type="number"
            min={0}
            value={variation.price}
            onChange={(e) =>
              update(index, { price: e.target.valueAsNumber || 0 })
            }
            placeholder="Price (₹)"
            className="w-28"
            aria-label="Variation price"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(index)}
            aria-label="Remove variation"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={value.length >= MAX_VARIATIONS}
      >
        <Plus className="mr-2 h-4 w-4" /> Add variation
      </Button>
    </div>
  );
}
