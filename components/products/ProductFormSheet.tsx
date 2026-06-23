"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createProductSchema, type CreateProductInput } from "@/schemas";
import { UNCATEGORIZED } from "@/lib/constants";
import { useCreateProduct, useUpdateProduct } from "@/hooks/use-products";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUpload } from "@/components/shared/ImageUpload";
import { FormSheet } from "@/components/shared/FormSheet";
import { FormField } from "@/components/shared/FormField";
import { ModifierInput } from "@/components/products/ModifierInput";
import type { Category, Product } from "@/types";

interface ProductFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null; // null → create
  categories: Category[];
}

// Several fields carry zod defaults, so the form holds the (looser) input type
// while submit receives the transformed output (CreateProductInput).
type ProductFormValues = z.input<typeof createProductSchema>;

const emptyValues: ProductFormValues = {
  name: "",
  category: "",
  price: 0,
  discount: 0,
  available: true,
  image: "",
  modifiers: [],
};

export function ProductFormSheet({
  open,
  onOpenChange,
  product,
  categories,
}: ProductFormSheetProps) {
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const isEdit = !!product;

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<ProductFormValues, unknown, CreateProductInput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: emptyValues,
  });

  // Sync the form to the selected product (or blank) each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    reset(
      product
        ? {
            name: product.name,
            category: product.category,
            price: product.price,
            discount: product.discount,
            // Legacy products (pre-`available`) read as available.
            available: product.available !== false,
            image: product.image,
            modifiers: product.modifiers,
          }
        : emptyValues,
    );
  }, [open, product, reset]);

  // The product's own category may have been deleted/renamed to Uncategorized —
  // keep it selectable so editing never silently drops it.
  const categoryNames = Array.from(
    new Set([
      ...categories.map((c) => c.name),
      ...(product?.category ? [product.category] : []),
      UNCATEGORIZED,
    ]),
  );

  const onSubmit = async (values: CreateProductInput) => {
    try {
      if (isEdit) {
        // isActive (archive flag) is managed via archive/restore, never from
        // this form — omit it so an edit can't silently un-archive a product.
        await updateProduct.mutateAsync({
          id: product._id,
          data: {
            name: values.name,
            category: values.category,
            price: values.price,
            discount: values.discount,
            available: values.available,
            image: values.image,
            modifiers: values.modifiers,
          },
        });
      } else {
        await createProduct.mutateAsync(values);
      }
      onOpenChange(false);
    } catch {
      // Hook onError already toasted; keep the sheet open for correction.
    }
  };

  const saving = createProduct.isPending || updateProduct.isPending;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit product" : "Add product"}
      description={
        isEdit
          ? "Update this menu item's details."
          : "Add a new item to the menu."
      }
      submitLabel={isEdit ? "Save changes" : "Add product"}
      saving={saving}
      onSubmit={handleSubmit(onSubmit)}
      contentClassName="overflow-y-auto"
    >
      <Controller
        control={control}
        name="image"
        render={({ field }) => (
          <ImageUpload value={field.value ?? ""} onChange={field.onChange} />
        )}
      />

      <FormField label="Name" error={errors.name?.message}>
        <Input autoFocus aria-invalid={!!errors.name} {...register("name")} />
      </FormField>

      <FormField label="Category" error={errors.category?.message}>
        <Controller
          control={control}
          name="category"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger aria-invalid={!!errors.category}>
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categoryNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Price (₹)" error={errors.price?.message}>
          <Input
            type="number"
            min={0}
            aria-invalid={!!errors.price}
            {...register("price", { valueAsNumber: true })}
          />
        </FormField>
        <FormField label="Discount %" error={errors.discount?.message}>
          <Input
            type="number"
            min={0}
            max={100}
            {...register("discount", { valueAsNumber: true })}
          />
        </FormField>
      </div>

      <FormField label="Modifiers" error={errors.modifiers?.message as string}>
        <Controller
          control={control}
          name="modifiers"
          render={({ field }) => (
            <ModifierInput value={field.value ?? []} onChange={field.onChange} />
          )}
        />
      </FormField>

      <Controller
        control={control}
        name="available"
        render={({ field }) => (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Available</p>
              <p className="text-xs text-muted-foreground">
                Turn off to mark out of stock (86) — disabled in the POS, still
                on the menu.
              </p>
            </div>
            <Switch
              aria-label="Available"
              checked={field.value ?? true}
              onCheckedChange={field.onChange}
            />
          </div>
        )}
      />
    </FormSheet>
  );
}
