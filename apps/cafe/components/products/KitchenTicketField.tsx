"use client";

import { useController, useWatch, type Control } from "react-hook-form";
import type { z } from "zod";

import type { createProductSchema } from "@/schemas";
import { FormField } from "@/components/shared/FormField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  KITCHEN_ITEM_ALWAYS_LABEL,
  KITCHEN_ITEM_NEVER_LABEL,
  KITCHEN_ITEM_SELECT_LABEL,
  kitchenItemSameLabel,
} from "@/lib/kitchen-lines";
import type { Category } from "@/types";

// Must match ProductFormSheet's own useForm<ProductFormValues, ...> generic (the looser z.input type).
type ProductFormValues = z.input<typeof createProductSchema>;

interface KitchenTicketFieldProps {
  control: Control<ProductFormValues>;
  categories: readonly Category[];
}

// The Select's own values; `noKot` stores them as: same = absent, always = false, never = true.
const SAME = "same";
const ALWAYS = "always";
const NEVER = "never";

function choiceOf(noKot: boolean | undefined): string {
  if (noKot === undefined) return SAME;
  return noKot ? NEVER : ALWAYS;
}

function noKotOf(choice: string): boolean | undefined {
  if (choice === NEVER) return true;
  if (choice === ALWAYS) return false;
  return undefined;
}

// Skip-KOT (owner F1): the item's own choice over its category's. "Same as its category" names what the
// category does right now; picking it stores nothing (the form's submit sends null, so the API removes the flag).
export function KitchenTicketField({ control, categories }: KitchenTicketFieldProps) {
  const { field } = useController({ control, name: "noKot" });
  const categoryId = useWatch({ control, name: "categoryId" });
  const categorySkips = categories.find((category) => category._id === categoryId)?.noKot === true;
  return (
    <FormField label={KITCHEN_ITEM_SELECT_LABEL} htmlFor="product-kitchen-ticket">
      <Select value={choiceOf(field.value)} onValueChange={(choice) => field.onChange(noKotOf(choice))}>
        <SelectTrigger id="product-kitchen-ticket" className="min-h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SAME}>{kitchenItemSameLabel(categorySkips)}</SelectItem>
          <SelectItem value={ALWAYS}>{KITCHEN_ITEM_ALWAYS_LABEL}</SelectItem>
          <SelectItem value={NEVER}>{KITCHEN_ITEM_NEVER_LABEL}</SelectItem>
        </SelectContent>
      </Select>
    </FormField>
  );
}
