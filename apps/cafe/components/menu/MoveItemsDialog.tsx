"use client";

import { useEffect, useState } from "react";

import { MenuDialog } from "@/components/menu/MenuDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MENU_SELECT_TRIGGER_CLASS } from "@/lib/menu-layout";
import { MENU_DIALOG_FOOT_CLASS, MENU_EDITOR_CANCEL_CLASS, MENU_EDITOR_SAVE_CLASS, MENU_EDITOR_SELECT_CLASS } from "@/lib/menu-editor-layout";
import { cn } from "@/lib/utils";
import type { Category } from "@/types";

interface MoveItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  isPending: boolean;
  onConfirm: (categoryId: string) => void;
}

// R10 clause of the bulk bar's Move action — a category Select plus the
// reports note the owner asked for (clause 3e-10): moving an item also moves
// its PAST sales in Items & categories reports (Q2, today's behaviour).
// U5 Task 3: in the HTML's dialog box (440px, the phone's bottom sheet), its words and logic today's.
export function MoveItemsDialog({ open, onOpenChange, categories, isPending, onConfirm }: MoveItemsDialogProps) {
  const [categoryId, setCategoryId] = useState("");

  // G12 — reset on OPEN, not just on close: the dialog can stay mounted while
  // its `open` prop flips closed/open again for a second bulk selection, and
  // clearing only on close missed that path, so the previous category
  // silently carried over into the next Move.
  useEffect(() => {
    if (open) setCategoryId("");
  }, [open]);

  return (
    <MenuDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Move to category"
      sub="Past sales of these items will show under the new category in Reports."
    >
      <Select value={categoryId} onValueChange={setCategoryId}>
        <SelectTrigger aria-label="Category" className={cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS)}>
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

      <div className={MENU_DIALOG_FOOT_CLASS}>
        <button type="button" className={MENU_EDITOR_CANCEL_CLASS} onClick={() => onOpenChange(false)} disabled={isPending}>
          Cancel
        </button>
        <button type="button" className={MENU_EDITOR_SAVE_CLASS} disabled={!categoryId || isPending} onClick={() => onConfirm(categoryId)}>
          Move
        </button>
      </div>
    </MenuDialog>
  );
}
