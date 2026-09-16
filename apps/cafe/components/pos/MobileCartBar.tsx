"use client";

import { inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Cart, type CartProps } from "@/components/pos/Cart";
import {
  POS_MOBILE_ONLY_CLASS,
  POS_MOBILE_BAR_CLASS,
  POS_MOBILE_BAR_BUTTON_CLASS,
  POS_CART_SHEET_CLASS,
  POS_CART_SHEET_PANEL_CLASS,
} from "@/lib/pos-layout";

interface MobileCartBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Everything the Cart needs except its layout class, which the bar supplies
  // itself (it mounts a second Cart inside the bottom sheet). The action handlers
  // (send/pay/settle/close) ride along inside cartProps.
  cartProps: Omit<CartProps, "className">;
  count: number;
  total: number;
}

// Below xl (phones AND tablets, both orientations): the cart lives in a bottom
// sheet behind a summary bar that is the LAST child of the POS root column —
// in-flow and sticky to the viewport bottom (POS_MOBILE_BAR_CLASS), so it
// never overlaps the sidebar, needs no reserved padding, and stays in view if
// the page ever grows taller than the screen. At xl+ the cart has its own
// column. The bar is ALWAYS rendered — an empty cart gets a disabled
// placeholder rather than disappearing, so there is always something telling
// the operator where the cart is.
export function MobileCartBar({
  open,
  onOpenChange,
  cartProps,
  count,
  total,
}: MobileCartBarProps) {
  const isEmpty = cartProps.items.length === 0;
  return (
    // One element carries both the breakpoint gate and the sticky bar styling:
    // a sticky child inside a same-sized wrapper would have nowhere to move.
    <div className={cn(POS_MOBILE_ONLY_CLASS, POS_MOBILE_BAR_CLASS)}>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {isEmpty ? (
          <Button variant="secondary" size="lg" className={POS_MOBILE_BAR_BUTTON_CLASS} disabled>
            <span className="flex w-full justify-center">
              Cart is empty · tap an item to add
            </span>
          </Button>
        ) : (
          <SheetTrigger asChild>
            {/* key={count}: remounts the button whenever the count changes so
                the zoom-in replays — same trick as PublicFlowChrome's cart bar
                (the visible "yes, it went in" pop the field feedback asked for). */}
            <Button
              key={count}
              size="lg"
              className={cn(POS_MOBILE_BAR_BUTTON_CLASS, "animate-in zoom-in-95 duration-300")}
            >
              <span>
                {count} item{count === 1 ? "" : "s"} · {inr(total)}
              </span>
              <span>View cart →</span>
            </Button>
          </SheetTrigger>
        )}
        <SheetContent side="bottom" className={POS_CART_SHEET_CLASS}>
          <SheetHeader className="sr-only">
            <SheetTitle>Your cart</SheetTitle>
          </SheetHeader>
          {/* [&>button]:hidden (in POS_CART_SHEET_CLASS) hides Radix's own X —
              it collided visually with the Cart header's Clear/Close controls,
              so onBack below is the sheet's only way back. The panel class makes
              the whole Cart scroll when the sheet is shorter than its content
              (landscape phone, keyboard up) so Send/Pay never fall off-screen. */}
          <Cart
            {...cartProps}
            className={POS_CART_SHEET_PANEL_CLASS}
            onBack={() => onOpenChange(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
