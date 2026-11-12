"use client";

import { useState } from "react";

import { STOCK_ENTRY_NOTE_MAX_LEN } from "@pos/shared/inventory";
import { useCreateStockEntry } from "@/hooks/use-inventory";
import {
  buildPaymentInput,
  initialPaymentValues,
  paymentAfterText,
  paymentAmountPaise,
  validatePaymentForm,
  type PaymentErrors,
  type PaymentValues,
} from "@/lib/inventory/payment-form";
import { stockEntryDateBounds } from "@/lib/inventory/stock-adjust-form";
import {
  MENU_EDITOR_CELL_LEFT_CLASS,
  MENU_EDITOR_HINT_CLASS,
  MENU_EDITOR_INPUT_CLASS,
  MENU_EDITOR_NUMBER_CLASS,
  MENU_EDITOR_PRICE_BOX_CLASS,
} from "@/lib/menu-editor-layout";
import { cafeDateString, inrPaise } from "@/lib/utils";
import { DatePicker } from "@/components/shared/DatePicker";
import { Input } from "@/components/ui/input";
import { EditorField } from "@/components/products/EditorField";
import { ItemEditorFooter, ItemEditorFrame } from "@/components/products/ItemEditorFrame";
import type { SupplierDto } from "@/types/inventory";

// The date button wears the select's look (38px, 13.5px), as in the purchase sheet.
const DATE_TRIGGER_CLASS = "h-[38px] rounded-[9px] border-border bg-card px-3 text-[13.5px] font-medium text-foreground";

interface SupplierPaySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: SupplierDto;
}

function dueSentence(duePaise: number): string {
  if (duePaise > 0) return `You owe ${inrPaise(duePaise)}.`;
  if (duePaise < 0) return `Paid ${inrPaise(-duePaise)} ahead.`;
  return "Nothing owed right now.";
}

// Pay a supplier: how much, and when. It lowers what is owed to them (paying more than is owed shows as paid ahead); no stock
// moves and no Expense is added. The parent remounts it (a new key) on every open, so the form and its clientRef start fresh;
// a failed Save keeps the clientRef (a useState initializer, minted once), so the retry is a server replay.
export function SupplierPaySheet({ open, onOpenChange, supplier }: SupplierPaySheetProps) {
  const create = useCreateStockEntry();
  const [today] = useState(() => cafeDateString());
  const [clientRef] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<PaymentValues>(() => initialPaymentValues(today, supplier.duePaise));
  const [errors, setErrors] = useState<PaymentErrors>({});
  const bounds = stockEntryDateBounds(today);
  const set = (patch: Partial<PaymentValues>) => setValues((v) => ({ ...v, ...patch }));
  const after = paymentAfterText(supplier.duePaise, paymentAmountPaise(values));

  const submit = async () => {
    const found = validatePaymentForm(values, today);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await create.mutateAsync(buildPaymentInput(values, supplier.id, clientRef));
      onOpenChange(false);
    } catch {
      // The hook already toasted; the sheet stays open and a retry reuses the same clientRef.
    }
  };

  return (
    <ItemEditorFrame
      open={open}
      onOpenChange={onOpenChange}
      title={`Pay ${supplier.name}`}
      sub={dueSentence(supplier.duePaise)}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      focusPanel={false}
      footer={<ItemEditorFooter onCancel={() => onOpenChange(false)} saving={create.isPending} submitLabel="Save payment" />}
    >
      <EditorField label="Amount" error={errors.amount}>
        <div className={MENU_EDITOR_PRICE_BOX_CLASS}>
          <label htmlFor="payment-amount" className={MENU_EDITOR_CELL_LEFT_CLASS}>
            ₹
          </label>
          <input
            id="payment-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder="0"
            aria-label="Amount paid"
            value={values.amountText}
            aria-invalid={!!errors.amount}
            className={MENU_EDITOR_NUMBER_CLASS}
            onChange={(e) => set({ amountText: e.target.value })}
          />
        </div>
        {after && <p className={MENU_EDITOR_HINT_CLASS}>{after}</p>}
      </EditorField>

      <EditorField label="Date" htmlFor="payment-date" error={errors.date}>
        {/* The app's own calendar, never the browser's native date popup (owner rule). */}
        <DatePicker id="payment-date" min={bounds.min} max={bounds.max} value={values.date} onChange={(date) => set({ date })} invalid={!!errors.date} className={DATE_TRIGGER_CLASS} />
      </EditorField>

      <EditorField label="Note (optional)" htmlFor="payment-note" error={errors.note}>
        <Input
          id="payment-note"
          autoComplete="off"
          maxLength={STOCK_ENTRY_NOTE_MAX_LEN}
          value={values.note}
          aria-invalid={!!errors.note}
          className={MENU_EDITOR_INPUT_CLASS}
          onChange={(e) => set({ note: e.target.value })}
        />
        <p className={MENU_EDITOR_HINT_CLASS}>Payments are not added to Expenses.</p>
      </EditorField>
    </ItemEditorFrame>
  );
}
