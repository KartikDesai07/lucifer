"use client";

import { useState } from "react";
import { Controller, type Control } from "react-hook-form";
import type { z } from "zod";

import type { createProductSchema } from "@/schemas";
import type { ProductIconKey } from "@pos/shared/product-icons";
import { productIconComponent } from "@/lib/product-icon-map";
import { ImageUpload } from "@/components/shared/ImageUpload";
import { IconPicker } from "@/components/products/IconPicker";
import { Button } from "@/components/ui/button";

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
              <div className="space-y-2">
                <ImageUpload
                  value={imageField.value ?? ""}
                  onChange={imageField.onChange}
                  emptyPreview={Icon ? <Icon className="h-6 w-6 text-muted-foreground" /> : undefined}
                />
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                    {Icon && <Icon className="mr-2 h-4 w-4" />}
                    {icon ? "Change icon" : "Choose icon"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    A photo shows first. With no photo, the icon shows.
                  </p>
                </div>
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
