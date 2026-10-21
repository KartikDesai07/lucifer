"use client";

// Why a new file: Discard for an unconfirmed send (R-d) is offered in two
// places — the cart (Send to Kitchen) and the payment popup (Pay Now) — and
// both must confirm first. It reuses the shared ConfirmDialog; the wording
// lives in lib/pos-send.ts next to the rest of the send copy.
//
// U1 Task 5 (design 6.8): in the cart, Discard takes a button slot of the HTML's footer, so the cart hands it that
// slot's look (`className`); U1 Task 9 (design 6.11): the payment sheet hands it its 50px button look the same way.
// U1 Task 12 (design 6.12): both surfaces hand it their look, so the kit-outline fallback went; the confirm is the HTML's
// confirm sheet (values 12.1).

import { useState } from "react";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SEND_DISCARD_KITCHEN, SEND_DISCARD_PAY, type SendKind } from "@/lib/pos-send";

interface SendDiscardProps {
  kind: SendKind;
  disabled: boolean;
  onDiscard: () => void;
  /** The look of the slot the button sits in (the cart's footer, the payment sheet). */
  className: string;
}

export function SendDiscard({ kind, disabled, onDiscard, className }: SendDiscardProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)}>
        Discard
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={kind === "pay" ? "Discard this sale?" : "Discard this order?"}
        description={kind === "pay" ? SEND_DISCARD_PAY : SEND_DISCARD_KITCHEN}
        confirmLabel="Discard"
        cancelLabel="Keep"
        onConfirm={() => {
          setOpen(false);
          onDiscard();
        }}
        look="sheet"
      />
    </>
  );
}
