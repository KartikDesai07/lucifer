"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";

import { PURCHASE_MAX_LINES, STOCK_ENTRY_NOTE_MAX_LEN } from "@pos/shared/inventory";
import { useCreateStockEntry } from "@/hooks/use-inventory";
import {
  buildPurchaseInput,
  initialPurchaseValues,
  newPurchaseLine,
  owedPaiseOf,
  purchaseFormIsValid,
  purchaseValuesTotalPaise,
  validatePurchaseForm,
  type PaidMode,
  type PurchaseErrors,
  type PurchaseLineValues,
  type PurchaseValues,
} from "@/lib/inventory/purchase-form";
import { stockEntryDateBounds } from "@/lib/inventory/stock-adjust-form";
import {
  MENU_EDITOR_ADD_SIZE_CLASS,
  MENU_EDITOR_CELL_LEFT_CLASS,
  MENU_EDITOR_ERROR_CLASS,
  MENU_EDITOR_HINT_CLASS,
  MENU_EDITOR_INPUT_CLASS,
  MENU_EDITOR_NUMBER_CLASS,
  MENU_EDITOR_PRICE_BOX_CLASS,
  MENU_EDITOR_SELECT_CLASS,
} from "@/lib/menu-editor-layout";
import { MENU_SELECT_TRIGGER_CLASS } from "@/lib/menu-layout";
import { cafeDateString, cn, inrPaise } from "@/lib/utils";
import { DatePicker } from "@/components/shared/DatePicker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EditorField } from "@/components/products/EditorField";
import { ItemEditorFooter, ItemEditorFrame } from "@/components/products/ItemEditorFrame";
import { PurchaseLineRow } from "@/components/inventory/PurchaseLineRow";
import type { StockItemDto, SupplierDto } from "@/types/inventory";

// Radix Select cannot hold "" as an item value, so "no supplier" is a named value no stock id can equal (ids are hex).
const NO_SUPPLIER_VALUE = "none";
// The date button wears the select's look (38px, 13.5px), with its own calendar icon kept in the flow.
const DATE_TRIGGER_CLASS = "h-[38px] rounded-[9px] border-border bg-card px-3 text-[13.5px] font-medium text-foreground";
const PAID_OPTIONS: { value: PaidMode; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "part", label: "Part" },
  { value: "nothing", label: "Nothing" },
];
/** The form starts with line-0; the next line added is line-1. */
const FIRST_NEW_LINE_KEY = 1;

interface PurchaseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The active stock items to buy. */
  items: StockItemDto[];
  /** The active suppliers to pick from (empty while they load). */
  suppliers: SupplierDto[];
}

// Add purchase: what came in, from whom, what it cost and what was paid now. It adds each line to stock and anything
// unpaid to the supplier's dues. The parent remounts it (a new key) on every open, so the form and its clientRef start
// fresh; a failed Save keeps the clientRef (a useState initializer, minted once), so the retry is a server replay.
export function PurchaseSheet({ open, onOpenChange, items, suppliers }: PurchaseSheetProps) {
  const create = useCreateStockEntry();
  const [today] = useState(() => cafeDateString());
  const [clientRef] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<PurchaseValues>(() => initialPurchaseValues(today));
  const [errors, setErrors] = useState<PurchaseErrors>({ lineErrors: {} });
  const nextKey = useRef(FIRST_NEW_LINE_KEY);
  const bounds = stockEntryDateBounds(today);
  const set = (patch: Partial<PurchaseValues>) => setValues((v) => ({ ...v, ...patch }));
  const setLine = (key: string, patch: Partial<PurchaseLineValues>) =>
    setValues((v) => ({ ...v, lines: v.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const addLine = () => {
    const key = `line-${nextKey.current++}`;
    setValues((v) => ({ ...v, lines: [...v.lines, newPurchaseLine(key)] }));
  };
  const removeLine = (key: string) => setValues((v) => ({ ...v, lines: v.lines.filter((l) => l.key !== key) }));

  const total = purchaseValuesTotalPaise(values);
  const owed = owedPaiseOf(values);
  const supplier = suppliers.find((s) => s.id === values.supplierId);

  const submit = async () => {
    const found = validatePurchaseForm(values, today);
    setErrors(found);
    if (!purchaseFormIsValid(found)) return;
    try {
      await create.mutateAsync(buildPurchaseInput(values, clientRef));
      onOpenChange(false);
    } catch {
      // The hook already toasted; the sheet stays open and a retry reuses the same clientRef.
    }
  };

  return (
    <ItemEditorFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Add purchase"
      sub="Stock you bought. It goes into stock, and anything unpaid is owed to the supplier."
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      focusPanel={false}
      footer={<ItemEditorFooter onCancel={() => onOpenChange(false)} saving={create.isPending} submitLabel="Save purchase" />}
    >
      <EditorField label="Supplier (optional)" error={errors.supplier}>
        <Select value={values.supplierId === "" ? NO_SUPPLIER_VALUE : values.supplierId} onValueChange={(next) => set({ supplierId: next === NO_SUPPLIER_VALUE ? "" : next })}>
          <SelectTrigger aria-label="Supplier" aria-invalid={!!errors.supplier} className={cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS)}>
            <SelectValue placeholder="No supplier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SUPPLIER_VALUE}>No supplier</SelectItem>
            {suppliers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </EditorField>

      <EditorField label="Date" htmlFor="purchase-date" error={errors.date}>
        {/* The app's own calendar, never the browser's native date popup (owner rule). */}
        <DatePicker id="purchase-date" min={bounds.min} max={bounds.max} value={values.date} onChange={(date) => set({ date })} invalid={!!errors.date} className={DATE_TRIGGER_CLASS} />
      </EditorField>

      {values.lines.map((line, index) => (
        <PurchaseLineRow
          key={line.key}
          line={line}
          number={index + 1}
          items={items.filter((i) => i.id === line.itemId || !values.lines.some((l) => l.itemId === i.id))}
          allItems={items}
          errors={errors.lineErrors[line.key]}
          canRemove={values.lines.length > 1}
          disabled={create.isPending}
          onChange={(patch) => setLine(line.key, patch)}
          onRemove={() => removeLine(line.key)}
        />
      ))}
      {errors.lines && <p className={MENU_EDITOR_ERROR_CLASS}>{errors.lines}</p>}
      {values.lines.length < PURCHASE_MAX_LINES && (
        <button type="button" className={MENU_EDITOR_ADD_SIZE_CLASS} disabled={create.isPending} onClick={addLine}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add another item
        </button>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border-2 pt-3 text-[14.5px]">
        <span className="font-semibold">Total</span>
        <span className="font-semibold tabular-nums">{inrPaise(total)}</span>
      </div>

      <EditorField label="Paid now" error={errors.paid}>
        <SegmentedControl label="Paid now" value={values.paidMode} options={PAID_OPTIONS} onChange={(paidMode) => set({ paidMode })} className="self-start" />
        {values.paidMode === "part" && (
          <div className={MENU_EDITOR_PRICE_BOX_CLASS}>
            <label htmlFor="purchase-paid" className={MENU_EDITOR_CELL_LEFT_CLASS}>
              ₹
            </label>
            <input
              id="purchase-paid"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label="Amount paid now"
              value={values.paidText}
              aria-invalid={!!errors.paid}
              className={MENU_EDITOR_NUMBER_CLASS}
              onChange={(e) => set({ paidText: e.target.value })}
            />
          </div>
        )}
        {owed > 0 && supplier && (
          <p className={MENU_EDITOR_HINT_CLASS}>
            Still to pay {supplier.name}: {inrPaise(owed)}
          </p>
        )}
      </EditorField>

      <EditorField label="Note (optional)" htmlFor="purchase-note" error={errors.note}>
        <Input
          id="purchase-note"
          autoComplete="off"
          maxLength={STOCK_ENTRY_NOTE_MAX_LEN}
          value={values.note}
          aria-invalid={!!errors.note}
          className={MENU_EDITOR_INPUT_CLASS}
          onChange={(e) => set({ note: e.target.value })}
        />
        <p className={MENU_EDITOR_HINT_CLASS}>Purchases are not added to Expenses.</p>
      </EditorField>
    </ItemEditorFrame>
  );
}
