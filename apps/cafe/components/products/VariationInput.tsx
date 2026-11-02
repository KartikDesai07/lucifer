"use client";

import { Plus, Trash2 } from "lucide-react";

import { addSizeRow } from "@/lib/product-form-values";
import { MAX_VARIATIONS } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { MenuNumberBox } from "@/components/products/MenuNumberBox";
import {
  MENU_EDITOR_ADD_SIZE_CLASS,
  MENU_EDITOR_INPUT_CLASS,
  MENU_EDITOR_SIZES_CLASS,
  MENU_EDITOR_SIZE_BOX_CLASS,
  MENU_EDITOR_SIZE_CELL_CLASS,
  MENU_EDITOR_SIZE_NUMBER_CLASS,
  MENU_EDITOR_SIZE_REMOVE_CLASS,
  MENU_EDITOR_SIZE_ROW_CLASS,
} from "@/lib/menu-editor-layout";
import type { ProductVariation } from "@/types";

interface VariationInputProps {
  value: ProductVariation[];
  onChange: (next: ProductVariation[]) => void;
}

// The size rows (values 9.2 #3): the name, the 130px rupee box, the 36px remove; then the dashed "Add size". A variation isn't a
// free-text tag, it is a NAME the operator must pick at order time and a PRICE that line bills at, so each row carries both.
// Today's rules stay: at most MAX_VARIATIONS (20) rows, the names' limits and messages are the schema's. The last row cannot be
// removed (the HTML keeps two; today's schema keeps one: switching to Single price is how sizes go).
export function VariationInput({ value, onChange }: VariationInputProps) {
  const update = (index: number, patch: Partial<ProductVariation>) => {
    onChange(value.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  };
  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div data-ui="item-sizes" className={MENU_EDITOR_SIZES_CLASS}>
      {value.map((variation, index) => (
        // No stable id on a variation row (it isn't a document of its own — same {_id:false} reasoning as OrderItem), so the
        // array index is the key, exactly like the rest of this form's array-of-plain-object rows.
        <div key={index} className={MENU_EDITOR_SIZE_ROW_CLASS}>
          <Input
            value={variation.name}
            onChange={(e) => update(index, { name: e.target.value })}
            placeholder="Size name · e.g. Small"
            className={MENU_EDITOR_INPUT_CLASS}
            aria-label="Variation name"
          />
          <div className={MENU_EDITOR_SIZE_BOX_CLASS}>
            <span aria-hidden="true" className={MENU_EDITOR_SIZE_CELL_CLASS}>
              ₹
            </span>
            <MenuNumberBox
              value={variation.price}
              onChange={(price) => update(index, { price })}
              className={MENU_EDITOR_SIZE_NUMBER_CLASS}
              aria-label="Variation price"
            />
          </div>
          <button
            type="button"
            title="Remove size"
            aria-label="Remove variation"
            className={MENU_EDITOR_SIZE_REMOVE_CLASS}
            disabled={value.length <= 1}
            onClick={() => remove(index)}
          >
            <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={MENU_EDITOR_ADD_SIZE_CLASS}
        onClick={() => onChange(addSizeRow(value))}
        disabled={value.length >= MAX_VARIATIONS}
      >
        <Plus size={13} strokeWidth={2.2} aria-hidden="true" /> Add size
      </button>
    </div>
  );
}
