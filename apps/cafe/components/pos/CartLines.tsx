"use client";

import { useState, type MouseEvent } from "react";

import { POS_CART_LIST_CLASS } from "@/lib/pos-layout";
import { lineNumber, selectionHolds, voidLineOf, type LineSelection, type VoidLine } from "@/lib/pos-cart-view";
import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { CartLine } from "@/components/pos/CartLine";
import type { CartItem } from "@/hooks/use-cart";
import type { Order } from "@/types";

// The cart's lines in the owner's HTML (U1 Task 4; values 5.4, 5.7; design 6.6; owner Q10): sent lines first, then the
// new ones (each group in cart order), numbered 01, 02 …; the HTML's empty words when there is none. One line can be
// selected at a time; its action row offers "Remove" for a new line (today's remove) and "Void" for a sent line of a
// resumed tab (today's void dialog, opened on that line). The cart is mounted twice (the column and the sheet), so each
// mount keeps its own selection.

/** An action in the selected line's row (owner Q10, design 6.6): 12.5px 500 --link — our own control, so 44px tall
 *  (the global touch rule for controls the HTML has no element for). */
const ACTION_CLASS = "min-h-11 cursor-pointer bg-transparent p-0 text-[12.5px] font-medium text-link";

// A tap on the action row acts; it does not toggle the line's selection.
const keep = (e: MouseEvent) => e.stopPropagation();

export function CartLines({
  items,
  resumedOrder,
  isBusy = false,
  onUpdateQty,
  onRemove,
  onVoidItem,
}: {
  items: CartItem[];
  resumedOrder: Order | null;
  isBusy?: boolean;
  onUpdateQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
  // Opens the void dialog on the named sent line (null: the stored order no longer holds it; the dialog opens unpicked).
  onVoidItem?: (line: VoidLine | null) => void;
}) {
  const fired = items.filter((it) => it.kotRound > 0);
  const fresh = items.filter((it) => it.kotRound === 0);
  const lines = [...fired, ...fresh];

  // The selected line. A selection that no longer holds (its line went, another order is on screen, the cart turned busy
  // or frozen) is dropped while rendering, so it can never come back on an equal line added later.
  const scope = resumedOrder?._id ?? "new";
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const holds = selection !== null && selectionHolds(selection, { scope, busy: isBusy, lineIds: lines.map((l) => l.lineId) });
  if (selection !== null && !holds) setSelection(null);
  const selectedId = holds && selection ? selection.lineId : null;

  const toggle = (lineId: string) => {
    if (isBusy) return;
    setSelection(selectedId === lineId ? null : { lineId, scope });
  };

  const actionsFor = (item: CartItem) => {
    if (item.kotRound === 0) {
      return (
        <button
          type="button"
          className={cn(ACTION_CLASS, BRAND_PRESS_CLASS)}
          onClick={() => {
            setSelection(null);
            onRemove(item.lineId);
          }}
        >Remove</button>
      );
    }
    if (!resumedOrder || !onVoidItem) return null;
    return (
      <button
        type="button"
        className={cn(ACTION_CLASS, BRAND_PRESS_CLASS)}
        onClick={() => {
          setSelection(null);
          onVoidItem(voidLineOf(item, resumedOrder));
        }}
      >Void</button>
    );
  };

  return (
    <div data-ui="pos-cart-lines" className={POS_CART_LIST_CLASS}>
      {lines.length === 0 ? (
        <div data-ui="pos-cart-empty" className="flex h-full min-h-40 flex-col items-center justify-center gap-1 text-center">
          <p className="text-[15px] font-semibold">No items</p>
          <p className="text-[13px] text-muted-foreground">Tap a price on the menu to add an item.</p>
        </div>
      ) : (
        <>
          {lines.map((item, i) => {
            const action = item.lineId === selectedId ? actionsFor(item) : null;
            return (
              <CartLine
                key={item.lineId}
                item={item}
                number={lineNumber(i)}
                locked={item.kotRound > 0}
                selected={item.lineId === selectedId}
                disabled={isBusy}
                onToggle={toggle}
                onUpdateQty={onUpdateQty}
                actions={
                  action && (
                    <span data-ui="pos-line-actions" className="col-[2/4] -mb-2.5 flex items-center gap-4" onClick={keep}>
                      {action}
                    </span>
                  )
                }
              />
            );
          })}
          {/* A tab with nothing new: today's hint under its lines (13px --text-2, design 6.6), at the name column. */}
          {fired.length > 0 && fresh.length === 0 && (
            <p className="pt-1 pl-[34px] text-[13px] text-muted-foreground">Add items to fire another round.</p>
          )}
        </>
      )}
    </div>
  );
}
