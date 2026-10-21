"use client";

import { useRef } from "react";

// U1 Task 9 (ruling P22, as the item options modal): a Radix dialog opened from its caller's state has no trigger to
// give the focus back to, so it fell to <body> on close. Spread on the dialog's Content: the panel itself takes the
// focus as it opens (no ring on its first control, no phone keyboard for a field) and the focus goes back to what had it
// (the Pay button, F9, the order sheet's Settle & Pay) as it closes.
export function useOpenerFocus(): { onOpenAutoFocus: (e: Event) => void; onCloseAutoFocus: (e: Event) => void } {
  const openerRef = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (e) => {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      e.preventDefault();
      if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus();
    },
    onCloseAutoFocus: (e) => {
      e.preventDefault();
      if (openerRef.current?.isConnected) openerRef.current.focus();
    },
  };
}
