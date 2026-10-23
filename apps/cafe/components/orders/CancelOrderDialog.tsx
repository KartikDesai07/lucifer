"use client";

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";

import { ORDER_REASON_MIN_LEN, ORDER_REASON_MAX_LEN } from "@/lib/constants";
import { cn, inr } from "@/lib/utils";
import {
  CONFIRM_SHEET_BODY_CLASS,
  CONFIRM_SHEET_BUTTON_CLASS,
  CONFIRM_SHEET_DESTRUCTIVE_CLASS,
  CONFIRM_SHEET_PANEL_CLASS,
  CONFIRM_SHEET_SCRIM_CLASS,
  CONFIRM_SHEET_TITLE_CLASS,
  SHEET_FIELD_CLASS,
} from "@/lib/sheet-frame";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { Textarea } from "@/components/ui/textarea";
import type { Order } from "@/types";

interface CancelOrderDialogProps {
  order: Order | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  isPending?: boolean;
}

// U2 Task 7 (design 6.10): today's dialog in the owner's HTML confirm sheet (values 12.1 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; lib/sheet-frame.ts CONFIRM_SHEET_*, as U1's ConfirmDialog
// look="sheet"): the scrim at z-index 50 (over the detail's bottom sheet) holds the 420px panel — the title and today's
// sentence, our reason, then the stacked 46px buttons. Every word, rule and the request as before; admins only (the page
// mounts it for admins). The caption over the field is the void sheet's (values 8.3); the message is the HTML's message
// ink (values 12.2: 13px 500 --bad-i). As the HTML confirm (and ConfirmDialog look="sheet"), an outside press never
// dismisses it, so a scrim tap over the detail's bottom sheet (touch, below 1280) can close neither layer: "Keep order"
// and Escape are the ways out, and the page's onOpenChange closes only an idle sheet (lib/orders-cancel-sheet.ts).
const CAPTION_CLASS = "text-[12.5px] font-semibold text-muted-foreground";
const SHORT_CLASS = "text-[13px] font-medium text-status-bad-ink";
// The 48px field (SHEET_FIELD_CLASS) as a textarea: one row tall at first, its 48px as the floor, growing by a drag.
const REASON_FIELD_CLASS = "h-auto min-h-12 resize-y py-3";
// The buttons stacked 8px apart; "Keep order" as the HTML confirm's second button (kind 0: --surface-3, --text, a
// transparent rule) — ConfirmDialog's own literals.
const BUTTONS_CLASS = "flex flex-col gap-2";
const KEEP_CLASS = "border-transparent bg-surface-3 text-foreground";

// Admin-only break-glass replacement for the old destructive delete (CR1.3).
// The order stays on the ledger — reason/who/when get written alongside it —
// so a reason field (not a ConfirmDialog yes/no) is required: the reason IS the
// audit trail.
export function CancelOrderDialog({
  order,
  onOpenChange,
  onConfirm,
  isPending = false,
}: CancelOrderDialogProps) {
  const [reason, setReason] = useState("");

  // Reset whenever a different order is targeted, so a stale reason typed for
  // one order can't be submitted against the next one opened in this dialog.
  useEffect(() => {
    setReason("");
  }, [order?._id]);

  if (!order) return null;

  const trimmed = reason.trim();
  const canConfirm = trimmed.length >= ORDER_REASON_MIN_LEN && !isPending;
  const tooShort = trimmed.length > 0 && trimmed.length < ORDER_REASON_MIN_LEN;

  return (
    <DialogPrimitive.Root open={!!order} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="cancel-sheet" className={CONFIRM_SHEET_SCRIM_CLASS}>
          <DialogPrimitive.Content
            data-ui="cancel-panel"
            className={CONFIRM_SHEET_PANEL_CLASS}
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
          >
            <div data-ui="cancel-text">
              <DialogPrimitive.Title className={CONFIRM_SHEET_TITLE_CLASS}>Cancel {order.orderId}?</DialogPrimitive.Title>
              <DialogPrimitive.Description className={CONFIRM_SHEET_BODY_CLASS}>
                Total {inr(order.total)}. The order stays on record, but it leaves
                sales totals and the payment mix, and any customer due it created
                is reversed. This cannot be undone.
              </DialogPrimitive.Description>
            </div>

            <div data-ui="cancel-reason-field" className="flex flex-col gap-1.5">
              <label htmlFor="cancel-reason" className={CAPTION_CLASS}>Reason (required)</label>
              <Textarea
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. duplicate order, guest walked out"
                maxLength={ORDER_REASON_MAX_LEN}
                rows={1}
                disabled={isPending}
                aria-invalid={tooShort}
                aria-describedby={tooShort ? "cancel-reason-short" : undefined}
                className={cn(SHEET_FIELD_CLASS, REASON_FIELD_CLASS)}
              />
              {tooShort && (
                <p id="cancel-reason-short" data-ui="cancel-reason-short" className={SHORT_CLASS}>
                  At least {ORDER_REASON_MIN_LEN} characters.
                </p>
              )}
            </div>

            <div data-ui="cancel-buttons" className={BUTTONS_CLASS}>
              <button
                type="button"
                data-ui="cancel-confirm"
                disabled={!canConfirm}
                onClick={() => onConfirm(trimmed)}
                className={cn(CONFIRM_SHEET_BUTTON_CLASS, CONFIRM_SHEET_DESTRUCTIVE_CLASS, BRAND_PRESS_CLASS)}
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cancel order
              </button>
              <DialogPrimitive.Close data-ui="cancel-keep" disabled={isPending} className={cn(CONFIRM_SHEET_BUTTON_CLASS, KEEP_CLASS, BRAND_PRESS_CLASS)}>
                Keep order
              </DialogPrimitive.Close>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
