"use client";

import { useEffect, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { inr, cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { Cart, type CartProps } from "@/components/pos/Cart";
import { hasPendingAdjustment } from "@/lib/pos-cart-props";
import { keepOpenForNestedDialog } from "@/lib/nested-dialog";
import { cartTitle, orderBarSummary } from "@/lib/pos-cart-view";
import {
  POS_CART_COLUMN_MIN_PX,
  POS_MOBILE_BAR_CLASS,
  POS_MOBILE_BAR_BUTTON_CLASS,
  POS_CART_SHEET_SCRIM_CLASS,
  POS_CART_SHEET_CLASS,
  POS_CART_SHEET_PANEL_CLASS,
} from "@/lib/pos-layout";

interface MobileCartBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Everything the Cart needs except its layout class, which the bar supplies
  // itself (it mounts a second Cart inside the sheet). The action handlers
  // (send/pay/settle/close) ride along inside cartProps, and so do the bar's
  // own figures (count, total, the tab on screen, an unanswered send).
  cartProps: Omit<CartProps, "className">;
}

/** From here the cart is the page's column (values 0.3 cartDisplay; owner Q19: 1280px), never a sheet. */
const CART_COLUMN_QUERY = `(min-width: ${POS_CART_COLUMN_MIN_PX}px)`;

// Below 1280px (U1 Task 7; values 6.1, 6.3; design 6.9; owner Q18, Q19): the owner's HTML glass order bar over the
// page's foot — "{n} items · {order}" over the total, and "Review order" — shown in EVERY state, an empty new order too
// ("No items · New order"), so the table, the customer, the note and the bill options are reachable before the first
// item. "Review order" opens the cart sheet: a Radix dialog (focus trapped, Escape and "‹ Menu" in the cart's head close
// it) drawn as the HTML's cart section over the whole screen at every width below 1280px (owner Q19: the phone's sheet,
// over the header, the rail and the tab bar, no scrim), sliding up from the window's foot. Its panel names itself
// (data-ui="pos-cart-sheet"): the F8 / F9 keys treat it as the cart, not as a dialog (PosKeys). The page closes it by
// itself once the cart is TRULY empty (pos/page.tsx); the bar stays.
export function MobileCartBar({ open, onOpenChange, cartProps }: MobileCartBarProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // A sheet left open while the window grows to 1280px (a window widened to a laptop's) gives way to the cart column,
  // as the HTML's does — otherwise it would lie over the column, with the page behind it locked.
  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia(CART_COLUMN_QUERY);
    const closeOnColumn = () => {
      if (query.matches) onOpenChange(false);
    };
    closeOnColumn();
    query.addEventListener("change", closeOnColumn);
    return () => query.removeEventListener("change", closeOnColumn);
  }, [open, onOpenChange]);

  // D9.8c — an adjustment SURVIVES Clear (onClear is clearCart, items only), so an item-less cart can still carry a
  // promo, reward, discount or extra charge: the line says so (the shared predicate the page's auto-close uses). An
  // unanswered send says its notice's title ("Couldn't confirm") with the sheet closed.
  const summary = orderBarSummary({
    count: cartProps.count,
    title: cartTitle({ resumedOrder: cartProps.resumedOrder }),
    adjustment: hasPendingAdjustment(cartProps),
    noticeTitle: cartProps.sendNotice ? cartProps.sendNotice.title : null,
  });

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {/* While the sheet is open the bar steps aside (values 6.1 showBar: !cartOpen); closing it brings the bar back
          before the focus returns to Review order. */}
      <div data-ui="pos-order-bar" data-open={open ? "" : undefined} className={POS_MOBILE_BAR_CLASS}>
        {/* The two lines (values 6.1): 12px --text-2, then the total 18px 600 -.015em. */}
        <div className="min-w-0 flex-1">
          <div data-ui="pos-order-bar-summary" className="text-[12px] text-muted-foreground">
            {summary}
          </div>
          <div data-ui="pos-order-bar-total" className="text-[18px] font-semibold tracking-[-0.015em]">
            {inr(cartProps.total)}
          </div>
        </div>
        <DialogPrimitive.Trigger asChild>
          <button type="button" data-ui="pos-review-order" className={cn(POS_MOBILE_BAR_BUTTON_CLASS, BRAND_PRESS_CLASS)}>
            Review order
          </button>
        </DialogPrimitive.Trigger>
      </div>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="pos-cart-scrim" className={POS_CART_SHEET_SCRIM_CLASS} />
        {/* Ruling P38: closing a nested dialog by a press (the payment, the void, the move, a confirm prompt: the page
            renders them beside this sheet) leaves the sheet open. */}
        <DialogPrimitive.Content
          data-ui="pos-cart-sheet"
          ref={sheetRef}
          aria-describedby={undefined}
          className={POS_CART_SHEET_CLASS}
          onInteractOutside={(e) => keepOpenForNestedDialog(e, sheetRef.current)}
        >
          <DialogPrimitive.Title className="sr-only">Your cart</DialogPrimitive.Title>
          {/* The sheet's way back is the head's "‹ Menu" (onBack); the panel class makes the whole Cart scroll when the
              sheet is shorter than its content (landscape phone, keyboard up), so Send / Pay never fall off-screen. */}
          <Cart {...cartProps} className={POS_CART_SHEET_PANEL_CLASS} onBack={() => onOpenChange(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
