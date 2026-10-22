"use client";

import { useEffect, useId, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { effectivePrice } from "@/hooks/use-cart";
import { inr, cn } from "@/lib/utils";
import { initialSelected, pickModifierResult, modifiersPreselectedFor } from "@/lib/modifier-picker";
import {
  SHEET_FIELD_CLASS,
  SHEET_PANEL_BASE,
  SHEET_PANEL_CAP_CLASS,
  SHEET_QTY_CLASS,
  SHEET_SCRIM_BASE,
  SHEET_STEP_CLASS,
  SHEET_STEPPER_CLASS,
} from "@/lib/sheet-frame";
import { useOpenerFocus } from "@/hooks/use-opener-focus";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { Input } from "@/components/ui/input";
import type { Product } from "@/types";

export interface AddToCartOpts {
  modifiers: string[];
  // "Modifiers come ticked" (reverse mode) — the modifiers the operator
  // UNticked, so the kitchen knows what NOT to add. Omitted whenever nothing
  // was unticked, or the product isn't in reverse mode.
  removedModifiers?: string[];
  instructions: string;
  qty: number;
  // The variation name the operator picked, required (below) whenever the
  // product carries any — absent for a product sold one way only.
  variation?: string;
}

interface ModifierModalProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (product: Product, opts: AddToCartOpts) => void;
}

// The item options modal in the owner's HTML (U1 Task 8; values 10 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 6.10; owner Q1): the name and "✕"; "Size" = our variations (required, none lit until tapped; a plain product
// has no Size block); "Add-ons" = our modifiers as the HTML's check rows (plain labels: no price column); "Kitchen note"
// = our free-text instructions in the HTML's 48px field (its quick chips need data we do not have); the stepper and
// "Add to order · ₹x". Opened by a card's name (any product) and by a "Choose" price button (more than three sizes). A
// Radix dialog: focus trap, Escape and the scrim close it, the title is the name, the description is read out only (the
// HTML shows none). Modifiers carry no price, so the line total is the chosen size's (or the product's) price × qty.

// The frame is the HTML's shared sheet frame (lib/sheet-frame.ts, ruling P54). The scrim (values 10.1, 0.3
// sheetAlign/sheetPad) over everything at z-index 20 (the phone's tab bar too). The panel (values 10.1, 0.3 sheetRadius)
// 440px on --surface, no border, sheetIn .34s. The HTML's panel has no height cap (its items have at most four add-ons);
// ours takes the HTML's sheet cap (customer sheet csMaxH) so an item with many options scrolls in the body and "Add to
// order" stays on screen.
const SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-20");
const PANEL_CLASS = cn(SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, "max-w-[440px] overflow-hidden motion-safe:animate-sheet-in");
// The head (values 10.1): 16px 18px, gap 10, a --border-2 rule; the name 17px 600 -.01em (no veg mark: owner Q7), a long
// unbroken operator-typed name (CR1.1) wrapping inside the head so the "✕" stays in the panel; the "✕" a 28px round
// --surface-3 button, 12px --text-2 (buttons the HTML leaves unpadded keep the UA's 1px 6px).
const HEAD_CLASS = "flex flex-none items-center gap-2.5 border-b border-border-2 px-[18px] py-4";
const NAME_CLASS = "min-w-0 flex-1 break-words text-[17px] font-semibold tracking-[-0.01em]";
const CLOSE_CLASS = "size-7 cursor-pointer rounded-[50%] border-0 bg-surface-3 px-1.5 py-px text-[12px] text-muted-foreground";
// The body (values 10.1): 16px 18px, the blocks 18px apart; each block a 12px 600 --text-2 caption 8px above its control.
const BODY_CLASS = "flex min-h-0 flex-col gap-[18px] overflow-y-auto px-[18px] py-4";
const BLOCK_CLASS = "flex flex-col gap-2";
const CAPTION_CLASS = "text-[12px] font-semibold text-muted-foreground";
const HINT_CLASS = "text-[12px] text-muted-foreground";
// Size (values 10.1-10.2): a --surface-3 track, radius 8, 2px inset and gap, one column per size (three a row at most:
// the HTML's widest; our items carry up to 20 sizes); a 44px segment, radius 6, line-height 1.2: the full name 12px
// --text-2 over the price 14px 600; the picked one SEG_ON (U0 values 1.6), the others SEG_OFF.
const SIZE_COLUMNS_MAX = 3;
const SIZES_CLASS = "grid gap-0.5 rounded-[8px] bg-surface-3 p-0.5";
const SIZE_CLASS =
  "flex h-11 min-w-0 cursor-pointer flex-col items-center justify-center rounded-[6px] border-0 px-1.5 py-px leading-[1.2] text-foreground";
const SIZE_ON_CLASS = "bg-seg [box-shadow:var(--seg-sh)]";
const SIZE_OFF_CLASS = "bg-transparent";
const SIZE_LABEL_CLASS = "max-w-full truncate text-[12px] text-muted-foreground";
const SIZE_PRICE_CLASS = "text-[14px] font-semibold";
// Add-ons (values 10.1-10.2): a 1px --border list, radius 10; 42px rows, 0 12px, gap 10, 14px, a --border-2 rule under
// each (the last too), hover --hover; the 18px box, radius 5, a 1.5px rule: --accent box and fill with the white check
// when on, a --text-3 box on --surface when off.
const ADDON_LIST_CLASS = "overflow-hidden rounded-[10px] border border-border";
const ADDON_CLASS =
  "flex h-[42px] w-full cursor-pointer items-center gap-2.5 border-b border-border-2 bg-card px-3 text-left text-[14px] text-foreground hover:bg-hover";
const CHECK_CLASS =
  "flex size-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] text-[11px] text-primary-foreground";
const CHECK_ON_CLASS = "border-primary bg-primary";
const CHECK_OFF_CLASS = "border-subtle-foreground bg-card";
// Kitchen note: the HTML's shared 48px field (values 8.3, the customer sheet's: SHEET_FIELD_CLASS, on the kit Input).
// The footer (values 10.1): 14px 18px 18px, gap 10, a --border-2 rule; the shared 46px stepper (SHEET_STEPPER_CLASS and
// its parts); "Add to order" 46px on --accent, radius 10, 15px 600, hover --accent-h; disabled while no size is picked
// (the HTML's not-allowed cursor, at .5). Below 720px the panel sits on the window's foot, so the 18px grows by the
// bottom safe-area inset there (ruling P49; 18px at inset 0).
const FOOT_CLASS =
  "flex flex-none items-center gap-2.5 border-t border-border-2 px-[18px] pt-3.5 pb-[18px] max-tab:pb-[calc(18px+env(safe-area-inset-bottom))]";
const ADD_CLASS =
  "h-[46px] flex-1 cursor-pointer rounded-[10px] border-0 bg-primary px-1.5 py-px text-[15px] font-semibold text-primary-foreground not-disabled:hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";

export function ModifierModal({
  product,
  open,
  onOpenChange,
  onConfirm,
}: ModifierModalProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [qty, setQty] = useState(1);
  // Undefined = nothing picked yet. A variation item has no meaningful
  // default (Small vs Large) — seeding this with variations[0] would let the
  // confirm button fire right away and silently bill the cheapest size, so it
  // starts empty and confirm stays disabled below until the operator taps one.
  const [variation, setVariation] = useState<string | undefined>(undefined);
  // The captions name their groups for screen readers (the HTML's captions are plain text).
  const sizeId = useId();
  const addonsId = useId();
  const hintId = useId();
  // On open the panel itself takes the focus (the dialog is announced by its name; Tab then reaches "✕" and the
  // options): no ring lands on "✕" and no phone keyboard pops up for the note field. The page opens the modal from its
  // state, so Radix has no trigger to give the focus back to and would drop it on <body>; it goes back to the opener
  // (the card's name or "Choose" button). The shared hook, as the payment, void and table sheets (ruling P22).
  const openerFocus = useOpenerFocus();

  // Reset the form each time a new product is opened. A reverse-mode product
  // (modifiers come ticked) starts every modifier ticked; normal mode starts
  // with none, same as always.
  useEffect(() => {
    if (open && product) {
      setSelected(initialSelected(product));
      setInstructions("");
      setQty(1);
      setVariation(undefined);
    }
  }, [open, product]);

  if (!product) return null;

  const reverseMode = modifiersPreselectedFor(product);

  const hasVariations = (product.variations?.length ?? 0) > 0;
  const chosenVariation = variation
    ? product.variations?.find((v) => v.name === variation)
    : undefined;
  // Before a size is picked there is no unit price to show — falling back to
  // the base `price` here would look exactly like the silent default this
  // modal must not offer, so it stays `null` until a variation is chosen.
  const unit = chosenVariation
    ? effectivePrice({ price: chosenVariation.price, discount: product.discount })
    : hasVariations
      ? null
      : effectivePrice(product);
  const confirmDisabled = hasVariations && !variation;

  const toggle = (modifier: string, checked: boolean) => {
    setSelected((prev) =>
      checked ? [...prev, modifier] : prev.filter((m) => m !== modifier),
    );
  };

  const confirm = () => {
    onConfirm(product, {
      ...pickModifierResult(product, selected),
      instructions: instructions.trim(),
      qty,
      variation,
    });
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="pos-item-options" className={SCRIM_CLASS}>
          <DialogPrimitive.Content
            data-ui="pos-item-options-panel"
            {...openerFocus}
            className={PANEL_CLASS}
          >
            <div data-ui="pos-item-options-head" className={HEAD_CLASS}>
              <DialogPrimitive.Title className={NAME_CLASS}>{product.name}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                {unit === null
                  ? "Pick a variation to continue."
                  : `${inr(unit)} each — choose add-ons and quantity.`}
              </DialogPrimitive.Description>
              <DialogPrimitive.Close
                data-ui="pos-item-options-close"
                aria-label="Close"
                className={cn(CLOSE_CLASS, BRAND_PRESS_CLASS)}
              >✕</DialogPrimitive.Close>
            </div>

            <div data-ui="pos-item-options-body" className={BODY_CLASS}>
              {hasVariations && (
                <div data-ui="pos-item-size" role="group" aria-labelledby={sizeId} className={BLOCK_CLASS}>
                  <span id={sizeId} className={CAPTION_CLASS}>Size</span>
                  <div
                    data-ui="pos-item-sizes"
                    className={SIZES_CLASS}
                    style={{ gridTemplateColumns: `repeat(${Math.min(product.variations!.length, SIZE_COLUMNS_MAX)}, minmax(0, 1fr))` }}
                  >
                    {product.variations!.map((v) => {
                      const active = v.name === variation;
                      const price = effectivePrice({ price: v.price, discount: product.discount });
                      return (
                        <button
                          key={v.name}
                          type="button"
                          data-ui="pos-item-size-button"
                          aria-pressed={active}
                          onClick={() => setVariation(v.name)}
                          className={cn(SIZE_CLASS, active ? SIZE_ON_CLASS : SIZE_OFF_CLASS, BRAND_PRESS_CLASS)}
                        >
                          {/* Names are operator-typed (CR1.1): one cut by the segment's width stays readable on hover. */}
                          <span title={v.name} className={SIZE_LABEL_CLASS}>{v.name}</span>
                          <span className={SIZE_PRICE_CLASS}>{inr(price)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {product.modifiers.length > 0 && (
                <div
                  data-ui="pos-item-addons"
                  role="group"
                  aria-labelledby={addonsId}
                  aria-describedby={reverseMode ? hintId : undefined}
                  className={BLOCK_CLASS}
                >
                  <span id={addonsId} className={CAPTION_CLASS}>Add-ons</span>
                  {reverseMode && (
                    <span id={hintId} className={HINT_CLASS}>
                      Untick what the customer does not want.
                    </span>
                  )}
                  <div data-ui="pos-item-addon-list" className={ADDON_LIST_CLASS}>
                    {product.modifiers.map((modifier) => {
                      const on = selected.includes(modifier);
                      return (
                        <button
                          key={modifier}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          data-ui="pos-item-addon"
                          onClick={() => toggle(modifier, !on)}
                          className={cn(ADDON_CLASS, BRAND_PRESS_CLASS)}
                        >
                          <span aria-hidden="true" data-ui="pos-item-check" className={cn(CHECK_CLASS, on ? CHECK_ON_CLASS : CHECK_OFF_CLASS)}>
                            {on ? "✓" : ""}
                          </span>
                          <span title={modifier} className="min-w-0 flex-1 truncate">{modifier}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div data-ui="pos-item-note" className={BLOCK_CLASS}>
                <label htmlFor="item-instructions" className={CAPTION_CLASS}>Kitchen note</label>
                <Input
                  id="item-instructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. less spicy, no onions"
                  autoComplete="off"
                  className={SHEET_FIELD_CLASS}
                />
              </div>
            </div>

            <div data-ui="pos-item-options-foot" className={FOOT_CLASS}>
              <div data-ui="pos-item-stepper" role="group" aria-label="Quantity" className={SHEET_STEPPER_CLASS}>
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className={cn(SHEET_STEP_CLASS, BRAND_PRESS_CLASS)}
                >−</button>
                <span data-ui="pos-item-qty" className={SHEET_QTY_CLASS}>{qty}</span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setQty((q) => q + 1)}
                  className={cn(SHEET_STEP_CLASS, BRAND_PRESS_CLASS)}
                >+</button>
              </div>
              <button
                type="button"
                data-ui="pos-item-add"
                onClick={confirm}
                disabled={confirmDisabled}
                className={cn(ADD_CLASS, BRAND_PRESS_CLASS)}
              >
                {unit === null ? "Pick a variation" : `Add to order · ${inr(unit * qty)}`}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
