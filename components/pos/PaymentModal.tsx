"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";

import { SETTLEMENT_PAY_MODES, PAY_STYLES, type PaymentMode } from "@/lib/constants";
import { inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Customer } from "@/types";

// What the parent needs to assemble the order payload's payment fields.
export interface PaymentResult {
  payment: PaymentMode;
  paidAmount: number;
  splitCash?: number;
  splitOnline?: number;
}

interface PaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtotal: number;
  discount: number;
  gstAmount?: number; // > 0 only when exclusive GST is enabled
  gstRate?: number;
  total: number;
  itemCount: number;
  customer: Customer | undefined;
  tableNo: string | undefined;
  receiver: string;
  isSubmitting: boolean;
  onConfirm: (result: PaymentResult) => void;
  // Modes offered in the grid. Defaults to the real settlement modes (never the
  // held "Unpaid" state — you can't settle a bill *into* unpaid).
  modes?: PaymentMode[];
  // CTA verb: "Place Order" (default) for a new sale, "Settle" when closing a tab.
  confirmLabel?: string;
}

// Due/Credit are unpaid-at-counter sales — they require a customer so the
// outstanding balance is tracked against someone.
const UNPAID_MODES: PaymentMode[] = ["Due", "Credit"];

export function PaymentModal({
  open,
  onOpenChange,
  subtotal,
  discount,
  gstAmount = 0,
  gstRate,
  total,
  itemCount,
  customer,
  tableNo,
  receiver,
  isSubmitting,
  onConfirm,
  modes = [...SETTLEMENT_PAY_MODES],
  confirmLabel = "Place Order",
}: PaymentModalProps) {
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [cashReceived, setCashReceived] = useState(total);
  const [splitCash, setSplitCash] = useState(0);
  const [splitOnline, setSplitOnline] = useState(0);

  // Reset inputs whenever the modal opens (or the total changes while open).
  useEffect(() => {
    if (open) {
      setMode("Cash");
      setCashReceived(total);
      setSplitCash(total);
      setSplitOnline(0);
    }
  }, [open, total]);

  const needsCustomer = UNPAID_MODES.includes(mode);
  const customerMissing = needsCustomer && !customer;
  const cashShort = mode === "Cash" && cashReceived < total;
  const splitSum = splitCash + splitOnline;
  const splitMismatch = mode === "Split" && splitSum !== total;
  const blocked =
    itemCount === 0 ||
    isSubmitting ||
    customerMissing ||
    cashShort ||
    splitMismatch;

  const change = mode === "Cash" ? Math.max(0, cashReceived - total) : 0;

  const confirm = () => {
    const paidAmount = UNPAID_MODES.includes(mode) ? 0 : total;
    onConfirm({
      payment: mode,
      paidAmount,
      ...(mode === "Split" ? { splitCash, splitOnline } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>
            {itemCount} item{itemCount === 1 ? "" : "s"}
            {tableNo ? ` · Table ${tableNo}` : " · Walk-In"} ·{" "}
            {customer ? customer.name : "No customer"}
          </DialogDescription>
        </DialogHeader>

        {/* Summary */}
        <div className="space-y-1 rounded-lg border p-3 text-sm">
          <Row label="Subtotal" value={inr(subtotal)} />
          {discount > 0 && (
            <Row label="Discount" value={`−${inr(discount)}`} muted />
          )}
          {gstAmount > 0 && (
            <Row
              label={gstRate ? `GST @${gstRate}%` : "GST"}
              value={`+${inr(gstAmount)}`}
            />
          )}
          <div className="flex items-center justify-between border-t pt-1 text-base font-bold">
            <span>Total</span>
            <span>{inr(total)}</span>
          </div>
        </div>

        {/* Payment mode buttons */}
        <div className="grid grid-cols-3 gap-2">
          {modes.map((m) => {
            const style = PAY_STYLES[m];
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
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

        {/* Mode-specific fields */}
        {mode === "Cash" && (
          <div className="space-y-2">
            <Label htmlFor="cash-received">Amount received</Label>
            <Input
              id="cash-received"
              type="number"
              min={0}
              value={cashReceived === 0 ? "" : cashReceived}
              onChange={(e) =>
                setCashReceived(Math.max(0, Number(e.target.value) || 0))
              }
            />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Change</span>
              <span className="font-semibold">{inr(change)}</span>
            </div>
          </div>
        )}

        {mode === "Split" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="split-cash">Cash</Label>
              <Input
                id="split-cash"
                type="number"
                min={0}
                value={splitCash === 0 ? "" : splitCash}
                onChange={(e) =>
                  setSplitCash(Math.max(0, Number(e.target.value) || 0))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="split-online">Online</Label>
              <Input
                id="split-online"
                type="number"
                min={0}
                value={splitOnline === 0 ? "" : splitOnline}
                onChange={(e) =>
                  setSplitOnline(Math.max(0, Number(e.target.value) || 0))
                }
              />
            </div>
            <p
              className={cn(
                "col-span-2 text-xs",
                splitMismatch ? "text-destructive" : "text-muted-foreground",
              )}
            >
              Cash + Online = {inr(splitSum)} (must equal {inr(total)})
            </p>
          </div>
        )}

        {(mode === "Due" || mode === "Credit") && (
          <p className="text-sm text-muted-foreground">
            {mode === "Due" ? "Payment marked as due" : "Charged to credit"} —
            the full {inr(total)} is added to the customer&apos;s outstanding
            balance.
          </p>
        )}

        {customerMissing && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Select a customer for {mode} orders.
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <p className="text-center text-xs text-muted-foreground">
            Served by {receiver}
          </p>
          <Button
            size="lg"
            className="w-full"
            disabled={blocked}
            onClick={confirm}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `${confirmLabel} · ${inr(total)}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        muted && "text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
