"use client";

import { useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { POS_CART_MORE_BUTTON_CLASS, POS_CART_MORE_PANEL_CLASS } from "@/lib/pos-layout";

// D9.8 (owner decision 2026-09-26) — the cart footer's OCCASIONAL money
// controls, moved off the always-visible stack and behind one "More" button.
//
// Why: every control below the line list rendered unconditionally, so an
// ordinary sale — the overwhelming majority, no discount, no promo, no reward,
// no extra charge — still paid for all of them in vertical space. On the 22rem
// desktop column that pushed Total and the CTAs into a cramped strip; inside
// the 90dvh phone sheet it squeezed the line list onto its min-h floor, where
// a two-row cart line is clipped mid-stepper (owner screenshots, 2026-09-26:
// "side me proper view nahi mil raha" / "mobile view me to kuch bhi nahi").
// The normal case is now the fast case, which is the whole point of a POS.
//
// This component owns PRESENTATION ONLY: it renders whatever controls it is
// handed, and every piece of money state, validation and mutual exclusion
// stays exactly where it already lived (use-pos-tab / use-customer-rewards,
// assembled by buildCartProps). Nothing here computes a figure.
//
// Popover, deliberately NOT DropdownMenu: a DropdownMenuItem closes the menu
// on click and steals focus back to its trigger, which makes the discount
// field, the promo input and the charge form unusable inside it. A Popover
// keeps focus where the operator put it, so these controls behave exactly as
// they did when they sat inline.

interface CartMoreMenuProps {
  /** Rendered inside the panel, in the order the caller passes them. */
  children: ReactNode;
  /** Short labels for what is currently APPLIED (e.g. "Discount", "Promo").
   *  Summarised on the closed trigger — see the active-summary rule below. */
  activeLabels: string[];
  disabled?: boolean;
}

export function CartMoreMenu({ children, activeLabels, disabled }: CartMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const hasActive = activeLabels.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          // A control that is hiding an APPLIED adjustment must never look
          // idle: the same rule CartNotes follows for a collapsed note
          // (D9.7 — "a note that already has text always shows its preview,
          // so it can never be silently forgotten"). A hidden discount is
          // money, so the stakes here are strictly higher than a note's:
          // without this the operator could hand over a discounted bill with
          // nothing on screen saying so.
          className={cn(POS_CART_MORE_BUTTON_CLASS, hasActive && "text-foreground")}
          disabled={disabled}
          aria-label={
            hasActive
              ? `More options — ${activeLabels.join(", ")} applied`
              : "More options — discount, promo code, reward, extra charge"
          }
        >
          <MoreHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {hasActive ? activeLabels.join(" · ") : "More"}
          </span>
        </Button>
      </PopoverTrigger>

      {/* align="end" so the panel hangs off the footer's right edge and stays
          inside the 22rem desktop column instead of overhanging the product
          grid. collisionPadding keeps it clear of the viewport edges on a
          phone, where it opens above the sticky bar. */}
      <PopoverContent
        align="end"
        collisionPadding={12}
        className={POS_CART_MORE_PANEL_CLASS}
      >
        <div className="space-y-2">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
