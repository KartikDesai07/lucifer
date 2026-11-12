"use client";

import { useState } from "react";

import { STOCK_ITEM_NAME_MAX_LEN, STOCK_UNITS, STOCK_UNIT_LABEL, formatQty, isStockUnit } from "@pos/shared/inventory";
import { useCreateStockItem, useUpdateStockItem } from "@/hooks/use-inventory";
import {
  buildCreateInput,
  buildUpdateInput,
  initialStockItemValues,
  validateStockItemForm,
  type StockItemFormErrors,
  type StockItemFormValues,
} from "@/lib/inventory/stock-item-form";
import {
  MENU_EDITOR_ARCHIVE_CLASS,
  MENU_EDITOR_CELL_RIGHT_CLASS,
  MENU_EDITOR_HINT_CLASS,
  MENU_EDITOR_INPUT_CLASS,
  MENU_EDITOR_NUMBER_CLASS,
  MENU_EDITOR_PRICE_BOX_CLASS,
  MENU_EDITOR_SELECT_CLASS,
} from "@/lib/menu-editor-layout";
import { MENU_SELECT_TRIGGER_CLASS } from "@/lib/menu-layout";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditorField } from "@/components/products/EditorField";
import { ItemEditorFooter, ItemEditorFrame } from "@/components/products/ItemEditorFrame";
import type { StockItemDto } from "@/types/inventory";

/** Shown in the unit cell before a unit is picked. */
const NO_UNIT_CELL = "—";

interface StockItemSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = add a new stock item. */
  item: StockItemDto | null;
  /** Archive stock item: the page opens its confirm over the editor. */
  onArchive: (item: StockItemDto) => void;
}

interface QtyBoxProps {
  id: string;
  value: string;
  onChange: (text: string) => void;
  unitCode: string;
  invalid: boolean;
}

// A typed quantity with the item's unit after it (the Discount field's "%" box). Text, not a number input: the
// form turns it into milli-units itself, so "1.5", ".5" and "2" all work and a mouse wheel never nudges it.
function QtyBox({ id, value, onChange, unitCode, invalid }: QtyBoxProps) {
  return (
    <div className={MENU_EDITOR_PRICE_BOX_CLASS}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        aria-invalid={invalid}
        className={MENU_EDITOR_NUMBER_CLASS}
        onChange={(e) => onChange(e.target.value)}
      />
      <span aria-hidden="true" className={MENU_EDITOR_CELL_RIGHT_CLASS}>
        {unitCode}
      </span>
    </div>
  );
}

// The Add / Edit stock item editor. The unit is picked once, when the item is added, and is read-only after that
// (stock is counted in it); an edit changes only the name and the low-stock line. A stock number is never typed
// on an edit: it moves with sales.
export function StockItemSheet({ open, onOpenChange, item, onArchive }: StockItemSheetProps) {
  const create = useCreateStockItem();
  const update = useUpdateStockItem();
  const isEdit = item !== null;
  // The parent remounts this sheet (a new key) on every open, so the form always starts from the item.
  const [values, setValues] = useState<StockItemFormValues>(() => initialStockItemValues(item));
  const [errors, setErrors] = useState<StockItemFormErrors>({});
  const saving = create.isPending || update.isPending;
  const set = (patch: Partial<StockItemFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const unitCode = values.unit === "" ? NO_UNIT_CELL : values.unit;

  const submit = async () => {
    const found = validateStockItemForm(values, isEdit);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      if (item) {
        const input = buildUpdateInput(item, values);
        if (input) await update.mutateAsync({ id: item.id, input });
      } else {
        await create.mutateAsync(buildCreateInput(values));
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
      title={isEdit ? "Edit stock item" : "Add stock item"}
      sub={isEdit ? `In stock now: ${formatQty(item.qtyMilli, item.unit)}` : "What you keep in stock, and how much you have now."}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      focusPanel={false}
      footer={<ItemEditorFooter onCancel={() => onOpenChange(false)} saving={saving} submitLabel={isEdit ? "Save changes" : "Add stock item"} />}
    >
      <EditorField label="Name" htmlFor="stock-item-name" error={errors.name}>
        <Input
          id="stock-item-name"
          autoFocus={!isEdit}
          placeholder="e.g. Milk"
          maxLength={STOCK_ITEM_NAME_MAX_LEN}
          value={values.name}
          aria-invalid={!!errors.name}
          className={MENU_EDITOR_INPUT_CLASS}
          onChange={(e) => set({ name: e.target.value })}
        />
      </EditorField>

      <EditorField label="Unit" error={errors.unit}>
        {isEdit ? (
          <p className="text-[14.5px] text-foreground">{`${STOCK_UNIT_LABEL[item.unit]}. You can't change it.`}</p>
        ) : (
          <>
            <Select value={values.unit} onValueChange={(next) => isStockUnit(next) && set({ unit: next })}>
              <SelectTrigger aria-label="Unit" aria-invalid={!!errors.unit} className={cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS)}>
                <SelectValue placeholder="Pick a unit" />
              </SelectTrigger>
              <SelectContent>
                {STOCK_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {STOCK_UNIT_LABEL[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className={MENU_EDITOR_HINT_CLASS}>You can&apos;t change the unit later.</p>
          </>
        )}
      </EditorField>

      {!isEdit && (
        <EditorField label="How much you have now" htmlFor="stock-item-opening" error={errors.opening}>
          <QtyBox id="stock-item-opening" value={values.openingText} onChange={(openingText) => set({ openingText })} unitCode={unitCode} invalid={!!errors.opening} />
          <p className={MENU_EDITOR_HINT_CLASS}>Leave empty for 0.</p>
        </EditorField>
      )}

      <EditorField label="Low stock warning at (optional)" htmlFor="stock-item-low-at" error={errors.lowAt}>
        <QtyBox id="stock-item-low-at" value={values.lowAtText} onChange={(lowAtText) => set({ lowAtText })} unitCode={unitCode} invalid={!!errors.lowAt} />
        <p className={MENU_EDITOR_HINT_CLASS}>The list shows Low when stock is at or under this.</p>
      </EditorField>

      {item && (
        <button type="button" className={MENU_EDITOR_ARCHIVE_CLASS} disabled={saving} onClick={() => onArchive(item)}>
          Archive stock item
        </button>
      )}
    </ItemEditorFrame>
  );
}
