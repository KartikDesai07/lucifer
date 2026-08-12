"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  DUES_RECEIPT_MODES,
  PAY_STYLES,
  ORDER_REASON_MAX_LEN,
  type DuesReceiptMode,
} from "@/lib/constants";
import { inr, cn } from "@/lib/utils";
import { useReceiveDuePayment } from "@/hooks/use-customers";
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
import type { DuePaymentInput } from "@/schemas";

// Structural subset shared by Customer and CustomerDue — either can be passed
// in without an extra mapping step at the call site.
interface DueCustomer {
  _id: string;
  name: string;
  totalDue: number;
}

interface ReceivePaymentDialogProps {
  customer: DueCustomer | null;
  onOpenChange: (open: boolean) => void;
}

// Record money actually taken against a customer's outstanding balance
// (CR1.4) — replaces the old admin-only all-or-nothing "Mark paid" wipe with
// an amount + a mode a human actually chose. Shaped on the existing
// small-dialog precedents (CancelOrderDialog, VoidItemDialog); PaymentModal is
// 299 lines already, so this is a separate component, not an extension of it.
export function ReceivePaymentDialog({
  customer,
  onOpenChange,
}: ReceivePaymentDialogProps) {
  const receivePayment = useReceiveDuePayment();
  const [amountText, setAmountText] = useState("");
  const [mode, setMode] = useState<DuesReceiptMode>("Cash");
  const [note, setNote] = useState("");
  // Minted once per dialog-open (not on every render) so a double-tapped
  // confirm button reuses the same key and the server dedupes it instead of
  // collecting twice.
  const clientRefRef = useRef("");

  useEffect(() => {
    if (customer) {
      setAmountText(String(customer.totalDue));
      setMode("Cash");
      setNote("");
      clientRefRef.current = crypto.randomUUID();
    }
    // Deliberately keyed on the id alone, not the whole `customer` object —
    // re-running this on every balance refresh (e.g. a background poll while
    // the dialog is open) would wipe an in-progress edit and mint a fresh
    // clientRef mid-entry. It should fire only on an actual dialog-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?._id]);

  if (!customer) return null;

  const isPending = receivePayment.isPending;
  const amountValue = Math.trunc(Number(amountText));
  const validAmount =
    Number.isInteger(Number(amountText)) &&
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    amountValue <= customer.totalDue;
  const canConfirm = validAmount && !isPending;

  const confirm = () => {
    if (!validAmount) return;
    // CR1.2's "omitted means pay-in-full" rule protects a figure the SERVER
    // CAN RE-DERIVE ITSELF (an order total, recomputed from stored items). A
    // drawer count is the one number the server has no source for, so the
    // operator must always assert it — `customer.totalDue` here is a frozen
    // snapshot (captured at row-click / dialog-open, never refreshed while
    // open) and can go stale behind a second terminal's payment; omitting
    // `amount` whenever it happens to equal that snapshot would let the
    // server silently resolve to ITS OWN fresher balance instead of the cash
    // actually counted. The server's `requested > balance -> 400` check
    // (lib/due-payment.ts) is the loud stale-balance detector.
    const payload: DuePaymentInput = {
      amount: amountValue,
      mode,
      clientRef: clientRefRef.current,
    };
    const trimmedNote = note.trim();
    if (trimmedNote) payload.note = trimmedNote;

    receivePayment.mutate(
      { id: customer._id, data: payload },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receive payment — {customer.name}</DialogTitle>
          <DialogDescription>
            Outstanding balance {inr(customer.totalDue)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="due-amount">Amount received</Label>
          <Input
            id="due-amount"
            type="number"
            min={1}
            max={customer.totalDue}
            step={1}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            disabled={isPending}
          />
          {!validAmount && (
            <p className="text-xs text-destructive">
              Enter a whole rupee amount between 1 and {inr(customer.totalDue)}.
            </p>
          )}
        </div>

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
          <Label htmlFor="due-note">Note (optional)</Label>
          <Textarea
            id="due-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. paid at counter"
            maxLength={ORDER_REASON_MAX_LEN}
            rows={2}
            disabled={isPending}
          />
        </div>

        <DialogFooter>
          <Button
            className="w-full sm:w-auto"
            disabled={!canConfirm}
            onClick={confirm}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Receive {validAmount ? inr(amountValue) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
