"use client";

import { PUBLIC_ORDER_MAX_ITEMS } from "@pos/shared/public";
import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// CR2.4 (A20 mechanical follow-up) — extracted from PublicOrderFlow.tsx,
// which had grown past the ~300-line file cap. Behavior-identical: same
// class strings (they carry S3's pub tokens, kept intact), same conditions,
// same copy. PublicOrderFlow still owns all the state these blocks read —
// this file is purely presentational.

const ITEM_CAP_NOTICE = `You've reached the ${PUBLIC_ORDER_MAX_ITEMS}-item limit for one order — send this order first, then start a new one.`;
const STALE_CART_NOTICE = "The menu changed — your cart was updated.";

interface PublicFlowChromeProps {
  staleNotice: boolean;
  onDismissStale: () => void;
  itemCapNotice: boolean;
  cartCount: number;
  total: number;
  onOpenCart: () => void;
}

export function PublicFlowChrome({
  staleNotice,
  onDismissStale,
  itemCapNotice,
  cartCount,
  total,
  onOpenCart,
}: PublicFlowChromeProps) {
  return (
    <>
      {/* CR2.4 (A20) — density reaches this persistent chrome (the menu list
          sits in the same viewport); modals/sheets stay untokenised (§22.5). */}
      {staleNotice && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-pub-gap bg-muted px-pub-pad py-pub-pad text-xs text-muted-foreground">
          <span>{STALE_CART_NOTICE}</span>
          <button
            type="button"
            onClick={onDismissStale}
            aria-label="Dismiss"
            className="shrink-0 font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {itemCapNotice && (
        <p className="fixed inset-x-0 bottom-16 z-40 mx-auto max-w-lg px-3 text-center text-xs text-destructive">
          {ITEM_CAP_NOTICE}
        </p>
      )}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background p-pub-pad animate-in slide-in-from-bottom-4 duration-300">
          {/* key={cartCount}: remounts the button whenever the count changes so
              the zoom-in replays — the visible "yes, it went in" pop the field
              feedback (2026-08-20) asked for; the stepper's own morph covers
              the tile, this covers the running total. The entire bar IS the
              button (h-14, full width) — one tappable control, no sub-hitzones. */}
          <Button
            key={cartCount}
            className="mx-auto flex h-14 w-full max-w-lg items-center justify-center animate-in zoom-in-95 duration-300"
            onClick={onOpenCart}
          >
            {cartCount} item{cartCount === 1 ? "" : "s"} · {inr(total)} — View cart
          </Button>
        </div>
      )}
    </>
  );
}
