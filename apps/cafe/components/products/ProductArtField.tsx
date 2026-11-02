"use client";

import { useState } from "react";
import { Controller, type Control } from "react-hook-form";
import type { z } from "zod";

import type { createProductSchema } from "@/schemas";
import type { ProductIconKey } from "@pos/shared/product-icons";
import { productIconComponent } from "@/lib/product-icon-map";
import { ImageUpload } from "@/components/shared/ImageUpload";
import { IconPicker } from "@/components/products/IconPicker";
import { MENU_EDITOR_HINT_CLASS, MENU_EDITOR_OUTLINE_BUTTON_CLASS } from "@/lib/menu-editor-layout";

// Matches ProductFormSheet's own useForm<ProductFormValues, ...> generic (the
// form's looser z.input type, not the transformed CreateProductInput output).
type ProductFormValues = z.input<typeof createProductSchema>;

interface ProductArtFieldProps {
  control: Control<ProductFormValues>;
}

// Photo + icon picker, together: "A photo shows first. With no photo, the
// icon shows." (owner, 2026-09-30). Pulled out of ProductFormSheet.tsx to
// stay under its line budget.
export function ProductArtField({ control }: ProductArtFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <Controller
      control={control}
      name="image"
      render={({ field: imageField }) => (
        <Controller
          control={control}
          name="icon"
          render={({ field: iconField }) => {
            const icon = iconField.value as ProductIconKey | undefined;
            const Icon = productIconComponent(icon);
            return (
              <div data-ui="item-art" className="grid gap-2">
                <ImageUpload
                  look="menu"
                  value={imageField.value ?? ""}
                  onChange={imageField.onChange}
                  emptyPreview={Icon ? <Icon className="h-6 w-6 text-muted-foreground" /> : undefined}
                  extraActions={
                    <button type="button" className={MENU_EDITOR_OUTLINE_BUTTON_CLASS} onClick={() => setPickerOpen(true)}>
                      {Icon && <Icon className="h-4 w-4" />}
                      {icon ? "Change icon" : "Choose icon"}
                    </button>
                  }
                />
                <p className={MENU_EDITOR_HINT_CLASS}>A photo shows first. With no photo, the icon shows.</p>
                <IconPicker
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  value={icon}
                  onChange={(key) => iconField.onChange(key)}
                />
              </div>
            );
          }}
        />
      )}
    />
  );
}
