"use client";

import { useEffect, useRef } from "react";

import { emptiedSheetStart, emptiedSheetStep, type EmptiedSheetState } from "@/lib/pos-cart-view";

// Rulings P50 / P55 (U1 audit wave and its fix round, report M-1, review I-1): the /pos cart sheet below 1280px closes
// by itself once the open sheet's order has been emptied (its items from some to none: main's "last item removed /
// Clear / order settled" close) and no adjustment is left — in that render or a later one, since an auto-armed stamp
// reward lets go one render after the items (hooks/use-customer-rewards.ts). It never closes an empty sheet opened on
// an order with no items: owner Q18 made it a working place. The rule is lib/pos-cart-view.ts emptiedSheetStep, tested
// over render sequences; its state lives in a ref, stepped once per change inside the effect (no render of its own),
// starting from the first render's figures (that render never closes). `setOpen` is the page's state setter (stable).
export function useEmptiedSheetClose(
  count: number,
  pendingAdjustment: boolean,
  open: boolean,
  setOpen: (open: boolean) => void,
): void {
  const state = useRef<EmptiedSheetState>(emptiedSheetStart({ count, open }));
  useEffect(() => {
    const step = emptiedSheetStep(state.current, { count, pendingAdjustment, open });
    state.current = step.state;
    if (step.close) setOpen(false);
  }, [count, pendingAdjustment, open, setOpen]);
}
