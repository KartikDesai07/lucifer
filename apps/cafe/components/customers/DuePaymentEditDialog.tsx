"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  DUES_RECEIPT_MODES,
  PAY_STYLES,
  ORDER_REASON_MAX_LEN,
  type DuesReceiptMode,
} from "@/lib/constants";
import { inr, cn } from "@/lib/utils";
import { useEditDuePayment, type DuePaymentRow } from "@/hooks/use-customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface DuePaymentEditDialogProps {
  customerId: string;
  payment: DuePaymentRow | null;
  onOpenChange: (open: boolean) => void;
}

// Admin correction of a past due payment. Mirrors ReceivePaymentDialog's
// amount + mode-tile layout so the two feel identical — this is the same
// decision, made after the fact instead of at the counter.
// The stored enum is deliberately WIDE (SettlementPayMode) — a pre-G7 row can
// hold "Due"/"Split"/"Credit". This form only has tiles for the two RECEIPT
// modes, so this is the one place that decides whether a stored value can be
// preselected at all.
function isDuesReceiptMode(mode: string): mode is DuesReceiptMode {
  return (DUES_RECEIPT_MODES as readonly string[]).includes(mode);
}

export function DuePaymentEditDialog({
  customerId,
  payment,
  onOpenChange,
}: DuePaymentEditDialogProps) {
  const editPayment = useEditDuePayment();
  const [amountText, setAmountText] = useState("");
  // `null` = no deliberate pick yet. A legacy row's stored mode outside
  // Cash|Online must NOT default to Cash — that silently rewrites the row's
  // mode on save and phantom-cash a past day's drawer tally. Leaving it
  // unset forces the admin to choose.
  const [mode, setMode] = useState<DuesReceiptMode | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (payment) {
      setAmountText(String(payment.amount));
      setMode(isDuesReceiptMode(payment.mode) ? payment.mode : null);
      setNote(payment.note ?? "");
    }
    // Keyed on the payment id alone — re-running on a background refetch
    // while the dialog is open would wipe an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?._id]);

  if (!payment) return null;

  const isPending = editPayment.isPending;
  const amountValue = Math.trunc(Number(amountText));
  const validAmount =
    Number.isInteger(Number(amountText)) &&
    Number.isFinite(amountValue) &&
    amountValue > 0;
  const canConfirm = validAmount && mode !== null && !isPending;

  const confirm = () => {
    if (!validAmount || !mode) return;
    const trimmedNote = note.trim();
    // The server distinguishes omitted (leave unchanged) from "" (clear) —
    // so a note that HAD content and was emptied must send "", not be
    // dropped, or the old note silently survives under a success toast.
    const hadNote = !!payment.note && payment.note.length > 0;
    const noteField =
      trimmedNote.length > 0 ? { note: trimmedNote } : hadNote ? { note: "" } : {};
    editPayment.mutate(
      {
        customerId,
        paymentId: payment._id,
        data: {
          amount: amountValue,
          mode,
          ...noteField,
        },
      },
      // Only close on success — a 400/409 from the server (stale balance,
      // already-deleted) must stay on screen so the operator can correct it.
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!payment} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit payment</DialogTitle>
          <DialogDescription>
            Originally recorded as {inr(payment.amount)} by {payment.receivedBy}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="edit-due-amount">Amount</Label>
          <Input
            id="edit-due-amount"
            type="number"
            min={1}
            step={1}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            disabled={isPending}
          />
          {!validAmount && (
            <p className="text-xs text-destructive">
              Enter a whole rupee amount greater than 0.
            </p>
          )}
        </div>

        {mode === null && (
          <p className="text-xs text-muted-foreground">
            Recorded as: {PAY_STYLES[payment.mode]?.label ?? payment.mode}.
            Pick Cash or Online to save a correction.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {DUES_RECEIPT_MODES.map((m) => {
            const style = PAY_STYLES[m];
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                disabled={isPending}
                className={cn(
                  "rounded-md border py-2 text-sm font-semibold transition",
                  active
                    ? `${style.bg} ${style.color} border-current ring-2 ring-current`
                    : "hover:bg-muted",
                )}
              >
                {style.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-due-note">Note (optional)</Label>
          <Textarea
            id="edit-due-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. corrected amount"
            maxLength={ORDER_REASON_MAX_LEN}
            rows={2}
            disabled={isPending}
          />
        </div>

        {editPayment.isPaused ? (
          // Offline: the mutation is parked, not failed — without this the
          // button spins forever with no explanation while the write waits
          // to leave.
          <p className="text-sm text-muted-foreground">
            Waiting for connection — this will save once you&apos;re back
            online.
          </p>
        ) : (
          editPayment.isError && (
            <p className="text-sm text-destructive">
              {editPayment.error?.message || "Could not update the payment."}
            </p>
          )
        )}

        <DialogFooter>
          <Button
            className="w-full sm:w-auto"
            disabled={!canConfirm}
            onClick={confirm}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
