"use client";

import { dueLabel } from "@/lib/inventory/supplier-form";
import { MENU_EDITOR_CANCEL_CLASS, MENU_EDITOR_SAVE_CLASS } from "@/lib/menu-editor-layout";
import { ItemEditorFrame } from "@/components/products/ItemEditorFrame";
import { EntryList } from "@/components/inventory/EntryList";
import type { SupplierDto } from "@/types/inventory";

interface SupplierHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: SupplierDto;
  /** Close this and open the pay sheet. */
  onPay: () => void;
  /** Close this and open the supplier editor. */
  onEdit: () => void;
}

// One supplier's history: what they are owed, their purchases and the payments made to them, with Pay and Edit details at
// the foot. It edits nothing itself (no form), so the footer's two buttons are plain type="button"s.
export function SupplierHistorySheet({ open, onOpenChange, supplier, onPay, onEdit }: SupplierHistorySheetProps) {
  return (
    <ItemEditorFrame
      open={open}
      onOpenChange={onOpenChange}
      title={supplier.name}
      sub={dueLabel(supplier.duePaise).text}
      footer={
        <>
          <button type="button" className={MENU_EDITOR_CANCEL_CLASS} onClick={onEdit}>
            Edit details
          </button>
          <button type="button" className={MENU_EDITOR_SAVE_CLASS} onClick={onPay}>
            Pay
          </button>
        </>
      }
    >
      <EntryList supplierId={supplier.id} />
    </ItemEditorFrame>
  );
}
