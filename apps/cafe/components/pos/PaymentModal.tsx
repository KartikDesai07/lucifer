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
import { CustomerSearch } from "@/components/pos/CustomerSearch";
import type { Customer } from "@/types";
import type { PaymentResult } from "@/lib/payment-result";

// Re-exported so existing importers of `@/components/pos/PaymentModal` keep
// working unchanged — the type itself now lives in the pure `lib/payment-result`
// module (shared with its callers without pulling in this client component).
export type { PaymentResult };

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
  // Renders an inline, editable customer picker when provided; omit to keep
  // the modal's plain read-only display of whatever customer was passed in.
  onSelectCustomer?: (customer: Customer | undefined) => void;
}

// Due/Credit are unpaid-at-counter sales — they require a customer so the
// outstanding balance is tracked against someone.
const UNPAID_MODES: PaymentMode[] = ["Due", "Credit"];
// Cash/Online accept a partial collection (shortfall becomes a due, like
// Due/Credit); Split must always reconcile to the exact total instead.
const COLLECTABLE_MODES: PaymentMode[] = ["Cash", "Online"];

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
  onSelectCustomer,
}: PaymentModalProps) {
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [collected, setCollected] = useState(total);
  const [splitCash, setSplitCash] = useState(0);
  const [splitOnline, setSplitOnline] = useState(0);

  // Reset the mode + split fields whenever the modal opens (or the total changes while open).
  useEffect(() => {
    if (open) {
      setMode("Cash");
      setSplitCash(total);
      setSplitOnline(0);
    }
  }, [open, total]);
  // Collected also resets on a mode switch, so a stale partial never carries over.
  useEffect(() => {
    if (open) setCollected(total);
  }, [open, total, mode]);

  const collectable = COLLECTABLE_MODES.includes(mode);
  // Cash/Online cap at the total (extra tendered is change, not overpayment);
  // Split always reconciles exactly; Due/Credit collect nothing up front.
  const paid = collectable ? Math.min(collected, total) : mode === "Split" ? total : 0;
  const remainder = Math.max(0, total - paid);
  // Falling short of the total needs a customer, same as Due/Credit.
  const partial = collectable && remainder > 0;
  const change = mode === "Cash" ? Math.max(0, collected - total) : 0;

  const needsCustomer = UNPAID_MODES.includes(mode) || partial;
  const customerMissing = needsCustomer && !customer;
  const splitSum = splitCash + splitOnline;
  const splitMismatch = mode === "Split" && splitSum !== total;
  const blocked = itemCount === 0 || isSubmitting || customerMissing || splitMismatch;

  const confirm = () => {
    onConfirm({
      payment: mode,
      paidAmount: paid,
      partial,
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

        {/* CustomerSearch brings its own Dialog; nesting it here is deliberate. */}
        {onSelectCustomer && (
          <div className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
            <span className="font-medium">Customer</span>
            <CustomerSearch value={customer} onChange={onSelectCustomer} />
          </div>
        )}

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

        {/* Cash and Online both accept a partial collection here. */}
        {collectable && (
          <div className="space-y-2">
            <Label htmlFor="amount-received">Amount received</Label>
            <Input
              id="amount-received"
              type="number"
              min={0}
              value={collected === 0 ? "" : collected}
              onChange={(e) => setCollected(Math.max(0, Number(e.target.value) || 0))}
            />
            {mode === "Cash" && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Change</span>
                <span className="font-semibold">{inr(change)}</span>
              </div>
            )}
            {partial && (
              <p className="rounded-md bg-amber-100 p-2 text-sm font-semibold text-amber-800">
                {inr(remainder)} unpaid — added to {customer ? customer.name : "the customer"}&apos;s dues.
              </p>
            )}
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
            {UNPAID_MODES.includes(mode) ? `Select a customer for ${mode} orders.` : `${inr(remainder)} will be unpaid — select a customer to record the due.`}
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
