"use client";

import { Trash2 } from "lucide-react";

import { lineAmountPaise, type PurchaseLineErrors, type PurchaseLineValues } from "@/lib/inventory/purchase-form";
import {
  MENU_EDITOR_CARD_CLASS,
  MENU_EDITOR_CELL_LEFT_CLASS,
  MENU_EDITOR_NUMBER_CLASS,
  MENU_EDITOR_PRICE_BOX_CLASS,
  MENU_EDITOR_SELECT_CLASS,
  MENU_EDITOR_SIZE_REMOVE_CLASS,
} from "@/lib/menu-editor-layout";
import { MENU_SELECT_TRIGGER_CLASS } from "@/lib/menu-layout";
import { cn, inrPaise } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditorField } from "@/components/products/EditorField";
import { QtyBox } from "@/components/inventory/QtyBox";
import type { StockItemDto } from "@/types/inventory";

/** Shown in the unit cell before an item is picked. */
const NO_UNIT_CELL = "—";
const NO_AMOUNT = "—";

interface PurchaseLineRowProps {
  line: PurchaseLineValues;
  /** 1-based, for the labels ("Item 2"). */
  number: number;
  /** The items this line may pick: every stock item not already used by another line. */
  items: StockItemDto[];
  /** All active stock items, to read the picked one's unit. */
  allItems: StockItemDto[];
  errors: PurchaseLineErrors | undefined;
  canRemove: boolean;
  disabled: boolean;
  onChange: (patch: Partial<PurchaseLineValues>) => void;
  onRemove: () => void;
}

// One bought item: pick it, type how much (in the item's own unit) and what ONE unit cost, and see the line's amount.
// A phone shows the item over two boxes side by side; nothing in the row is wider than the sheet.
export function PurchaseLineRow({ line, number, items, allItems, errors, canRemove, disabled, onChange, onRemove }: PurchaseLineRowProps) {
  const item = allItems.find((i) => i.id === line.itemId);
  const unit = item?.unit ?? NO_UNIT_CELL;
  const amount = lineAmountPaise(line);
  const qtyId = `purchase-qty-${line.key}`;
  const rateId = `purchase-rate-${line.key}`;

  return (
    <div className={cn(MENU_EDITOR_CARD_CLASS, "gap-3 p-3")}>
      <EditorField label={`Item ${number}`} error={errors?.item}>
        <Select value={line.itemId} onValueChange={(itemId) => onChange({ itemId })}>
          <SelectTrigger aria-label={`Stock item ${number}`} aria-invalid={!!errors?.item} className={cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS)}>
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

      <div className="grid grid-cols-2 items-start gap-2">
        <EditorField label="How much" htmlFor={qtyId} error={errors?.qty}>
          <QtyBox id={qtyId} value={line.qtyText} onChange={(qtyText) => onChange({ qtyText })} unitCode={unit} invalid={!!errors?.qty} />
        </EditorField>
        <EditorField label={item ? `Price per ${item.unit}` : "Price per unit"} htmlFor={rateId} error={errors?.rate}>
          <div className={MENU_EDITOR_PRICE_BOX_CLASS}>
            <label htmlFor={rateId} className={MENU_EDITOR_CELL_LEFT_CLASS}>
              ₹
            </label>
            <input
              id={rateId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={line.rateText}
              aria-invalid={!!errors?.rate}
              className={MENU_EDITOR_NUMBER_CLASS}
              onChange={(e) => onChange({ rateText: e.target.value })}
            />
          </div>
        </EditorField>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">
          Amount <span className="font-semibold tabular-nums text-foreground">{amount === null ? NO_AMOUNT : inrPaise(amount)}</span>
        </span>
        {canRemove && (
          <button type="button" aria-label={`Remove item ${number}`} disabled={disabled} className={MENU_EDITOR_SIZE_REMOVE_CLASS} onClick={onRemove}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
