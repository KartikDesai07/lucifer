"use client";

import { useEffect, useRef } from "react";

import { shouldCloseEmptiedSheet } from "@/lib/pos-cart-view";

// Ruling P50 (U1 audit wave, report M-1): the /pos cart sheet below 1280px closes by itself only as the order's last
// item goes with nothing applied left (lib/pos-cart-view.ts shouldCloseEmptiedSheet: main's "last item removed / Clear /
// order settled" close), never when only an adjustment leaves an order that already had no items — owner Q18 made the
// empty sheet a working place. The count it last saw lives in a ref, read and moved on inside the effect, so a change
// of the adjustment alone compares the count with itself. `setOpen` is the page's state setter (stable).
export function useEmptiedSheetClose(count: number, pendingAdjustment: boolean, setOpen: (open: boolean) => void): void {
  const prevCount = useRef(count);
  useEffect(() => {
    if (shouldCloseEmptiedSheet(prevCount.current, count, pendingAdjustment)) setOpen(false);
    prevCount.current = count;
  }, [count, pendingAdjustment, setOpen]);
}
