"use client";

import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { POS_BILL_LABEL_CLASS, POS_BILL_LINK_CLASS, POS_BILL_ROW_CLASS } from "@/lib/pos-layout";
import { rungWorthLabel, type RungOffer } from "@/lib/reward-rungs";

// D9.8d (2026-09-26) — the APPLIED promo code and the SELECTED reward, as
// always-visible footer rows.
//
// Why this file exists: D9.8 moved CartPromo and CartReward into the More
// menu, which also took their "applied" states with them. That was a real
// visibility regression, and a worse one than it looks, because neither of
// these adjustments shows up anywhere else on screen:
//
//   - a PROMO is resolved server-side; usePosTotals has no promo arm at all
//     (verified: zero occurrences), so Subtotal and Total are identical with
//     and without one. The cart's "Discount applied" row never fires for it.
//   - an ITEM reward derives a 0 discount by design (its benefit is a free
//     LINE the server appends), so it too leaves Subtotal/Total untouched.
//
// So before this file, a bill carrying either one looked exactly like a bill
// carrying neither, and the only on-screen trace was a colour dot on the cart's
// old three-dot trigger (removed in U1: the footer's links and the Bill options
// panel replaced it) — which the repo's own UI rule forbids as a sole channel
// ("never colour alone"). The operator could collect the undiscounted amount,
// or hand over a free item, with nothing saying so.
//
// These rows are DISPLAY plus the remove control. No arithmetic: the figures
// stay with usePosTotals and, authoritatively, the server.
//
// U1 Task 5 (design 6.8; values 5.5): rows of the HTML's bill block (CartBill) in its charge-row look: the words, then
// a 12px --link "Remove" 8px after them (the remove controls keep their aria-labels). They render as the bill's own
// rows (a fragment), 5px apart like the rest.

interface CartAppliedRowsProps {
  promoCode: string | null;
  onRemovePromo: () => void;
  /** The chosen rung, when one is selected. Undefined when none is. */
  selectedReward: RungOffer | undefined;
  /** A resumed tab's reward is already granted — shown, but not removable. */
  rewardLocked: boolean;
  onClearReward: () => void;
  disabled?: boolean;
}

export function CartAppliedRows({
  promoCode,
  onRemovePromo,
  selectedReward,
  rewardLocked,
  onClearReward,
  disabled,
}: CartAppliedRowsProps) {
  if (!promoCode && !selectedReward) return null;
  const link = cn(POS_BILL_LINK_CLASS, BRAND_PRESS_CLASS);

  return (
    <>
      {promoCode && (
        <div data-ui="pos-bill-promo" className={POS_BILL_ROW_CLASS}>
          <span className={POS_BILL_LABEL_CLASS}>
            <span className="min-w-0 truncate">Promo {promoCode} applied</span>
            <button type="button" className={link} onClick={onRemovePromo} disabled={disabled} aria-label={`Remove promo code ${promoCode}`}>
              Remove
            </button>
          </span>
        </div>
      )}

      {selectedReward && (
        <div data-ui="pos-bill-reward" className={POS_BILL_ROW_CLASS}>
          <span className={POS_BILL_LABEL_CLASS}>
            <span className="min-w-0 truncate">Reward: {rungWorthLabel(selectedReward.rung)}</span>
            {/* A granted reward on a resumed tab cannot be taken back here (one
                reward per order, and the add-round route 409s a second claim),
                so it renders as a statement rather than a control that would
                silently do nothing. */}
            {!rewardLocked && (
              <button type="button" className={link} onClick={onClearReward} disabled={disabled} aria-label="Remove reward">
                Remove
              </button>
            )}
          </span>
        </div>
      )}
    </>
  );
}
