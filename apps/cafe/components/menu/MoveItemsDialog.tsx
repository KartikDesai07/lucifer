"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to category</DialogTitle>
          <DialogDescription>
            Past sales of these items will show under the new category in Reports.
          </DialogDescription>
        </DialogHeader>

        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger>
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

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" disabled={!categoryId || isPending} onClick={() => onConfirm(categoryId)}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
