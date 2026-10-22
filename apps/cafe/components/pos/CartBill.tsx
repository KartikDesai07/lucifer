"use client";

import { useId, useState } from "react";

import { inr, cn } from "@/lib/utils";
import { useWindowHeight } from "@/hooks/use-window-height";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { CartAppliedRows } from "@/components/pos/CartAppliedRows";
import { CartAppliedCard } from "@/components/pos/CartRewardCards";
import { CartExtraChargeRows, type ExtraChargeEntry } from "@/components/pos/CartExtraCharges";
import { POS_BILL_LABEL_CLASS, POS_BILL_LINK_CLASS, POS_BILL_ROW_CLASS, POS_BILL_VALUE_CLASS } from "@/lib/pos-layout";
import { NO_NUMBER_SPINNER_CLASS } from "@/lib/payment-sheet";
import { billDetailsOpen, billToggleHolds, type BillToggle } from "@/lib/pos-cart-view";
import type { RungOffer } from "@/lib/reward-rungs";
import type { CardOffer } from "@/lib/reward-card-offers";

// U1 Task 5 (owner Q12; design 6.8; values 5.5 and 0.4 in docs/superpowers/specs/2026-10-20-pos-html-values.md): the
// cart's bill in the HTML's block — the rows behind "Total · Details / Hide details", then the total. The rows are
// today's (our words, our figures): the subtotal, the discount, the applied promo / reward / scratch card, GST, the
// table's charge (its amount field, Remove = waive, and the "waived / changed from" row with Undo), the extra charges.
// Each row that can be taken off keeps its control here, outside the Bill options panel (D9.8, D9.8d); the rows sit
// behind "Details" on a window under 820px tall, and a waived or changed table charge opens them by itself until the
// user uses the toggle (ruling P16: lib/pos-cart-view.ts billDetailsOpen), on that order only (ruling P51). Every
// figure is usePosTotals' — this block only prints them (lib/receipt.test.ts).

/** "Total · Details" (values 5.5): the toggle — "Total" 15px 600 --text, 6px, then the 12px 500 --link word. */
const TOGGLE_CLASS = cn(
  "flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[15px] font-semibold text-foreground",
  BRAND_PRESS_CLASS,
);
/** A row's link (Remove, Undo) with the HTML's press. */
const LINK_CLASS = cn(POS_BILL_LINK_CLASS, BRAND_PRESS_CLASS);
/** The table charge's amount (our editable figure, no HTML counterpart; design 6.8): a small 13px field at the row's
 *  right (16px below 720px, ruling R36). */
const CHARGE_FIELD_CLASS =
  "h-[26px] w-[72px] rounded-[6px] border border-border bg-card px-1.5 text-right text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 max-tab:text-base";

export interface CartBillProps {
  /** The order on screen: the resumed tab's id, or "new" (ruling P51: the details choice holds for it only). */
  orderScope: string;
  /** Every line's quantity, sent and new (usePosTab's count). */
  count: number;
  subtotal: number;
  discount: number;
  gstActive: boolean;
  gstAmount: number;
  gstRate?: number;
  total: number;
  promoCode: string | null;
  onRemovePromo: () => void;
  selectedReward: RungOffer | undefined;
  rewardLocked: boolean;
  onClearReward: () => void;
  selectedCard: CardOffer | undefined;
  onClearCard: () => void;
  charge: number;
  chargeLabel: string;
  entitledCharge: number;
  onChargeChange: (value: number) => void;
  onChargeReset: () => void;
  extraCharges: ExtraChargeEntry[];
  onRemoveExtraCharge: (index: number) => void;
  isBusy?: boolean;
}

export function CartBill({
  orderScope,
  count,
  subtotal,
  discount,
  gstActive,
  gstAmount,
  gstRate,
  total,
  promoCode,
  onRemovePromo,
  selectedReward,
  rewardLocked,
  onClearReward,
  selectedCard,
  onClearCard,
  charge,
  chargeLabel,
  entitledCharge,
  onChargeChange,
  onChargeReset,
  extraCharges,
  onRemoveExtraCharge,
  isBusy,
}: CartBillProps) {
  const detailsId = useId();
  const windowHeight = useWindowHeight();
  // The table names a charge for this bill; it was waived or changed (the "waived / changed from" row says so).
  const chargeShown = chargeLabel !== "" && (entitledCharge > 0 || charge > 0);
  const chargeAdjusted = chargeShown && charge !== entitledCharge;
  // The operator's own choice wins once made (the HTML's toggleBill stores it), for the order on screen only: another
  // order on screen, or the cart just emptied (the count from some to none), puts it back to "not chosen" (ruling P51:
  // lib/pos-cart-view.ts billToggleHolds) — dropped here during render, as CartLines drops a stale selection, since the
  // column from 1280px stays mounted. Until then, the window's height, and open while the table charge is waived or
  // changed (ruling P16).
  const [toggle, setToggle] = useState<BillToggle | null>(null);
  const [hadItems, setHadItems] = useState(count > 0);
  if (hadItems !== count > 0) setHadItems(count > 0);
  if (toggle !== null && !billToggleHolds(toggle, { scope: orderScope, emptied: hadItems && count === 0 })) setToggle(null);
  const toggled = toggle?.open ?? null;
  const billOpen = billDetailsOpen({ toggled, windowHeight, chargeAdjusted });

  return (
    // values 5.5: the bill block, its rows 5px apart, 13px --text-2 (the amounts in --text).
    <div data-ui="pos-bill" className="flex flex-col gap-[5px] text-[13px] text-muted-foreground">
      {billOpen && (
        <div id={detailsId} data-ui="pos-bill-details" className="flex flex-col gap-[5px] motion-safe:animate-scrim-in">
          <div className={POS_BILL_ROW_CLASS}>
            <span>Subtotal · {count} {count === 1 ? "item" : "items"}</span>
            <span className={POS_BILL_VALUE_CLASS}>{inr(subtotal)}</span>
          </div>

          {discount > 0 && (
            <div className={POS_BILL_ROW_CLASS}>
              <span>{gstActive ? "GST Discount applied" : "Discount applied"}</span>
              {/* values 5.5: the HTML's discount figure in --ok-i. */}
              <span className="whitespace-nowrap text-status-ok-ink">−{inr(discount)}</span>
            </div>
          )}

          {/* D9.8d — the applied PROMO and the selected REWARD: neither moves Subtotal or Total on this screen (a
              promo is resolved server-side; an item reward derives a 0 discount), so without their rows a discounted
              bill would look exactly like an undiscounted one. */}
          <CartAppliedRows
            promoCode={promoCode}
            onRemovePromo={onRemovePromo}
            selectedReward={selectedReward}
            rewardLocked={rewardLocked}
            onClearReward={onClearReward}
            disabled={isBusy}
          />
          <CartAppliedCard offer={selectedCard} onClear={onClearCard} disabled={isBusy} />

          {gstAmount > 0 && (
            <div className={POS_BILL_ROW_CLASS}>
              <span>{gstRate ? `GST @${gstRate}%` : "GST"}</span>
              <span className={POS_BILL_VALUE_CLASS}>+{inr(gstAmount)}</span>
            </div>
          )}

          {/* The selected table's charge. Sits BELOW the GST line because that is where it lands in the arithmetic —
              it is added after tax, not taxed. Rendered only when the table actually names a charge. */}
          {chargeShown && (
            <>
              <div className={POS_BILL_ROW_CLASS}>
                <span className={POS_BILL_LABEL_CLASS}>
                  <span className="min-w-0 truncate" title={chargeLabel}>
                    {chargeLabel}
                  </span>
                  <button
                    type="button"
                    className={LINK_CLASS}
                    onClick={() => onChargeChange(0)}
                    disabled={charge === 0 || isBusy}
                    title={`Waive ${chargeLabel}`}
                    aria-label={`Waive ${chargeLabel}`}
                  >
                    Remove
                  </button>
                </span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={charge === 0 ? "" : charge}
                  onChange={(e) => onChargeChange(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="0"
                  disabled={isBusy}
                  className={cn(CHARGE_FIELD_CLASS, NO_NUMBER_SPINNER_CLASS)}
                  aria-label={`${chargeLabel} amount`}
                />
              </div>

              {/* Says out loud that this bill no longer matches the table's own setting, and offers the way back —
                  otherwise a waiver made on the previous customer silently rides onto the next one. The HTML's
                  "Service charge removed · Add back" row. */}
              {chargeAdjusted && (
                <div className={POS_BILL_ROW_CLASS}>
                  <span className="min-w-0 truncate">
                    {charge === 0 ? `${chargeLabel} waived` : `${chargeLabel} changed from ${inr(entitledCharge)}`}
                  </span>
                  <button type="button" onClick={onChargeReset} disabled={isBusy} className={LINK_CLASS}>
                    Undo
                  </button>
                </div>
              )}
            </>
          )}

          {/* CB-CHG — the staff-entered extra charges actually APPLIED: after the table charge and above Total, where
              they land in the arithmetic (after GST, outside the discount). Each keeps its own Remove. */}
          <CartExtraChargeRows extras={extraCharges} onRemove={onRemoveExtraCharge} disabled={isBusy} />
        </div>
      )}

      {/* values 5.5: the total row — 4px over a --border-2 rule, 10px under it, baseline-aligned. */}
      <div data-ui="pos-bill-total-row" className="mt-1 flex items-baseline justify-between border-t border-border-2 pt-2.5 text-foreground">
        <button
          type="button"
          data-ui="pos-bill-toggle"
          aria-expanded={billOpen}
          aria-controls={billOpen ? detailsId : undefined}
          onClick={() => setToggle({ open: !billOpen, scope: orderScope })}
          className={TOGGLE_CLASS}
        >
          <span>Total</span>
          <span className="text-[12px] font-medium text-link">{billOpen ? "Hide details" : "Details"}</span>
        </button>
        <span data-ui="pos-bill-total" className="whitespace-nowrap text-[26px] font-semibold tracking-[-0.02em]">
          {inr(total)}
        </span>
      </div>
    </div>
  );
}
