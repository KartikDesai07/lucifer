"use client";

import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TOUCH_BUTTON_CLASS = "pointer-coarse:h-11";

interface ExpenseDeleteConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: () => void;
}

// The "are you sure" for deleting an expense. Same shape as the shared
// ConfirmDialog, with 44px buttons on touch (the shared one has no size prop).
export function ExpenseDeleteConfirm({ open, onOpenChange, isPending, onConfirm }: ExpenseDeleteConfirmProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
          <AlertDialogDescription>It stops counting in totals and reports.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} className={TOUCH_BUTTON_CLASS}>
            Cancel
          </AlertDialogCancel>
          {/* Stays open while the delete runs; the sheet closes it on success. */}
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isPending}
            className={`bg-destructive text-destructive-foreground hover:bg-destructive/90 ${TOUCH_BUTTON_CLASS}`}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
