"use client";

import { orderItemLabel } from "@pos/shared/utils";
import { cancelNote, detailCustomer, detailItemsHead, detailLineMeta, detailSums, type DetailSumTone } from "@/lib/order-detail-view";
import {
  ORDER_DETAIL_BOX_HEAD_CLASS,
  ORDER_DETAIL_LINE_CLASS,
  ORDER_DETAIL_QTY_CLASS,
  ORDER_DETAIL_RULE_CLASS,
} from "@/lib/orders-layout";
import { STATUS_CLASSES } from "@/lib/ui";
import { cn, inr } from "@/lib/utils";
import { OrderVoidTrail } from "@/components/orders/OrderVoidTrail";
import type { Order } from "@/types";

// The order detail's body (U2 Task 6; values 11.4 customer row, 11.5 items box, sums and total, 11.6 cancel note; design
// 6.8, Q9): the parts the scrolling body (lib/orders-layout.ts ORDER_DETAIL_SCROLL_CLASS) holds in the HTML's order,
// none of them shrinking. The words and figures: lib/order-detail-view.ts. No "+ Add customer": a customer is attached
// in the payment sheet, as today.

/** values 11.4: the 36px round avatar, 12.5px 600, centred. */
const AVATAR_CLASS = "flex size-9 flex-none items-center justify-center rounded-[50%] text-[12.5px] font-semibold";
/** values 11.5: --surface-2, a 1px --border-2 rule, radius 12, padding 12px 14px 14px. */
const BOX_CLASS = "relative flex-none rounded-[12px] border border-border-2 bg-surface-2 px-3.5 pt-3 pb-3.5";
/** values 11.6: the HTML's red note — radius 10, --bad-t / --bad-i, padding 11px 12px, 13px 500. */
const NOTE_CLASS = cn("flex-none rounded-[10px] px-3 py-[11px] text-[13px] font-medium", STATUS_CLASSES.bad.tint, STATUS_CLASSES.bad.ink);
/** values 11.5: the discount --bad-i, "Due at billing" --bill-i, else the sums' --text-2. */
const SUM_TONE: Record<DetailSumTone, string> = { bad: STATUS_CLASSES.bad.ink, bill: STATUS_CLASSES.bill.ink, plain: "" };

export function OrderDetailBody({ order }: { order: Order }) {
  return (
    <>
      <CustomerRow order={order} />
      <ItemsBox order={order} />
      <CancelNote order={order} />
    </>
  );
}

function CustomerRow({ order }: { order: Order }) {
  const c = detailCustomer(order);
  return (
    <div data-ui="order-detail-customer" className="flex flex-none items-center gap-2.5">
      <span
        data-ui="order-detail-avatar"
        aria-hidden
        className={cn(AVATAR_CLASS, c.named ? "bg-accent text-accent-foreground" : "bg-surface-3 text-subtle-foreground")}
      >
        {c.initials}
      </span>
      <span data-ui="order-detail-customer-text" className="min-w-0 flex-1">
        <span data-ui="order-detail-customer-name" className="block truncate text-[14px] font-semibold">
          {c.name}
        </span>
        {c.sub && (
          <span data-ui="order-detail-customer-sub" className="block truncate text-[12.5px] text-subtle-foreground">
            {c.sub}
          </span>
        )}
      </span>
    </div>
  );
}

function ItemsBox({ order }: { order: Order }) {
  const sums = detailSums(order);
  return (
    <div data-ui="order-detail-items" className={BOX_CLASS}>
      <div data-ui="order-detail-items-head" className={ORDER_DETAIL_BOX_HEAD_CLASS}>
        <span>{detailItemsHead(order)}</span>
        <span>Amount</span>
      </div>
      {order.items.map((item, i) => {
        const meta = detailLineMeta(item);
        return (
          <div key={`${item.productId}-${i}`} data-ui="order-detail-line" className={ORDER_DETAIL_LINE_CLASS}>
            <span data-ui="order-detail-line-qty" className={ORDER_DETAIL_QTY_CLASS}>
              {item.qty}×
            </span>
            <span data-ui="order-detail-line-text" className="min-w-0">
              <span data-ui="order-detail-line-name" className="block text-[13.5px] font-medium">
                {orderItemLabel(item)}
              </span>
              {meta && (
                <span data-ui="order-detail-line-meta" className="block text-[12px] text-subtle-foreground">
                  {meta}
                </span>
              )}
            </span>
            {/* CB-5B — a reward line's money is excluded from the subtotal (lib/receipt.ts's reducer skips it), so its
                real price shows struck with FREE: an unmarked amount would make the sums below visibly not add up. */}
            {item.reward ? (
              <span data-ui="order-detail-line-total" className="whitespace-nowrap font-mono text-[13.5px]">
                <span className="text-subtle-foreground line-through">{inr(item.price * item.qty)}</span> FREE
              </span>
            ) : (
              <span data-ui="order-detail-line-total" className="font-mono text-[13.5px]">
                {inr(item.price * item.qty)}
              </span>
            )}
          </div>
        );
      })}
      <div data-ui="order-detail-rule" aria-hidden className={cn(ORDER_DETAIL_RULE_CLASS, "mt-1.5 mb-2")} />
      <div data-ui="order-detail-sums" className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
        {sums.rows.map((r, i) => (
          <div key={`${r.label}-${i}`} data-ui="order-detail-sum" className={cn("flex justify-between gap-3", SUM_TONE[r.tone])}>
            <span data-ui="order-detail-sum-label">{r.label}</span>
            <span data-ui="order-detail-sum-value" className="flex-none font-mono">
              {r.value}
            </span>
          </div>
        ))}
      </div>
      <div data-ui="order-detail-rule" aria-hidden className={cn(ORDER_DETAIL_RULE_CLASS, "my-2.5")} />
      <div data-ui="order-detail-total" className="flex items-baseline justify-between">
        <span data-ui="order-detail-total-label" className="text-[14px] font-semibold">
          {sums.totalLabel}
        </span>
        <span
          data-ui="order-detail-total-value"
          className={cn("font-mono text-[22px] font-semibold tracking-[-0.02em]", sums.struck ? "text-subtle-foreground line-through" : "text-foreground")}
        >
          {sums.total}
        </span>
      </div>
      {order.voids && order.voids.length > 0 && <OrderVoidTrail voids={order.voids} />}
    </div>
  );
}

function CancelNote({ order }: { order: Order }) {
  const note = cancelNote(order);
  if (!note) return null;
  return (
    <div data-ui="order-detail-note" className={NOTE_CLASS}>
      <p>{note.text}</p>
      {note.reason && <p>{note.reason}</p>}
    </div>
  );
}
