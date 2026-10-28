"use client";

import { useRef } from "react";

// U1 Task 9 (ruling P22, as the item options modal): a Radix dialog opened from its caller's state has no trigger to
// give the focus back to, so it fell to <body> on close. Spread on the dialog's Content: the panel itself takes the
// focus as it opens (no ring on its first control, no phone keyboard for a field) and the focus goes back to what had it
// (the Pay button, F9, the order sheet's Settle & Pay) as it closes.
// U2 verification fix (V-C F4; lib/use-opener-focus.test.ts): `focusPanel: false` keeps Radix's own open focus (the
// first control) for a sheet whose field must take the focus as it opens — the Orders cancel sheet's reason (Ruling
// P17) — and only remembers the opener and gives the focus back to it. With no options: exactly as before.
export function useOpenerFocus({ focusPanel = true }: { focusPanel?: boolean } = {}): {
  onOpenAutoFocus: (e: Event) => void;
  onCloseAutoFocus: (e: Event) => void;
} {
  const openerRef = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (e) => {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!focusPanel) return;
      e.preventDefault();
      if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus();
    },
    onCloseAutoFocus: (e) => {
      e.preventDefault();
      if (openerRef.current?.isConnected) openerRef.current.focus();
    },
  };
}
