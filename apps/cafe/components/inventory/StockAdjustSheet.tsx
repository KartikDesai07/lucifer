"use client";

import { useState } from "react";

import { STOCK_ENTRY_NOTE_MAX_LEN, WASTE_REASONS, formatQty } from "@pos/shared/inventory";
import { useCreateStockEntry } from "@/hooks/use-inventory";
import {
  buildStockEntryInput,
  countChangeText,
  initialAdjustValues,
  stockEntryDateBounds,
  validateAdjustForm,
  type StockAdjustErrors,
  type StockAdjustKind,
  type StockAdjustValues,
} from "@/lib/inventory/stock-adjust-form";
import { parseQtyText } from "@/lib/inventory/stock-item-form";
import { MENU_EDITOR_HINT_CLASS, MENU_EDITOR_INPUT_CLASS, MENU_EDITOR_SELECT_CLASS } from "@/lib/menu-editor-layout";
import { MENU_SELECT_TRIGGER_CLASS } from "@/lib/menu-layout";
import { cafeDateString, cn } from "@/lib/utils";
import { DatePicker } from "@/components/shared/DatePicker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditorField } from "@/components/products/EditorField";
import { ItemEditorFooter, ItemEditorFrame } from "@/components/products/ItemEditorFrame";
import { QtyBox } from "@/components/inventory/QtyBox";
import type { StockItemDto } from "@/types/inventory";

/** Shown in the unit cell before an item is picked. */
const NO_UNIT_CELL = "—";
// The date button wears the select's look (38px, 13.5px), with its own calendar icon kept in the flow.
const DATE_TRIGGER_CLASS = "h-[38px] rounded-[9px] border-border bg-card px-3 text-[13.5px] font-medium text-foreground";

const COPY: Record<StockAdjustKind, { title: string; sub: string; qtyLabel: string; submit: string }> = {
  waste: { title: "Log wastage", sub: "What was thrown away. It comes out of stock.", qtyLabel: "How much", submit: "Log wastage" },
  count: { title: "Count stock", sub: "Type how much you have now. Stock is set to it.", qtyLabel: "How much you have now", submit: "Save count" },
};

interface StockAdjustSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: StockAdjustKind;
  /** The active stock items to pick from. */
  items: StockItemDto[];
  /** Opened from one item: it starts picked. */
  initialItemId?: string;
}

// Log wastage / Count stock, one sheet. The parent remounts it (a new key) on every open, so the form and its clientRef
// start fresh; a failed Save keeps the clientRef, so the retry is a server replay and never a second entry.
export function StockAdjustSheet({ open, onOpenChange, kind, items, initialItemId }: StockAdjustSheetProps) {
  const create = useCreateStockEntry();
  const [today] = useState(() => cafeDateString());
  const [clientRef] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<StockAdjustValues>(() =>
    initialAdjustValues(items.some((i) => i.id === initialItemId) ? (initialItemId ?? null) : null, today),
  );
  const [errors, setErrors] = useState<StockAdjustErrors>({});
  const copy = COPY[kind];
  const bounds = stockEntryDateBounds(today);
  const item = items.find((i) => i.id === values.itemId);
  const set = (patch: Partial<StockAdjustValues>) => setValues((v) => ({ ...v, ...patch }));

  const counted = parseQtyText(values.qtyText);
  const countHint =
    kind === "count" && item && counted.kind === "ok"
      ? `The list shows ${formatQty(item.qtyMilli, item.unit)}. This count changes it by ${countChangeText(item.qtyMilli, counted.milli, item.unit)}.`
      : null;

  const submit = async () => {
    const found = validateAdjustForm(kind, values, today);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await create.mutateAsync(buildStockEntryInput(kind, values, clientRef, today));
      onOpenChange(false);
    } catch {
      // The hook already toasted; the sheet stays open and a retry reuses the same clientRef.
    }
  };

  return (
    <ItemEditorFrame
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      sub={copy.sub}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      focusPanel={false}
      footer={<ItemEditorFooter onCancel={() => onOpenChange(false)} saving={create.isPending} submitLabel={copy.submit} />}
    >
      <EditorField label="Stock item" error={errors.item}>
        <Select value={values.itemId} onValueChange={(itemId) => set({ itemId })}>
          <SelectTrigger aria-label="Stock item" aria-invalid={!!errors.item} className={cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS)}>
            <SelectValue placeholder="Pick a stock item" />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </EditorField>

      <EditorField label={copy.qtyLabel} htmlFor="stock-adjust-qty" error={errors.qty}>
        <QtyBox id="stock-adjust-qty" value={values.qtyText} onChange={(qtyText) => set({ qtyText })} unitCode={item?.unit ?? NO_UNIT_CELL} invalid={!!errors.qty} />
        {countHint && <p className={MENU_EDITOR_HINT_CLASS}>{countHint}</p>}
      </EditorField>

      {kind === "waste" && (
        <>
          <EditorField label="Reason" error={errors.reason}>
            <Select value={values.reason} onValueChange={(reason) => set({ reason: WASTE_REASONS.find((r) => r === reason) ?? "" })}>
              <SelectTrigger aria-label="Reason" aria-invalid={!!errors.reason} className={cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS)}>
                <SelectValue placeholder="Pick a reason" />
              </SelectTrigger>
              <SelectContent>
                {WASTE_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </EditorField>

          <EditorField label="Date" htmlFor="stock-adjust-date" error={errors.date}>
            {/* The app's own calendar, never the browser's native date popup (owner rule). */}
            <DatePicker
              id="stock-adjust-date"
              min={bounds.min}
              max={bounds.max}
              value={values.date}
              onChange={(date) => set({ date })}
              invalid={!!errors.date}
              className={DATE_TRIGGER_CLASS}
            />
          </EditorField>
        </>
      )}

      <EditorField label="Note (optional)" htmlFor="stock-adjust-note" error={errors.note}>
        <Input
          id="stock-adjust-note"
          autoComplete="off"
          maxLength={STOCK_ENTRY_NOTE_MAX_LEN}
          value={values.note}
          aria-invalid={!!errors.note}
          className={MENU_EDITOR_INPUT_CLASS}
          onChange={(e) => set({ note: e.target.value })}
        />
      </EditorField>
    </ItemEditorFrame>
  );
}
