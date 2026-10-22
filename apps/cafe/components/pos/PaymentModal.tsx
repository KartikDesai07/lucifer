"use client";

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";

import { SETTLEMENT_PAY_MODES, type PaymentMode, type DiscountKind } from "@/lib/constants";
import { inr, cn } from "@/lib/utils";
import {
  PAY_CHECK_CLASS,
  PAY_CLOSE_CLASS,
  PAY_DISCARD_LOOK,
  PAY_HEAD_CLASS,
  PAY_MAIN_LOOK,
  PAY_PANEL_CLASS,
  PAY_SCRIM_CLASS,
  PAY_SERVED_BY_CLASS,
  PAY_TITLE_CLASS,
  dueNoteText,
  paymentDescription,
  paymentPlace,
  paymentTitle,
} from "@/lib/payment-sheet";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { useOpenerFocus } from "@/hooks/use-opener-focus";
import { CustomerSearch } from "@/components/pos/CustomerSearch";
import { PaymentAmount } from "@/components/pos/PaymentAmount";
import { PaymentSummary } from "@/components/pos/PaymentSummary";
import { PaymentModeGrid } from "@/components/pos/PaymentModeGrid";
import { PaymentPoints } from "@/components/pos/PaymentPoints";
import { PaymentCollectFields } from "@/components/pos/PaymentCollectFields";
import { PaymentSplitFields } from "@/components/pos/PaymentSplitFields";
import { WriteNoticePanel, noticeBoxClass } from "@/components/pos/WriteNotice";
import { SendDiscard } from "@/components/pos/SendDiscard";
import type { OrderCharge } from "@pos/shared/order-charges";
import type { SettlePointsView } from "@/hooks/use-settle-points";
import type { Customer } from "@/types";
import {
  openedTotalAfterToggle,
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

// U1 Task 9 (values 11 in docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.11; owner Q1, Q4, Q14): the
// owner's HTML payment sheet, on /pos and on the Orders / dashboard sheet alike, with the same behaviour: a Radix dialog
// (every close through the guard below) drawn as the HTML's scrim and panel; its look is in lib/payment-sheet.ts.

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
  // /pos's new sale (nothing resumed): the title says "New order" until a table is chosen, as the cart does.
  newSale?: boolean;
  // Renders the customer picker (the pill) when provided; omit to keep the
  // sheet's plain read-only display of whatever customer was passed in.
  onSelectCustomer?: (customer: Customer | undefined) => void;
  // The last write's outcome for this bill (lib/pending-writes.ts). Its action
  // decides the main button: confirm, Check, Send again or Close.
  notice?: WriteNotice | null;
  // CB-7 S6 — the "Use points" row (hooks/use-settle-points.ts); omit for a surface that cannot spend points.
  points?: SettlePointsView;
}

// Due/Credit are unpaid-at-counter sales — they require a customer so the
// outstanding balance is tracked against someone.
const UNPAID_MODES: PaymentMode[] = ["Due", "Credit"];
// Cash/Online accept a partial collection (shortfall becomes a due, like
// Due/Credit); Split must always reconcile to the exact total instead.
const COLLECTABLE_MODES: PaymentMode[] = ["Cash", "Online"];

const CLOSE_CLASS = cn(PAY_CLOSE_CLASS, BRAND_PRESS_CLASS);
const MAIN_CLASS = cn(PAY_MAIN_LOOK, BRAND_PRESS_CLASS);
const DISCARD_CLASS = cn(PAY_DISCARD_LOOK, BRAND_PRESS_CLASS);

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
  newSale = false,
  onSelectCustomer,
  notice = null,
  points,
}: PaymentModalProps) {
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [collected, setCollected] = useState(total);
  const [split, setSplit] = useState<SplitAmounts>({ cash: 0, online: 0 });
  const [openedTotal, setOpenedTotal] = useState(total);
  // open:false first, so a popup that mounts already open still resets.
  const seenRef = useRef<PopupSnapshot>({ open: false, total });
  const openerFocus = useOpenerFocus();

  // The points the operator has ticked (0 = off): their own toggle moves the total, which is not "the bill changed".
  const pointsNow = points?.on ? points.row.amount : 0;
  const pointsOn = pointsNow > 0;
  // Reset the mode + split only as the popup OPENS. A bill that changes while
  // it is open keeps the operator's mode and re-derives the split (F8).
  useEffect(() => {
    const prevTotal = seenRef.current.total;
    const change = paymentPopupChange(seenRef.current, { open, total, pointsOn });
    seenRef.current = { open, total, pointsOn };
    if (change === "opened") {
      setMode("Cash");
      setSplit({ cash: total, online: 0 });
      setOpenedTotal(total);
    } else if (change === "bill-changed") {
      setSplit((s) => splitAfterBillChange(s, total));
    } else if (change === "rebaselined") {
      setOpenedTotal((opened) => openedTotalAfterToggle(opened, prevTotal, total));
      setSplit((s) => splitAfterBillChange(s, total));
    }
  }, [open, total, pointsOn]);
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
      ...(pointsNow > 0 ? { rewardPoints: pointsNow } : {}),
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
    <DialogPrimitive.Root open={open} onOpenChange={openChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="pay-sheet" className={PAY_SCRIM_CLASS}>
          <DialogPrimitive.Content data-ui="pay-panel" {...openerFocus} className={PAY_PANEL_CLASS}>
            <div data-ui="pay-head" className={PAY_HEAD_CLASS}>
              <DialogPrimitive.Title className={PAY_TITLE_CLASS}>{paymentTitle(tableNo, newSale)}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                {paymentDescription({ itemCount, tableNo, customerName: customer?.name })}
              </DialogPrimitive.Description>
              <DialogPrimitive.Close data-ui="pay-close" title="Close" aria-label="Close" className={CLOSE_CLASS}>✕</DialogPrimitive.Close>
            </div>

            {/* CustomerSearch brings its own Dialog; nesting it here is deliberate. */}
            <PaymentAmount
              total={total}
              customerName={customer?.name}
              picker={onSelectCustomer && <CustomerSearch value={customer} onChange={onSelectCustomer} disabled={locked} context={paymentPlace(tableNo, newSale)} />}
            />

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

            {points?.show && <PaymentPoints points={points} disabled={locked} />}

            <PaymentModeGrid modes={modes} mode={mode} onSelect={setMode} locked={locked} />

            {/* Cash and Online both accept a partial collection here. */}
            {collectable && (
              <PaymentCollectFields
                showChange={mode === "Cash"}
                collected={collected}
                onCollectedChange={setCollected}
                change={change}
                remainder={partial ? remainder : 0}
                customerName={customer?.name}
                disabled={locked}
              />
            )}

            {mode === "Split" && (
              <PaymentSplitFields split={split} onSplitChange={setSplit} total={total} mismatch={splitMismatch} disabled={locked} />
            )}

            {(mode === "Due" || mode === "Credit") && (
              <p data-ui="pay-due-note" className={noticeBoxClass(customer ? "neutral" : "warn")}>{dueNoteText(mode, total)}</p>
            )}

            {customerMissing && (
              <p data-ui="pay-check" className={PAY_CHECK_CLASS}>
                {UNPAID_MODES.includes(mode) ? `Select a customer for ${mode} orders.` : `${inr(remainder)} will be unpaid — select a customer to record the due.`}
              </p>
            )}

            <WriteNoticePanel notice={notice} />

            <p data-ui="pay-served-by" className={PAY_SERVED_BY_CLASS}>Served by {receiver}</p>
            <button
              type="button"
              data-ui="pay-confirm"
              className={MAIN_CLASS}
              disabled={blocked}
              onClick={action === "close" ? () => onOpenChange(false) : confirm}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
            </button>
            {frozen && <SendDiscard kind="pay" disabled={isSubmitting} onDiscard={() => onOpenChange(false)} className={DISCARD_CLASS} />}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
