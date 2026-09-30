"use client";

import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createProductSchema, type CreateProductInput } from "@/schemas";
import { isProductIconKey } from "@pos/shared/product-icons";
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
import { FormSheet } from "@/components/shared/FormSheet";
import { FormField } from "@/components/shared/FormField";
import { ModifierInput } from "@/components/products/ModifierInput";
import { ProductArtField } from "@/components/products/ProductArtField";
import { VariationsField } from "@/components/products/VariationsField";
import { PublicVisibleField } from "@/components/products/PublicVisibleField";
import { ModifiersPreselectedField, modifiersPreselectedToSave } from "@/components/products/ModifiersPreselectedField";
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
  categoryId: "",
  price: 0,
  // Absent (never []) — the schema is omit-empty, so a plain item stores no
  // `variations` key at all. The "Has variations" switch is what turns this
  // into a seeded one-row array.
  variations: undefined,
  discount: 0,
  available: true,
  image: "",
  modifiers: [],
  modifiersPreselected: false,
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

  // Sync the form to the selected item (or blank) each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    reset(
      product
        ? {
            name: product.name,
            categoryId: product.categoryId,
            price: product.price,
            variations: product.variations,
            discount: product.discount,
            // Legacy items (pre-`available`) read as available.
            available: product.available !== false,
            image: product.image,
            modifiers: product.modifiers,
            modifiersPreselected: product.modifiersPreselected === true,
            publicVisible: product.publicVisible,
            // A stored key that predates a catalogue change reads as "none" —
            // saving would otherwise resend an icon the enum now rejects (400).
            icon: isProductIconKey(product.icon) ? product.icon : undefined,
          }
        : emptyValues,
    );
  }, [open, product, reset]);

  // Drives the "Has variations" hint below Price — read separately from the
  // Controller VariationsField owns so the hint doesn't need its own.
  const variations = useWatch({ control, name: "variations" });
  const hasVariations = Array.isArray(variations);
  const modifierCount = useWatch({ control, name: "modifiers" })?.length ?? 0;

  const onSubmit = async (values: CreateProductInput) => {
    try {
      if (isEdit) {
        // isActive (archive flag) is managed via archive/restore, never from
        // this form — omit it so an edit can't silently un-archive an item.
        await updateProduct.mutateAsync({
          id: product._id,
          data: {
            name: values.name,
            categoryId: values.categoryId,
            price: values.price,
            // `null`, never undefined, when the switch is OFF: JSON.stringify drops
            // an undefined key, so an absent one reads as "leave the stored sizes
            // alone" and the toggle would do nothing at all. null is the explicit
            // "no longer sold by size" the PUT route turns into an $unset.
            variations: values.variations ?? null,
            discount: values.discount,
            available: values.available,
            image: values.image,
            modifiers: values.modifiers,
            modifiersPreselected: modifiersPreselectedToSave(values),
            // Same null sentinel as variations above: the switch reads ON as
            // `undefined` (omit-empty), which JSON.stringify would drop — so an
            // item once saved OFF could never be shown again. null is the
            // explicit "back to absent" the PUT route $unsets.
            publicVisible: values.publicVisible ?? null,
            // Same sentinel again: "Remove icon" must reach the server as an
            // explicit clear, and an unpicked icon on a create-shaped value is
            // `undefined`, which JSON drops — null is what $unsets it.
            icon: values.icon ?? null,
          },
        });
      } else {
        await createProduct.mutateAsync({
          ...values,
          modifiersPreselected: modifiersPreselectedToSave(values),
        });
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
      title={isEdit ? "Edit item" : "Add item"}
      description={
        isEdit ? "Update this menu item's details." : "Add a new item to the menu."
      }
      submitLabel={isEdit ? "Save changes" : "Add item"}
      saving={saving}
      onSubmit={handleSubmit(onSubmit)}
      contentClassName="overflow-y-auto"
    >
      <ProductArtField control={control} />

      <FormField label="Name" error={errors.name?.message}>
        <Input autoFocus aria-invalid={!!errors.name} {...register("name")} />
      </FormField>

      <FormField label="Category" error={errors.categoryId?.message}>
        <Controller
          control={control}
          name="categoryId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger aria-invalid={!!errors.categoryId}>
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
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
          {hasVariations && (
            <p className="text-xs text-muted-foreground">
              Variations set the price — this is only the base/reference
              price.
            </p>
          )}
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
        name="modifiersPreselected"
        render={({ field }) => (
          <ModifiersPreselectedField modifierCount={modifierCount} value={field.value} onChange={field.onChange} />
        )}
      />

      <VariationsField control={control} errors={errors} />

      <Controller
        control={control}
        name="available"
        render={({ field }) => (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">In stock</p>
              <p className="text-xs text-muted-foreground">
                Turn off to mark out of stock — disabled in the POS, still on
                the menu.
              </p>
            </div>
            <Switch
              aria-label="In stock"
              checked={field.value ?? true}
              onCheckedChange={field.onChange}
            />
          </div>
        )}
      />

      <Controller
        control={control}
        name="publicVisible"
        render={({ field }) => <PublicVisibleField value={field.value} onChange={field.onChange} />}
      />
    </FormSheet>
  );
}
