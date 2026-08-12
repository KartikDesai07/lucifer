"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ORDER_REASON_MIN_LEN, ORDER_REASON_MAX_LEN } from "@/lib/constants";
import { inr } from "@/lib/utils";
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
import type { Order } from "@/types";

interface CancelOrderDialogProps {
  order: Order | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  isPending?: boolean;
}

// Admin-only break-glass replacement for the old destructive delete (CR1.3).
// The order stays on the ledger — reason/who/when get written alongside it —
// so a Textarea (not a ConfirmDialog yes/no) is required: the reason IS the
// audit trail. Mirrors ModifierModal's Dialog + Textarea shape.
export function CancelOrderDialog({
  order,
  onOpenChange,
  onConfirm,
  isPending = false,
}: CancelOrderDialogProps) {
  const [reason, setReason] = useState("");

  // Reset whenever a different order is targeted, so a stale reason typed for
  // one order can't be submitted against the next one opened in this dialog.
  useEffect(() => {
    setReason("");
  }, [order?._id]);

  if (!order) return null;

  const trimmed = reason.trim();
  const canConfirm = trimmed.length >= ORDER_REASON_MIN_LEN && !isPending;

  return (
    <Dialog open={!!order} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {order.orderId}?</DialogTitle>
          <DialogDescription>
            Total {inr(order.total)}. The order stays on record, but it leaves
            sales totals and the payment mix, and any customer due it created
            is reversed. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Reason (required)</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. duplicate order, guest walked out"
            maxLength={ORDER_REASON_MAX_LEN}
            rows={3}
            disabled={isPending}
          />
        </div>

        <DialogFooter>
          <Button
            variant="destructive"
            className="w-full sm:w-auto"
            disabled={!canConfirm}
            onClick={() => onConfirm(trimmed)}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
