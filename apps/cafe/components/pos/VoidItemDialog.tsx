"use client";

import { useEffect, useId, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";

import { ORDER_REASON_MIN_LEN, ORDER_REASON_MAX_LEN } from "@/lib/constants";
import { cn, inr } from "@/lib/utils";
import { isLastLine } from "@/lib/order-void-rules";
import { matchVoidLine } from "@/lib/pos-cart-view";
import { useStableCallback } from "@/hooks/use-stable-callback";
import { useOpenerFocus } from "@/hooks/use-opener-focus";
import { orderLineKey } from "@pos/shared/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { Input } from "@/components/ui/input";
import { orderItemLabel, orderItemModifierLines } from "@pos/shared/utils";
import type { Order, VoidItemInput } from "@/types";

interface VoidItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  isPending?: boolean;
  onConfirm: (payload: VoidItemInput) => void;
  // The sent line the cart's Void action named (U1 Task 4, owner Q10): its position in order.items and its lineKey.
  // The dialog opens with it picked while the stored order still holds it there; otherwise nothing is picked.
  initialLine?: { index: number; lineKey: string } | null;
}

// U1 Task 12 (design 6.12): the void dialog in the owner's HTML sheet frame (docs/superpowers/specs/2026-10-20-pos-html-values.md:
// the 420px confirm frame of values 12.1; the head of values 8.1; the check rows and the stepper of values 10.1; the 48px
// field of values 8.3). Every word, rule and the payload as before; the head's ✕ and the foot's Cancel close it.

// The scrim (values 12.1, 0.3 sheetAlign / sheetPad): fixed at z-index 50, --scrim, fadeIn .2s; the panel centred in
// 16px, along the window's foot with no padding below 720px.
const SCRIM_CLASS =
  "fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0";
// The panel (values 12.1): 420px on --surface, a 1px --border, radius 14 (14 14 0 0 below 720px), --pop, sheetIn .34s;
// content-sized up to the sheets' caps (values 0.3 csMaxH: 100dvh - 32px, 88dvh below 720px), the body scrolls. The vh
// caps are the base, the dvh ones where they exist.
const PANEL_CLASS =
  "flex w-full max-w-[420px] flex-col overflow-hidden rounded-[14px] border border-border bg-card [box-shadow:var(--pop)] outline-none motion-safe:animate-sheet-in tab:max-h-[calc(100vh-32px)] tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)] max-tab:max-h-[88vh] max-tab:rounded-[14px_14px_0_0] max-tab:supports-[height:1dvh]:max-h-[88dvh]";
// The head (values 8.1): 16px 16px 12px, gap 10; the title 17px 600 over today's description as the sub, 12.5px
// --text-2; the 32px round ✕ on --surface-3 (--text-2; the UA's 1px 6px: the HTML sets none), a 13px cross.
const HEAD_CLASS = "flex flex-none items-center gap-2.5 px-4 pt-4 pb-3";
const TITLE_CLASS = "text-[17px] font-semibold";
const SUB_CLASS = "text-[12.5px] text-muted-foreground";
const CLOSE_CLASS =
  "flex size-8 flex-none cursor-pointer items-center justify-center rounded-[50%] border-0 bg-surface-3 px-1.5 py-px text-muted-foreground";
// The body (values 8.3's form): 4px 16px 8px, the blocks 14px apart, the one scroller.
const BODY_CLASS = "flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4 pt-1 pb-2";
// Our "nothing sent" line in the HTML's empty block (values 8.2): 24px 12px, centred, 13.5px --text-2 at 1.5.
const EMPTY_CLASS = "px-3 py-6 text-center text-[13.5px] leading-[1.5] text-muted-foreground";
// The sent lines (values 10.1's add-on list): a 1px --border list, radius 10, today's 14rem cap scrolling a long tab;
// 42px rows (taller with our modifier lines), 0 12px, gap 10, 14px --text, a --border-2 rule under each but the last
// (the list's own border closes it: no doubled line), hover --hover.
const LIST_CLASS = "max-h-56 overflow-y-auto rounded-[10px] border border-border";
const ROW_CLASS =
  "flex min-h-[42px] w-full cursor-pointer items-center gap-2.5 border-b border-border-2 bg-card px-3 py-2 text-left text-[14px] text-foreground last:border-b-0 hover:bg-hover";
// The check (values 10.1-10.2), round for one choice: 18px, a 1.5px rule; the picked line's --accent box and fill with
// the white check, the others a --text-3 ring on --surface.
const CHECK_CLASS =
  "flex size-[18px] flex-none items-center justify-center rounded-[50%] border-[1.5px] text-[11px] text-primary-foreground";
const CHECK_ON_CLASS = "border-primary bg-primary";
const CHECK_OFF_CLASS = "border-subtle-foreground bg-card";
const NAME_CLASS = "min-w-0 flex-1";
const MODIFIER_CLASS = "block text-[12px] text-muted-foreground";
// The line's money at the row's right in the add-on price's --text-2.
const PRICE_CLASS = "flex-none whitespace-nowrap text-muted-foreground";
// The quantity: the caption (values 8.3) left, the 46px stepper (values 10.1: 1px --border, radius 10; 42x44 "−" / "+"
// 18px --text, the UA's padding; the qty 15px 600) right.
const QTY_ROW_CLASS = "flex items-center justify-between gap-2.5";
const CAPTION_CLASS = "text-[12.5px] font-semibold text-muted-foreground";
const STEPPER_CLASS = "flex h-[46px] items-center rounded-[10px] border border-border";
const STEP_CLASS = "h-11 w-[42px] cursor-pointer border-0 bg-transparent px-1.5 py-px text-[18px] text-foreground";
const QTY_CLASS = "min-w-6 text-center text-[15px] font-semibold";
// The last-line guard in the HTML's message ink (values 12.2: 13px 500 --bad-i).
const GUARD_CLASS = "text-[13px] font-medium leading-[1.5] text-status-bad-ink";
// The reason (values 8.3): the caption 6px over the 48px field, radius 12, a 1.5px --border rule, 0 12px, 15px (16px
// below 720px, ruling R36), the --text-3 placeholder; on the kit Input through tailwind-merge (its focus ring stays).
const FIELD_CLASS = "flex flex-col gap-1.5";
const FIELD_INPUT_CLASS =
  "h-12 rounded-[12px] border-[1.5px] border-border px-3 py-0 text-[15px] leading-[normal] placeholder:text-subtle-foreground md:text-[15px] max-tab:text-base";
// The foot (values 8.2): 12px 16px and 14px + the safe area, gap 8, a --border-2 rule. "Void item" as the HTML confirm's
// 46px button (values 12.1: radius 10, 14.5px 600) in --bad with white text (design 6.12), at .5 until the form is
// complete; "Cancel" as the confirm's link button (kind 2: transparent, --link).
const FOOT_CLASS =
  "flex flex-none flex-col gap-2 border-t border-border-2 px-4 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]";
const VOID_CLASS =
  "h-[46px] w-full cursor-pointer rounded-[10px] border border-status-bad bg-status-bad px-1.5 py-px text-[14.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const CANCEL_CLASS =
  "h-[46px] w-full cursor-pointer rounded-[10px] border border-transparent bg-transparent px-1.5 py-px text-[14.5px] font-semibold text-link";

// Void or qty-reduce one already-fired line on the resumed tab (CR1.3-B). The
// index sent to the server is the line's REAL position in order.items, never a
// cart index — embedded item rows carry no _id, so position + the line's whole
// identity (lineKey, from orderLineKey — the single definition of "the same
// line") is the address, and the server 409s if the operator's view is stale
// (another device fired a round, voided a line, or shifted the trail first).
export function VoidItemDialog({
  open,
  onOpenChange,
  order,
  isPending,
  onConfirm,
  initialLine,
}: VoidItemDialogProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  // The stepper is named by its caption.
  const qtyId = useId();
  // Opened from the cart's Void (state, no trigger): the panel takes the focus and gives it back on close.
  const openerFocus = useOpenerFocus();

  const firedLines = (order?.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.kotRound ?? 0) >= 1);

  // The line the dialog opens on (and its whole quantity, as a tap on it gives), read at the moment it opens.
  const opening = useStableCallback(() => {
    const index = order && initialLine ? matchVoidLine(order.items, initialLine) : null;
    return { index, qty: index === null ? 1 : (order?.items[index]?.qty ?? 1) };
  });

  // Reset the form each time the dialog opens for a (possibly different) order.
  useEffect(() => {
    if (open) {
      const start = opening();
      setSelected(start.index);
      setQty(start.qty);
      setReason("");
    }
  }, [open, order?._id, opening]);

  const line = selected === null ? null : order?.items[selected];
  const trimmedReason = reason.trim();
  // Voiding this selection would leave the tab with zero items — that's a
  // cancellation, which is admin-only and rejected server-side with no way for
  // a cashier to act on the message. Caught up front instead of surfaced as a
  // 400 the operator can't do anything about (CR1.3 review).
  const wouldEmptyTab =
    !!order && selected !== null && isLastLine(order.items, selected, qty);
  const canConfirm =
    !!line &&
    trimmedReason.length >= ORDER_REASON_MIN_LEN &&
    !wouldEmptyTab &&
    !isPending;

  const selectLine = (index: number) => {
    setSelected(index);
    // Default to voiding the whole line — the common case.
    setQty(order?.items[index]?.qty ?? 1);
  };

  const confirm = () => {
    if (!line || selected === null || !order) return;
    onConfirm({
      index: selected,
      lineKey: orderLineKey(line),
      qty,
      expectedVoids: order.voids?.length ?? 0,
      reason: trimmedReason,
    });
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="void-sheet" className={SCRIM_CLASS}>
          <DialogPrimitive.Content data-ui="void-panel" {...openerFocus} className={PANEL_CLASS}>
            <div data-ui="void-head" className={HEAD_CLASS}>
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title data-ui="void-title" className={TITLE_CLASS}>Void an item</DialogPrimitive.Title>
                <DialogPrimitive.Description className={SUB_CLASS}>
                  The kitchen gets a VOID slip for this line. This cannot be undone.
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close data-ui="void-close" aria-label="Close" className={cn(CLOSE_CLASS, BRAND_PRESS_CLASS)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </DialogPrimitive.Close>
            </div>

            <div data-ui="void-body" className={BODY_CLASS}>
              {firedLines.length === 0 ? (
                <p className={EMPTY_CLASS}>
                  Nothing sent to the kitchen yet on this tab.
                </p>
              ) : (
                <RadioGroupPrimitive.Root
                  data-ui="void-lines"
                  value={selected === null ? undefined : String(selected)}
                  onValueChange={(v) => selectLine(Number(v))}
                  className={LIST_CLASS}
                >
                  {firedLines.map(({ item, index }) => {
                    const on = selected === index;
                    return (
                      <RadioGroupPrimitive.Item
                        key={index}
                        value={String(index)}
                        data-ui="void-line"
                        className={cn(ROW_CLASS, BRAND_PRESS_CLASS)}
                      >
                        <span aria-hidden="true" data-ui="void-check" className={cn(CHECK_CLASS, on ? CHECK_ON_CLASS : CHECK_OFF_CLASS)}>
                          {on ? "✓" : ""}
                        </span>
                        {/* orderItemLabel, not item.name: two sizes of one dish are
                            two different prices, and a row that omits the size makes
                            the operator pick blind — the wrong money then comes off
                            the bill and the kitchen stops making the wrong cover. */}
                        <span className={NAME_CLASS}>
                          {orderItemLabel(item)} × {item.qty}
                          {/* Two pizzas that differ only by "NO Mushroom" must not
                              look alike at the moment the operator picks one. */}
                          {orderItemModifierLines(item).map((line) => (
                            <span key={line} className={MODIFIER_CLASS}>
                              {line}
                            </span>
                          ))}
                        </span>
                        {/* CB-5B — this is the moment the operator picks WHICH line
                            to void, and a reward line has different money
                            consequences (its price is already excluded from the
                            subtotal, so voiding it takes back a stamp, not cash).
                            Same struck-through-worth + FREE treatment as the bill
                            (OrderReceipt.tsx) so staff can tell the two apart. */}
                        {item.reward ? (
                          <span className={PRICE_CLASS}>
                            <span className="line-through opacity-60">{inr(item.price * item.qty)}</span>{" "}
                            FREE
                          </span>
                        ) : (
                          <span className={PRICE_CLASS}>{inr(item.price * item.qty)}</span>
                        )}
                      </RadioGroupPrimitive.Item>
                    );
                  })}
                </RadioGroupPrimitive.Root>
              )}

              {line && (
                <div data-ui="void-qty-row" className={QTY_ROW_CLASS}>
                  <span id={qtyId} className={CAPTION_CLASS}>Quantity to void</span>
                  <div data-ui="void-stepper" role="group" aria-labelledby={qtyId} className={STEPPER_CLASS}>
                    <button
                      type="button"
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      aria-label="Decrease quantity"
                      className={cn(STEP_CLASS, BRAND_PRESS_CLASS)}
                    >−</button>
                    <span data-ui="void-qty" className={QTY_CLASS}>{qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty((q) => Math.min(line.qty, q + 1))}
                      aria-label="Increase quantity"
                      className={cn(STEP_CLASS, BRAND_PRESS_CLASS)}
                    >+</button>
                  </div>
                </div>
              )}

              {wouldEmptyTab && (
                <p data-ui="void-guard" className={GUARD_CLASS}>
                  This would empty the tab — a tab must keep at least one item. Ask
                  an admin to cancel the order instead.
                </p>
              )}

              <div data-ui="void-reason-field" className={FIELD_CLASS}>
                <label htmlFor="void-reason" className={CAPTION_CLASS}>Reason (required)</label>
                <Input
                  id="void-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. wrong item fired, guest changed mind"
                  maxLength={ORDER_REASON_MAX_LEN}
                  autoComplete="off"
                  className={FIELD_INPUT_CLASS}
                />
              </div>
            </div>

            <div data-ui="void-foot" className={FOOT_CLASS}>
              <button
                type="button"
                data-ui="void-confirm"
                disabled={!canConfirm}
                onClick={confirm}
                className={cn(VOID_CLASS, BRAND_PRESS_CLASS)}
              >
                Void {qty > 1 ? `${qty} × ` : ""}item
              </button>
              <DialogPrimitive.Close data-ui="void-cancel" className={cn(CANCEL_CLASS, BRAND_PRESS_CLASS)}>Cancel</DialogPrimitive.Close>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
