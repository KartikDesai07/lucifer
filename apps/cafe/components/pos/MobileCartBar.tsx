"use client";

import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Cart, type CartProps } from "@/components/pos/Cart";

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

// Phones: the cart lives in a bottom sheet behind a sticky summary bar. Hidden
// from md up, where the cart has its own column. The primary/secondary actions
// live inside the in-sheet Cart (never crammed onto the sticky bar).
export function MobileCartBar({
  open,
  onOpenChange,
  cartProps,
  count,
  total,
}: MobileCartBarProps) {
  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={onOpenChange}>
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3">
          <SheetTrigger asChild>
            <Button
              className="flex w-full items-center justify-between"
              size="lg"
              disabled={cartProps.items.length === 0}
            >
              <span>
                {count} item{count === 1 ? "" : "s"}
              </span>
              <span>{inr(total)} · View cart</span>
            </Button>
          </SheetTrigger>
        </div>
        <SheetContent side="bottom" className="h-[85dvh] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Your cart</SheetTitle>
          </SheetHeader>
          <Cart {...cartProps} className="rounded-none border-0" />
        </SheetContent>
      </Sheet>
    </div>
  );
}
