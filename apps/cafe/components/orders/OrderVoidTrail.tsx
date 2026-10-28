"use client";

import { orderItemLabel, orderItemModifierLines } from "@pos/shared/utils";
import { voidLineNote } from "@/lib/order-detail-view";
import {
  ORDER_DETAIL_BOX_HEAD_CLASS,
  ORDER_DETAIL_LINE_CLASS,
  ORDER_DETAIL_QTY_CLASS,
  ORDER_DETAIL_RULE_CLASS,
} from "@/lib/orders-layout";
import { cn, inr } from "@/lib/utils";
import type { OrderVoid } from "@/types";

interface OrderVoidTrailProps {
  voids: OrderVoid[];
}

// Read-only record of lines taken OFF an open tab after the kitchen had already been told to make them (CR1.3
// item-level void) — append-only server side ($push, voidGuardFilter), so there is nothing here to edit or undo. Drawn
// inside the detail's items box under its total (U2 Task 6, design 6.8, our option): a dashed rule, the caption in the
// box head's look, then each void as an item line — "{qty}×", the name struck in --text-3, its modifiers and
// "round n · reason — who, date" under it, its amount struck.
export function OrderVoidTrail({ voids }: OrderVoidTrailProps) {
  return (
    <div data-ui="order-detail-voids">
      <div data-ui="order-detail-voids-rule" aria-hidden className={cn(ORDER_DETAIL_RULE_CLASS, "my-2.5")} />
      <p data-ui="order-detail-voids-head" className={ORDER_DETAIL_BOX_HEAD_CLASS}>
        Voided after the kitchen was notified
      </p>
      {voids.map((v, i) => (
        <div key={i} data-ui="order-detail-void" className={ORDER_DETAIL_LINE_CLASS}>
          <span data-ui="order-detail-void-qty" className={ORDER_DETAIL_QTY_CLASS}>
            {v.qty}×
          </span>
          <span className="min-w-0">
            <span data-ui="order-detail-void-name" className="block text-[13.5px] font-medium text-subtle-foreground line-through">
              {orderItemLabel(v)}
            </span>
            {orderItemModifierLines(v).map((line) => (
              <span key={line} data-ui="order-detail-void-meta" className="block text-[12px] text-subtle-foreground">
                {line}
              </span>
            ))}
            <span data-ui="order-detail-void-meta" className="block text-[12px] text-subtle-foreground">
              {voidLineNote(v)}
            </span>
          </span>
          {/* CB-5B — the voided line was a comped reward dish. Same struck-through-worth + FREE treatment as the bill
              and the other staff surfaces (OrderReceipt/OrderDetailBody/VoidItemDialog): its `price` is the dish's real
              value, but no cash is coming back off this bill, so an unmarked amount here reads as a refund that never
              happened. */}
          {v.reward ? (
            <span data-ui="order-detail-void-total" className="whitespace-nowrap font-mono text-[13.5px] text-subtle-foreground">
              <span className="line-through">{inr(v.price * v.qty)}</span> FREE
            </span>
          ) : (
            <span data-ui="order-detail-void-total" className="font-mono text-[13.5px] text-subtle-foreground line-through">
              {inr(v.price * v.qty)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
