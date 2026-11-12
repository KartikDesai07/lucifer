"use client";

import { useState } from "react";

import { SUPPLIER_NAME_MAX_LEN, SUPPLIER_NOTE_MAX_LEN, SUPPLIER_PHONE_MAX_LEN } from "@pos/shared/inventory";
import { useCreateSupplier, useUpdateSupplier } from "@/hooks/use-inventory";
import {
  buildSupplierCreateInput,
  buildSupplierUpdateInput,
  dueLabel,
  initialSupplierValues,
  validateSupplierForm,
  type SupplierFormErrors,
  type SupplierFormValues,
} from "@/lib/inventory/supplier-form";
import { MENU_EDITOR_ARCHIVE_CLASS, MENU_EDITOR_INPUT_CLASS } from "@/lib/menu-editor-layout";
import { Input } from "@/components/ui/input";
import { EditorField } from "@/components/products/EditorField";
import { ItemEditorFooter, ItemEditorFrame } from "@/components/products/ItemEditorFrame";
import type { SupplierDto } from "@/types/inventory";

interface SupplierSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = add a new supplier. */
  supplier: SupplierDto | null;
  /** Archive supplier: the page opens its confirm over the editor. */
  onArchive: (supplier: SupplierDto) => void;
}

// The Add / Edit supplier editor. The parent remounts it (a new key) on every open, so the form starts from the supplier.
// What a supplier is owed is worked out from purchases, never typed here.
export function SupplierSheet({ open, onOpenChange, supplier, onArchive }: SupplierSheetProps) {
  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const isEdit = supplier !== null;
  const [values, setValues] = useState<SupplierFormValues>(() => initialSupplierValues(supplier));
  const [errors, setErrors] = useState<SupplierFormErrors>({});
  const saving = create.isPending || update.isPending;
  const set = (patch: Partial<SupplierFormValues>) => setValues((v) => ({ ...v, ...patch }));

  const submit = async () => {
    const found = validateSupplierForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      if (supplier) {
        const input = buildSupplierUpdateInput(supplier, values);
        if (input) await update.mutateAsync({ id: supplier.id, input });
      } else {
        await create.mutateAsync(buildSupplierCreateInput(values));
      }
      onOpenChange(false);
    } catch {
      // The hook already toasted; the sheet stays open for correction.
    }
  };

  return (
    <ItemEditorFrame
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit supplier" : "Add supplier"}
      sub={isEdit ? dueLabel(supplier.duePaise).text : "Who you buy stock from."}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      focusPanel={false}
      footer={<ItemEditorFooter onCancel={() => onOpenChange(false)} saving={saving} submitLabel={isEdit ? "Save changes" : "Add supplier"} />}
    >
      <EditorField label="Name" htmlFor="supplier-name" error={errors.name}>
        <Input
          id="supplier-name"
          autoFocus={!isEdit}
          placeholder="e.g. Raju Dairy"
          autoComplete="off"
          maxLength={SUPPLIER_NAME_MAX_LEN}
          value={values.name}
          aria-invalid={!!errors.name}
          className={MENU_EDITOR_INPUT_CLASS}
          onChange={(e) => set({ name: e.target.value })}
        />
      </EditorField>

      <EditorField label="Phone (optional)" htmlFor="supplier-phone" error={errors.phone}>
        <Input
          id="supplier-phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={SUPPLIER_PHONE_MAX_LEN}
          value={values.phone}
          aria-invalid={!!errors.phone}
          className={MENU_EDITOR_INPUT_CLASS}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </EditorField>

      <EditorField label="Note (optional)" htmlFor="supplier-note" error={errors.note}>
        <Input
          id="supplier-note"
          autoComplete="off"
          maxLength={SUPPLIER_NOTE_MAX_LEN}
          value={values.note}
          aria-invalid={!!errors.note}
          className={MENU_EDITOR_INPUT_CLASS}
          onChange={(e) => set({ note: e.target.value })}
        />
      </EditorField>

      {supplier && (
        <button type="button" className={MENU_EDITOR_ARCHIVE_CLASS} disabled={saving} onClick={() => onArchive(supplier)}>
          Archive supplier
        </button>
      )}
    </ItemEditorFrame>
  );
}
