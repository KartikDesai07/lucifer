"use client";

import { useCategories } from "@/hooks/use-categories";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import type { Category } from "@/types";

// 44 px rows on a touch screen, the house Select idiom (ExpenseFormFields.tsx).
const PICKER_ITEM_CLASS = "pointer-coarse:min-h-11";
const NO_CATEGORY_PLACEHOLDER = "Add a category first";
const CHOOSE_PLACEHOLDER = "Choose a category";
const MISSING_CATEGORY_FALLBACK_NAME = "Category";

// Only what the picker reads off a Category.
type PickableCategory = Pick<Category, "_id" | "name">;

interface CategoryPickerProps {
  id: string;
  /** The stored category id ("" = nothing picked). */
  value: string;
  /** The name stored beside the id; shown when that category has been deleted. */
  currentName?: string;
  /** Both travel together: the id picked and its display name. */
  onChange: (id: string, name: string) => void;
  /** Passed down by a caller that already holds the list; otherwise read from the menu's categories. */
  categories?: readonly PickableCategory[];
  className?: string;
  itemClassName?: string;
  invalid?: boolean;
  disabled?: boolean;
}

// A pick-one dropdown over the categories (the "% off a category" scratch-card rewards). Same shape as
// ProductPicker: a stored id that has been deleted stays visible as a disabled "Name (deleted)" row.
export function CategoryPicker({
  id,
  value,
  currentName,
  onChange,
  categories,
  className = BRAND_CONTROL_CLASS,
  itemClassName = PICKER_ITEM_CLASS,
  invalid,
  disabled,
}: CategoryPickerProps) {
  const { data: fetched } = useCategories();
  const pickable = categories ?? fetched ?? [];
  const listKnown = categories !== undefined || fetched !== undefined;
  const missing = listKnown && value !== "" && !pickable.some((category) => category._id === value);

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const picked = pickable.find((category) => category._id === next);
        onChange(next, picked?.name ?? "");
      }}
      disabled={disabled || pickable.length === 0}
    >
      <SelectTrigger id={id} className={className} aria-invalid={invalid || undefined}>
        <SelectValue placeholder={pickable.length === 0 ? NO_CATEGORY_PLACEHOLDER : CHOOSE_PLACEHOLDER} />
      </SelectTrigger>
      <SelectContent>
        {missing && (
          <SelectItem value={value} disabled className={itemClassName}>
            {`${currentName?.trim() || MISSING_CATEGORY_FALLBACK_NAME} (deleted)`}
          </SelectItem>
        )}
        {pickable.map((category) => (
          <SelectItem key={category._id} value={category._id} className={itemClassName}>
            {category.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
