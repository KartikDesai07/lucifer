"use client";

import { useProducts } from "@/hooks/use-products";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import type { Product } from "@/types";

// 44 px rows on a touch screen, the house Select idiom (ExpenseFormFields.tsx).
const PICKER_ITEM_CLASS = "pointer-coarse:min-h-11";
const NO_MENU_PLACEHOLDER = "Add a menu item first";
const CHOOSE_PLACEHOLDER = "Choose an item";
const MISSING_ITEM_FALLBACK_NAME = "Item";

// Only what the picker reads off a Product, so a caller can hand over the full list or a slimmer one.
type PickableProduct = Pick<Product, "_id" | "name">;

interface ProductPickerProps {
  id: string;
  /** The stored product id ("" = nothing picked). */
  value: string;
  /** The name stored beside the id; shown when that product is no longer on the menu. */
  currentName?: string;
  /** Both travel together: the id picked and its display name. */
  onChange: (id: string, name: string) => void;
  /** Passed down by a caller that already holds the list; otherwise read from the menu. */
  products?: readonly PickableProduct[];
  className?: string;
  itemClassName?: string;
  invalid?: boolean;
  disabled?: boolean;
}

// A pick-one dropdown over the menu (the free-item reward, scratch-card rewards). The reference is the product's
// id; the name rides along for display only. A stored id that has left the menu stays visible as a disabled
// "Name (not on the menu)" row, so the owner sees it and re-picks instead of seeing a blank box.
export function ProductPicker({
  id,
  value,
  currentName,
  onChange,
  products,
  className = BRAND_CONTROL_CLASS,
  itemClassName = PICKER_ITEM_CLASS,
  invalid,
  disabled,
}: ProductPickerProps) {
  // The hook has no `enabled` gate, but a second subscriber re-reads the bootstrap-seeded cache (no extra request).
  const { data: fetched } = useProducts();
  const pickable = products ?? fetched ?? [];
  const listKnown = products !== undefined || fetched !== undefined;
  const missing = listKnown && value !== "" && !pickable.some((product) => product._id === value);

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const picked = pickable.find((product) => product._id === next);
        onChange(next, picked?.name ?? "");
      }}
      disabled={disabled || pickable.length === 0}
    >
      <SelectTrigger id={id} className={className} aria-invalid={invalid || undefined}>
        <SelectValue placeholder={pickable.length === 0 ? NO_MENU_PLACEHOLDER : CHOOSE_PLACEHOLDER} />
      </SelectTrigger>
      <SelectContent>
        {missing && (
          <SelectItem value={value} disabled className={itemClassName}>
            {`${currentName?.trim() || MISSING_ITEM_FALLBACK_NAME} (not on the menu)`}
          </SelectItem>
        )}
        {pickable.map((product) => (
          <SelectItem key={product._id} value={product._id} className={itemClassName}>
            {product.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
