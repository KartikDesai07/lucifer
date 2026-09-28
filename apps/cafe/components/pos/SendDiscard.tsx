"use client";

// Why a new file: Discard for an unconfirmed send (R-d) is offered in two
// places — the cart (Send to Kitchen) and the payment popup (Pay Now) — and
// both must confirm first. It reuses the shared ConfirmDialog; the wording
// lives in lib/pos-send.ts next to the rest of the send copy.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { POS_CART_CTA_CLASS } from "@/lib/pos-layout";
import { SEND_DISCARD_KITCHEN, SEND_DISCARD_PAY, type SendKind } from "@/lib/pos-send";

interface SendDiscardProps {
  kind: SendKind;
  disabled: boolean;
  onDiscard: () => void;
}

export function SendDiscard({ kind, disabled, onDiscard }: SendDiscardProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="lg" className={POS_CART_CTA_CLASS} disabled={disabled} onClick={() => setOpen(true)}>
        Discard
      </Button>
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
      />
    </>
  );
}
