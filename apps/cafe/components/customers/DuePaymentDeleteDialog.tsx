"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ORDER_REASON_MAX_LEN, DUE_PAYMENT_DELETE_NOTE_MIN_LEN } from "@/lib/constants";
import { inr } from "@/lib/utils";
import { useDeleteDuePayment, type DuePaymentRow } from "@/hooks/use-customers";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ConfirmDialog (components/shared) only takes a plain description string —
// no slot for the required-reason textarea below — so this builds directly
// on the shadcn Dialog, the same way ReceivePaymentDialog does.

interface DuePaymentDeleteDialogProps {
  customerId: string;
  payment: DuePaymentRow | null;
  onOpenChange: (open: boolean) => void;
}

// Soft-deletes a past due payment. This puts money BACK on the customer's
// outstanding due, so a reason is mandatory, not just encouraged — the
// confirm button stays disabled until one is typed.
export function DuePaymentDeleteDialog({
  customerId,
  payment,
  onOpenChange,
}: DuePaymentDeleteDialogProps) {
  const deletePayment = useDeleteDuePayment();
  const [note, setNote] = useState("");

  useEffect(() => {
    if (payment) setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?._id]);

  if (!payment) return null;

  const isPending = deletePayment.isPending;
  const trimmedNote = note.trim();
  const validNote = trimmedNote.length >= DUE_PAYMENT_DELETE_NOTE_MIN_LEN;
  const canConfirm = validNote && !isPending;

  const confirm = () => {
    if (!validNote) return;
    deletePayment.mutate(
      { customerId, paymentId: payment._id, data: { note: trimmedNote } },
      // Stay open on a server error (e.g. already deleted) so the operator
      // sees the toast and can re-decide, instead of the dialog vanishing.
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!payment} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete payment</DialogTitle>
          <DialogDescription>
            This removes {inr(payment.amount)} ({payment.mode}) from the
            collected total and adds it back to the customer&apos;s
            outstanding due. The record stays visible, marked deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="delete-due-note">Reason (required)</Label>
          <Textarea
            id="delete-due-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this payment being deleted?"
            maxLength={ORDER_REASON_MAX_LEN}
            rows={2}
            disabled={isPending}
            autoFocus
          />
          {trimmedNote.length > 0 && !validNote && (
            <p className="text-xs text-destructive">
              At least {DUE_PAYMENT_DELETE_NOTE_MIN_LEN} characters.
            </p>
          )}
        </div>

        {deletePayment.isPaused ? (
          // Offline: the mutation is parked, not failed — without this the
          // button spins forever with no explanation while the write waits
          // to leave.
          <p className="text-sm text-muted-foreground">
            Waiting for connection — this will save once you&apos;re back
            online.
          </p>
        ) : (
          deletePayment.isError && (
            <p className="text-sm text-destructive">
              {deletePayment.error?.message || "Could not delete the payment."}
            </p>
          )
        )}

        <DialogFooter>
          <Button
            variant="destructive"
            className="w-full sm:w-auto"
            disabled={!canConfirm}
            onClick={confirm}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
