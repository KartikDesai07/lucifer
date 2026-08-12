"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { ORDER_REASON_MIN_LEN, ORDER_REASON_MAX_LEN } from "@/lib/constants";
import { inr } from "@/lib/utils";
import { isLastLine } from "@/lib/order-void";
import { orderLineKey } from "@pos/shared/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Order, VoidItemInput } from "@/types";

interface VoidItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  isPending?: boolean;
  onConfirm: (payload: VoidItemInput) => void;
}

// Void or qty-reduce one already-fired line on the resumed tab (CR1.3-B). The
// index sent to the server is the line's REAL position in order.items, never a
// cart index — embedded item rows carry no _id, so position + the line's whole
// identity (lineKey, from orderLineKey — the single definition of "the same
// line") is the address, and the server 409s if the operator's view is stale
// (another device fired a round, voided a line, or shifted the trail first).
export function VoidItemDialog({
  open,
  onOpenChange,
  order,
  isPending,
  onConfirm,
}: VoidItemDialogProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");

  const firedLines = (order?.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.kotRound ?? 0) >= 1);

  // Reset the form each time the dialog opens for a (possibly different) order.
  useEffect(() => {
    if (open) {
      setSelected(null);
      setQty(1);
      setReason("");
    }
  }, [open, order?._id]);

  const line = selected === null ? null : order?.items[selected];
  const trimmedReason = reason.trim();
  // Voiding this selection would leave the tab with zero items — that's a
  // cancellation, which is admin-only and rejected server-side with no way for
  // a cashier to act on the message. Caught up front instead of surfaced as a
  // 400 the operator can't do anything about (CR1.3 review).
  const wouldEmptyTab =
    !!order && selected !== null && isLastLine(order.items, selected, qty);
  const canConfirm =
    !!line &&
    trimmedReason.length >= ORDER_REASON_MIN_LEN &&
    !wouldEmptyTab &&
    !isPending;

  const selectLine = (index: number) => {
    setSelected(index);
    // Default to voiding the whole line — the common case.
    setQty(order?.items[index]?.qty ?? 1);
  };

  const confirm = () => {
    if (!line || selected === null || !order) return;
    onConfirm({
      index: selected,
      lineKey: orderLineKey(line),
      qty,
      expectedVoids: order.voids?.length ?? 0,
      reason: trimmedReason,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void an item</DialogTitle>
          <DialogDescription>
            The kitchen gets a VOID slip for this line. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {firedLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing sent to the kitchen yet on this tab.
            </p>
          ) : (
            <RadioGroup
              value={selected === null ? undefined : String(selected)}
              onValueChange={(v) => selectLine(Number(v))}
              className="max-h-56 overflow-y-auto"
            >
              {firedLines.map(({ item, index }) => (
                <label
                  key={index}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <RadioGroupItem value={String(index)} />
                    {item.name} × {item.qty}
                  </span>
                  <span className="text-muted-foreground">{inr(item.price * item.qty)}</span>
                </label>
              ))}
            </RadioGroup>
          )}

          {line && (
            <div className="flex items-center justify-between">
              <Label>Quantity to void</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-8 text-center text-sm font-semibold">{qty}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setQty((q) => Math.min(line.qty, q + 1))}
                  aria-label="Increase quantity"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {wouldEmptyTab && (
            <p className="text-sm font-medium text-destructive">
              This would empty the tab — a tab must keep at least one item. Ask
              an admin to cancel the order instead.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="void-reason">Reason (required)</Label>
            <Textarea
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. wrong item fired, guest changed mind"
              maxLength={ORDER_REASON_MAX_LEN}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            onClick={confirm}
            className="w-full sm:w-auto"
          >
            Void {qty > 1 ? `${qty} × ` : ""}item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
