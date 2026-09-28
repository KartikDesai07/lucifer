"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";

import { SETTLEMENT_PAY_MODES, PAY_STYLES, type PaymentMode, type DiscountKind } from "@/lib/constants";
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
import { PaymentSummary } from "@/components/pos/PaymentSummary";
import { PaymentSplitFields } from "@/components/pos/PaymentSplitFields";
import { WriteNoticePanel } from "@/components/pos/WriteNotice";
import { SendDiscard } from "@/components/pos/SendDiscard";
import type { OrderCharge } from "@pos/shared/order-charges";
import type { Customer } from "@/types";
import {
  paymentPopupChange,
  splitAfterBillChange,
  type PaymentResult,
  type PopupSnapshot,
  type SplitAmounts,
} from "@/lib/payment-result";
import type { WriteNotice } from "@/lib/pending-writes";

// Re-exported so existing importers of `@/components/pos/PaymentModal` keep
// working unchanged — the type itself now lives in the pure `lib/payment-result`
// module (shared with its callers without pulling in this client component).
export type { PaymentResult };

interface PaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtotal: number;
  discount: number;
  discountKind?: DiscountKind;
  gstAmount?: number; // > 0 only when exclusive GST is enabled
  gstRate?: number;
  // The table's charge folded into `total`, under the cafe's own name for it.
  // Without this row the summary would not add up at the exact moment money
  // changes hands — subtotal − discount + GST would fall short of the total.
  // Fallback only — see `charges` below, which itemises when present.
  charge?: number;
  chargeLabel?: string;
  // CB-CHG — every charge line (table + staff-entered extras), rendered one
  // row each. Empty (a legacy tab with neither, or none yet) falls back to
  // the single charge/chargeLabel pair above.
  charges?: OrderCharge[];
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
  // The last write's outcome for this bill (lib/pending-writes.ts). Its action
  // decides the main button: confirm, Check, Send again or Close.
  notice?: WriteNotice | null;
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
  discountKind,
  gstAmount = 0,
  gstRate,
  charge = 0,
  chargeLabel,
  charges = [],
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
  notice = null,
}: PaymentModalProps) {
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [collected, setCollected] = useState(total);
  const [split, setSplit] = useState<SplitAmounts>({ cash: 0, online: 0 });
  const [openedTotal, setOpenedTotal] = useState(total);
  // open:false first, so a popup that mounts already open still resets.
  const seenRef = useRef<PopupSnapshot>({ open: false, total });

  // Reset the mode + split only as the popup OPENS. A bill that changes while
  // it is open keeps the operator's mode and re-derives the split (F8).
  useEffect(() => {
    const change = paymentPopupChange(seenRef.current, { open, total });
    seenRef.current = { open, total };
    if (change === "opened") {
      setMode("Cash");
      setSplit({ cash: total, online: 0 });
      setOpenedTotal(total);
    } else if (change === "bill-changed") {
      setSplit((s) => splitAfterBillChange(s, total));
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
  const splitMismatch = mode === "Split" && split.cash + split.online !== total;
  // Check, Send again and Close act on the last attempt, not on these inputs.
  const action = notice?.action ?? "confirm";
  // An unconfirmed sale is frozen: Send again replays it exactly, so nothing may change (R-b).
  const frozen = notice?.action === "send-again";
  const locked = isSubmitting || frozen;
  const blocked = isSubmitting || (action === "confirm" && (itemCount === 0 || customerMissing || splitMismatch));

  const confirm = () => {
    onConfirm({
      payment: mode,
      paidAmount: paid,
      partial,
      ...(mode === "Split" ? { splitCash: split.cash, splitOnline: split.online } : {}),
    });
  };

  // X, Escape and an outside tap all land here: never while a request is in flight.
  const openChange = (next: boolean) => {
    if (!next && isSubmitting) return;
    if (!next && frozen) return;
    onOpenChange(next);
  };

  const label =
    action === "check" ? "Check" : action === "close" ? "Close" : action === "send-again" ? "Send again" : `${confirmLabel} · ${inr(total)}`;

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>
            {itemCount} item{itemCount === 1 ? "" : "s"}
            {tableNo ? ` · Table ${tableNo}` : " · Walk-In"} ·{" "}
            {customer ? customer.name : "No customer"}
          </DialogDescription>
        </DialogHeader>

        <PaymentSummary
          subtotal={subtotal}
          discount={discount}
          discountKind={discountKind}
          gstAmount={gstAmount}
          gstRate={gstRate}
          charge={charge}
          chargeLabel={chargeLabel}
          charges={charges}
          total={total}
          // One "bill changed" message at a time: a write notice says it first.
          billChangedFrom={notice == null && open && total !== openedTotal ? openedTotal : undefined}
        />

        {/* CustomerSearch brings its own Dialog; nesting it here is deliberate. */}
        {onSelectCustomer && (
          <div className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
            <span className="font-medium">Customer</span>
            <CustomerSearch value={customer} onChange={onSelectCustomer} disabled={locked} />
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
                disabled={locked}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md border py-2 text-sm font-semibold transition disabled:cursor-not-allowed",
                  // Locked (in flight / unconfirmed): the other modes dim, the chosen one stays clear.
                  active
                    ? `${style.bg} ${style.color} border-current ring-2 ring-current`
                    : "enabled:hover:bg-muted disabled:opacity-50",
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
              disabled={locked}
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
          <PaymentSplitFields split={split} onSplitChange={setSplit} total={total} mismatch={splitMismatch} disabled={locked} />
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

        <WriteNoticePanel notice={notice} />

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <p className="text-center text-xs text-muted-foreground">
            Served by {receiver}
          </p>
          <Button
            size="lg"
            className="w-full"
            disabled={blocked}
            onClick={action === "close" ? () => onOpenChange(false) : confirm}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
          </Button>
          {frozen && <SendDiscard kind="pay" disabled={isSubmitting} onDiscard={() => onOpenChange(false)} />}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
