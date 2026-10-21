"use client";

import { useEffect, useRef } from "react";

import { posKeyAction } from "@/lib/pos-keys";

// U1 Task 5 (owner Q13; design 6.13; values 13.2): the /pos keys — "/" focuses the menu search, F8 presses Send KOT,
// F9 presses Pay. Rendered ONCE by the page (the cart mounts twice: the column and, below 1024px, the sheet), it
// listens on the window and presses the VISIBLE cart's own button, so a key does exactly what a tap does (the same
// handler, the same idempotent send) and nothing a disabled button would refuse. lib/pos-keys.ts decides: never while
// typing in a field, never with a dialog, sheet or panel open, never while busy, never on auto-repeat (a held F8 sends
// once). The cart sheet below 1024px is where the buttons live there, so it is no dialog to the keys while it is the
// only one open.

const OPEN_DIALOGS = "[role='dialog'], [role='alertdialog']";
const CART_SHEET = "[data-ui='pos-cart-sheet']";

/** The first element matching `selector` that is on screen (the hidden cart mount has no box). */
function visible<T extends HTMLElement>(selector: string): T | null {
  for (const el of document.querySelectorAll<T>(selector)) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

/** A dialog, sheet or panel is open other than the cart sheet itself. */
function otherDialogOpen(): boolean {
  for (const el of document.querySelectorAll<HTMLElement>(OPEN_DIALOGS)) {
    if (el.getClientRects().length > 0 && !el.matches(CART_SHEET)) return true;
  }
  return false;
}

export function PosKeys({ busy }: { busy: boolean }) {
  // Read at the key press, so the listener is added once.
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const send = visible<HTMLButtonElement>("[data-ui='pos-send']");
      const pay = visible<HTMLButtonElement>("[data-ui='pos-pay']");
      const action = posKeyAction(e, {
        dialogOpen: otherDialogOpen(),
        busy: busyRef.current,
        sendEnabled: !!send && !send.disabled,
        payEnabled: !!pay && !pay.disabled,
      });
      if (action === null) return;
      if (action === "search") {
        const search = visible<HTMLInputElement>("[data-ui='pos-search']");
        if (!search || search.disabled) return;
        e.preventDefault();
        search.focus();
        return;
      }
      e.preventDefault();
      (action === "send" ? send : pay)?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
