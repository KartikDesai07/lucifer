"use client";

import type { MouseEvent, ReactNode } from "react";

import { inr, cn } from "@/lib/utils";
import { lineMeta } from "@/lib/pos-cart-view";
import { STATUS_CLASSES } from "@/lib/ui";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import type { CartItem } from "@/hooks/use-cart";

// One cart line in the owner's HTML (U1 Task 4; values 5.4 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 6.6; owner Q10): the two-digit number, the name over its meta (variation, add-ons, removals, the note), the
// stepper and the line total, then the status line. A sent line stays locked (today's rule): its "×qty" sits where the
// stepper would. Tapping the line (not its stepper) selects it; the selected line wears the accent look and shows the
// action row CartLines hands it.

/** The line (values 5.4): a 24px number column, the name column and the controls, 3px 10px apart; 10px 8px padding the
 *  -8px side margin pulls back to the wrapper's edge; radius 10; the HTML's lineIn as it arrives. */
const LINE_CLASS = "-mx-2 grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-[3px] rounded-[10px] px-2 py-2.5 motion-safe:animate-html-line-in";
/** Selected (values 5.4, owner Q10): --accent-t under an inset 1px --accent-b ring. */
const SELECTED_CLASS = "bg-accent [box-shadow:inset_0_0_0_1px_var(--accent-b)]";
/** The name column: the keyboard's way to select the line (its click reaches the line), heard as pressed while the
 *  line is selected (the action row is not a popup); no look of its own. */
const NAME_CLASS = "min-w-0 cursor-pointer bg-transparent p-0 text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** The stepper box (values 5.4, 0.3 stepBox): 1px --border, radius 8, --surface; 36px tall, 30px in the cart column
 *  from 1280px (ruling P48: below 1280px the cart is the full-screen sheet, the mobile style, owner Q20). */
const STEPPER_CLASS = "flex h-9 items-center rounded-[8px] border border-border bg-card xl:h-[30px]";
/** A stepper button (values 5.4, 0.3 stepW/stepH, 0.5): 38x34, 30x28 in the column from 1280px (ruling P48); the UA's
 *  1px 6px padding; a 16px glyph in --text; hover --surface-2. Locked while busy. */
const STEP_BUTTON_CLASS = "h-[34px] w-[38px] cursor-pointer bg-transparent px-1.5 py-px text-[16px] text-foreground not-disabled:hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 xl:h-7 xl:w-[30px]";

// values 5.4 status: sent → --ok dot, --text-2; not sent → --warn dot, --warn-i (the theme's status set, lib/ui).
const STATUS = {
  sent: { text: "Sent to kitchen", dot: STATUS_CLASSES.ok.dot, color: "text-muted-foreground" },
  fresh: { text: "New · not sent", dot: STATUS_CLASSES.warn.dot, color: STATUS_CLASSES.warn.ink },
} as const;

// A tap on the stepper changes the quantity only; it does not select the line.
const keep = (e: MouseEvent) => e.stopPropagation();

export function CartLine({
  item,
  number,
  locked,
  selected,
  disabled,
  onToggle,
  onUpdateQty,
  actions,
}: {
  item: CartItem;
  number: string;
  // Sent to the kitchen: no stepper (a sent line changes only through a void).
  locked: boolean;
  selected: boolean;
  // A write is in flight or a send is unconfirmed: the stepper locks and the line does not select.
  disabled?: boolean;
  onToggle: (lineId: string) => void;
  onUpdateQty: (lineId: string, qty: number) => void;
  // The selected line's action row (Remove / Void), from CartLines.
  actions?: ReactNode;
}) {
  const status = locked ? STATUS.sent : STATUS.fresh;
  return (
    <div
      data-ui="pos-cart-line"
      className={cn(LINE_CLASS, selected && SELECTED_CLASS)}
      onClick={disabled ? undefined : () => onToggle(item.lineId)}
    >
      <span className="font-mono text-[12px] text-subtle-foreground">{number}</span>
      <button type="button" data-ui="pos-line-name" className={NAME_CLASS} aria-pressed={selected}>
        <span className="block truncate text-[14px] font-medium">{item.name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{lineMeta(item)}</span>
      </button>
      <span className="flex items-center gap-2.5">
        {locked ? (
          // In the stepper box's height, so a sent line stands as tall as a new one (values 5.4: 72px in the column,
          // 74px in the sheet; ruling P48).
          <span data-ui="pos-line-qty" className="flex h-9 items-center text-[13px] font-semibold text-muted-foreground xl:h-[30px]">
            ×{item.qty}
          </span>
        ) : (
          <span data-ui="pos-line-stepper" className={STEPPER_CLASS} onClick={keep}>
            <button
              type="button"
              title="Remove one"
              aria-label="Decrease quantity"
              disabled={disabled}
              onClick={() => onUpdateQty(item.lineId, item.qty - 1)}
              className={cn(STEP_BUTTON_CLASS, BRAND_PRESS_CLASS, "rounded-l-[7px]")}
            >−</button>
            <span className="min-w-[22px] text-center text-[13px] font-semibold">{item.qty}</span>
            <button
              type="button"
              title="Add one"
              aria-label="Increase quantity"
              disabled={disabled}
              onClick={() => onUpdateQty(item.lineId, item.qty + 1)}
              className={cn(STEP_BUTTON_CLASS, BRAND_PRESS_CLASS, "rounded-r-[7px]")}
            >+</button>
          </span>
        )}
        <span className="min-w-[54px] text-right text-[14px] font-medium">{inr(item.price * item.qty)}</span>
      </span>
      <span />
      <span className={cn("col-[2/4] flex items-center gap-1.5 text-[11.5px]", status.color)}>
        <span className={cn("size-1.5 rounded-[50%]", status.dot)} />
        {status.text}
      </span>
      {selected && actions}
    </div>
  );
}
