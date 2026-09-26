"use client";

import { Check, Ticket, X } from "lucide-react";

import { Button } from "@/components/ui/button";
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
// carrying neither, and the only on-screen trace was a colour dot on the
// three-dot trigger — which the repo's own UI rule forbids as a sole channel
// ("never colour alone"). The operator could collect the undiscounted amount,
// or hand over a free item, with nothing saying so.
//
// These rows are DISPLAY plus the remove control. No arithmetic: the figures
// stay with usePosTotals and, authoritatively, the server.

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

  return (
    <div className="space-y-1.5">
      {promoCode && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <Ticket className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 truncate">Promo {promoCode} applied</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={onRemovePromo}
            disabled={disabled}
            aria-label={`Remove promo code ${promoCode}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {selectedReward && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 truncate">
              Reward: {rungWorthLabel(selectedReward.rung)}
            </span>
          </span>
          {/* A granted reward on a resumed tab cannot be taken back here (one
              reward per order, and the add-round route 409s a second claim),
              so it renders as a statement rather than a control that would
              silently do nothing. */}
          {!rewardLocked && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={onClearReward}
              disabled={disabled}
              aria-label="Remove reward"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
