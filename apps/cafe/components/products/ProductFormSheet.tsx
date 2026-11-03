"use client";

import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { createProductSchema, type CreateProductInput } from "@/schemas";
import { isProductIconKey } from "@pos/shared/product-icons";
import { useCreateProduct, useUpdateProduct } from "@/hooks/use-products";
import { useStations } from "@/hooks/use-print-setup";
import {
  addOnsFormError, modifierPricesForCreate, modifierPricesForEdit, priceForSave, valuesForValidation, type ProductFormValues,
} from "@/lib/product-form-values";
import { MENU_SELECT_TRIGGER_CLASS } from "@/lib/menu-layout";
import {
  MENU_EDITOR_CELL_RIGHT_CLASS,
  MENU_EDITOR_INPUT_CLASS,
  MENU_EDITOR_NUMBER_CLASS,
  MENU_EDITOR_PERCENT_BOX_CLASS,
  MENU_EDITOR_SELECT_CLASS,
} from "@/lib/menu-editor-layout";
import { cn } from "@/lib/utils";
import { StationSelect } from "@/components/print/setup/StationSelect";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditorField } from "@/components/products/EditorField";
import { ItemEditorFooter, ItemEditorFrame } from "@/components/products/ItemEditorFrame";
import { ItemSwitchesField } from "@/components/products/ItemSwitchesCard";
import { ItemArchiveLink } from "@/components/products/ItemArchiveLink";
import { PriceModeField } from "@/components/products/PriceModeField";
import { ModifierInput } from "@/components/products/ModifierInput";
import { ProductArtField } from "@/components/products/ProductArtField";
import { KitchenTicketField } from "@/components/products/KitchenTicketField";
import { ModifiersPreselectedField, modifiersPreselectedToSave } from "@/components/products/ModifiersPreselectedField";
import type { Category, Product } from "@/types";

interface ProductFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null; // null → create
  categories: Category[];
  /** Archive item (an active item being edited): the page opens today's confirm over the editor. */
  onArchive?: (product: Product) => void;
  /** Restore item (an archived item being edited): the page restores at once. */
  onRestore?: (product: Product) => void;
  restoring?: boolean;
}

// Several fields carry zod defaults, so the form holds the (looser) input type (ProductFormValues, lib/product-form-values.ts)
// while submit receives the transformed output (CreateProductInput).

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

const schemaResolver = zodResolver(createProductSchema);

export function ProductFormSheet({
  open,
  onOpenChange,
  product,
  categories,
  onArchive,
  onRestore,
  restoring = false,
}: ProductFormSheetProps) {
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const isEdit = !!product;
  // Printing Phase 2 Session 2D (spec §6.2): read only while the sheet is open.
  const { stations } = useStations(open);

  const {
    register,
    handleSubmit,
    control,
    reset,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<ProductFormValues, unknown, CreateProductInput>({
    // A base-price problem in Sizes mode (its box is not drawn) never blocks Save: lib/product-form-values.ts. The
    // server's add-on amount rule runs here too, so a refusal shows under Modifiers before any request.
    resolver: async (values, context, options) => {
      const result = await schemaResolver(valuesForValidation(values), context, options);
      const message = addOnsFormError(values);
      return message ? { values: {}, errors: { ...result.errors, modifierPrices: { type: "validate", message } } } : result;
    },
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
            modifierPrices: product.modifierPrices,
            publicVisible: product.publicVisible,
            // A stored key that predates a catalogue change reads as "none" —
            // saving would otherwise resend an icon the enum now rejects (400).
            icon: isProductIconKey(product.icon) ? product.icon : undefined,
            // The saved id as it is: a station list still loading never clears it on save.
            stationId: product.stationId,
            noKot: product.noKot,
          }
        : emptyValues,
    );
  }, [open, product, reset]);

  const modifierCount = useWatch({ control, name: "modifiers" })?.length ?? 0;
  const ticked = useWatch({ control, name: "modifiersPreselected" }) === true;
  const modifierPrices = useWatch({ control, name: "modifierPrices" });

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
            price: priceForSave({ hasVariations: values.variations !== undefined, price: values.price }, false),
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
            // Amounts: the list, null (cleared; the PUT's sentinel) when it had some and has none, else no key.
            modifierPrices: modifierPricesForEdit(values, product.modifierPrices),
            // Same null sentinel as variations above: the switch reads ON as
            // `undefined` (omit-empty), which JSON.stringify would drop — so an
            // item once saved OFF could never be shown again. null is the
            // explicit "back to absent" the PUT route $unsets.
            publicVisible: values.publicVisible ?? null,
            // Same sentinel again: "Remove icon" must reach the server as an
            // explicit clear, and an unpicked icon on a create-shaped value is
            // `undefined`, which JSON drops — null is what $unsets it.
            icon: values.icon ?? null,
            // And once more: "Use the category's station" restores ABSENT.
            stationId: values.stationId ?? null,
            // Same sentinel: "Same as its category" restores ABSENT (the PUT route $unsets a null).
            noKot: values.noKot ?? null,
          },
        });
      } else {
        await createProduct.mutateAsync({
          ...values,
          price: priceForSave({ hasVariations: values.variations !== undefined, price: values.price }, true),
          modifiersPreselected: modifiersPreselectedToSave(values),
          modifierPrices: modifierPricesForCreate(values),
        });
      }
      onOpenChange(false);
    } catch {
      // Hook onError already toasted; keep the sheet open for correction.
    }
  };

  const saving = createProduct.isPending || updateProduct.isPending;


  const categoryName = product ? categories.find((c) => c._id === product.categoryId)?.name : undefined;

  // The HTML's editor (values 9; design 6.9): the frame (aside from 1280px, bottom sheet below), then the fields in the
  // design's order, each in the 42px / 38px look. Every field, rule and message is today's.
  return (
    <ItemEditorFrame
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit item" : "Add item"}
      sub={isEdit ? (categoryName ? `${product.name} · ${categoryName}` : product.name) : "Add a new item to the menu"}
      onSubmit={handleSubmit(onSubmit)}
      focusPanel={false}
      footer={<ItemEditorFooter onCancel={() => onOpenChange(false)} saving={saving} submitLabel={isEdit ? "Save changes" : "Add to menu"} />}
    >
      <EditorField label="Item name" htmlFor="product-name" error={errors.name?.message}>
        <Input id="product-name" autoFocus placeholder="e.g. Margherita" className={MENU_EDITOR_INPUT_CLASS} aria-invalid={!!errors.name} {...register("name")} />
      </EditorField>

      <EditorField label="Category" error={errors.categoryId?.message}>
        <Controller
          control={control}
          name="categoryId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger aria-label="Category" aria-invalid={!!errors.categoryId} className={cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS)}>
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
      </EditorField>

      <PriceModeField control={control} register={register} errors={errors} getValues={getValues} setValue={setValue} storedPrice={product?.price ?? 0} />

      <EditorField label="Discount %" htmlFor="product-discount" error={errors.discount?.message}>
        <div className={MENU_EDITOR_PERCENT_BOX_CLASS}>
          <input
            id="product-discount"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            placeholder="0"
            aria-invalid={!!errors.discount}
            className={MENU_EDITOR_NUMBER_CLASS}
            {...register("discount", { valueAsNumber: true })}
          />
          <span aria-hidden="true" className={MENU_EDITOR_CELL_RIGHT_CLASS}>
            %
          </span>
        </div>
      </EditorField>

      <EditorField label="Photo and icon">
        <ProductArtField control={control} />
      </EditorField>

      <EditorField label="Modifiers" htmlFor="product-modifiers" error={(errors.modifiers?.message ?? errors.modifierPrices?.message) as string}>
        <Controller control={control} name="modifiers" render={({ field }) => <ModifierInput id="product-modifiers" value={field.value ?? []} onChange={field.onChange} prices={modifierPrices} onPricesChange={(next) => setValue("modifierPrices", next, { shouldDirty: true })} ticked={ticked} />} />
      </EditorField>
      <Controller
        control={control}
        name="modifiersPreselected"
        render={({ field }) => (
          <ModifiersPreselectedField modifierCount={modifierCount} value={field.value} onChange={field.onChange} />
        )}
      />

      <ItemSwitchesField control={control} />

      <EditorField label="Kitchen station" htmlFor="product-station">
        <Controller
          control={control}
          name="stationId"
          render={({ field }) => (
            <StationSelect
              id="product-station"
              value={field.value ?? ""}
              onChange={(next) => field.onChange(next === "" ? undefined : next)}
              stations={stations}
              inheritLabel="Use the category's station"
              triggerClassName={cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS)}
            />
          )}
        />
      </EditorField>

      <KitchenTicketField control={control} categories={categories} />

      {product && onArchive && onRestore && (
        <ItemArchiveLink product={product} onArchive={onArchive} onRestore={onRestore} restoring={restoring} />
      )}
    </ItemEditorFrame>
  );
}
