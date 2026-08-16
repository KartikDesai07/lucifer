"use client";

import { ShoppingCart, ChefHat, Ban, X } from "lucide-react";

import { inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/EmptyState";
import { CartLine, CartSection } from "@/components/pos/CartLine";
import { CartNotes } from "@/components/pos/CartNotes";
import type { CartItem } from "@/hooks/use-cart";

export type DiscountUnit = "₹" | "%";

export interface CartProps {
  items: CartItem[];
  subtotal: number;
  discount: number; // computed flat amount (for display)
  gstAmount?: number; // > 0 only when exclusive GST is enabled
  gstRate?: number;
  // The amount payable, taken from usePosTotals — NOT recomputed here. This
  // panel used to derive its own `subtotal - discount + gstAmount`, which is
  // how the table charge came to be printed as a row and then left out of the
  // very total beneath it. One figure, computed once, shown everywhere.
  total: number;
  discountRaw: number;
  discountUnit: DiscountUnit;
  onDiscountRawChange: (value: number) => void;
  onDiscountUnitChange: (unit: DiscountUnit) => void;
  // The selected table's extra charge for this bill. `chargeLabel` is the
  // cafe's own name for it — the product never supplies a default, so an
  // unnamed charge simply does not render. `onChargeChange` writes the
  // operator's deliberate override (0 = waived); `onChargeReset` puts the bill
  // back on whatever it is entitled to.
  charge: number;
  chargeLabel: string;
  entitledCharge: number;
  onChargeChange: (value: number) => void;
  onChargeReset: () => void;
  onUpdateQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
  onClear: () => void;
  // Order-level note for a brand-new sale — never shown while resuming (see
  // below), since a resumed tab's add-round payload carries no notes field.
  notes: string;
  onNotesChange: (value: string) => void;
  // Actions — which render depends on tab state (see below).
  onSendToKitchen?: () => void; // fire new items (creates a tab or adds a round)
  onPayNow?: () => void; // immediate full payment (new order only)
  onSettle?: () => void; // settle a resumed open tab
  onCloseTab?: () => void; // leave resume mode without settling
  onVoidItem?: () => void; // open the void dialog for an already-fired line
  // Resume context — present only when editing a live open tab.
  resumedOrderId?: string;
  nextRound?: number; // round number the next fire will create
  isBusy?: boolean; // disable actions while a mutation is in flight
  className?: string;
}

// Cart panel: line items with qty steppers, an amount-or-% discount field, and
// the running total. Discount is controlled by the parent so the panel can be
// mounted twice (desktop column + mobile sheet) without diverging. When resuming
// an open tab, already-fired lines render locked under a "Sent" group and new
// items under "New"; the action buttons switch between fire / pay / settle.
export function Cart({
  items,
  subtotal,
  discount,
  gstAmount = 0,
  gstRate,
  total,
  discountRaw,
  discountUnit,
  onDiscountRawChange,
  onDiscountUnitChange,
  charge,
  chargeLabel,
  entitledCharge,
  onChargeChange,
  onChargeReset,
  onUpdateQty,
  onRemove,
  onClear,
  notes,
  onNotesChange,
  onSendToKitchen,
  onPayNow,
  onSettle,
  onCloseTab,
  onVoidItem,
  resumedOrderId,
  nextRound,
  isBusy,
  className,
}: CartProps) {
  const resuming = !!resumedOrderId;
  const fired = items.filter((it) => it.kotRound > 0);
  const fresh = items.filter((it) => it.kotRound === 0);
  const hasNew = fresh.length > 0;

  return (
    <div className={cn("flex h-full flex-col rounded-lg border bg-card", className)}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <ShoppingCart className="h-4 w-4 shrink-0" />
          {resuming ? (
            <span className="truncate">Tab {resumedOrderId}</span>
          ) : (
            "Cart"
          )}
        </h2>
        {resuming ? (
          <Button variant="ghost" size="sm" onClick={onCloseTab} disabled={isBusy}>
            <X className="mr-1 h-3.5 w-3.5" /> Close
          </Button>
        ) : (
          items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          )
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <EmptyState
            className="h-full border-0"
            title="Cart is empty"
            description="Add items to start an order."
          />
        ) : (
          <div className="space-y-3">
            {fired.length > 0 && (
              <CartSection label="Sent to kitchen">
                {fired.map((item) => (
                  <CartLine key={item.lineId} item={item} locked />
                ))}
                {resuming && onVoidItem && (
                  <li>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-7 w-full justify-start text-muted-foreground hover:text-destructive"
                      onClick={onVoidItem}
                      disabled={isBusy}
                    >
                      <Ban className="mr-1.5 h-3.5 w-3.5" /> Void an item
                    </Button>
                  </li>
                )}
              </CartSection>
            )}
            {(hasNew || fired.length > 0) && (
              <CartSection label={fired.length > 0 ? "New items" : undefined}>
                {fresh.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    Add items to fire another round.
                  </p>
                ) : (
                  fresh.map((item) => (
                    <CartLine
                      key={item.lineId}
                      item={item}
                      onUpdateQty={onUpdateQty}
                      onRemove={onRemove}
                    />
                  ))
                )}
              </CartSection>
            )}
          </div>
        )}
      </div>

      {!resuming && <CartNotes value={notes} onChange={onNotesChange} />}

      <div className="space-y-2 border-t p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{inr(subtotal)}</span>
        </div>

        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Discount</span>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              value={discountRaw === 0 ? "" : discountRaw}
              onChange={(e) =>
                onDiscountRawChange(Math.max(0, Number(e.target.value) || 0))
              }
              placeholder="0"
              disabled={items.length === 0}
              className="h-8 w-20 text-right"
              aria-label="Discount value"
            />
            <div className="flex overflow-hidden rounded-md border">
              {(["₹", "%"] as DiscountUnit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => onDiscountUnitChange(u)}
                  className={cn(
                    "px-2 text-xs",
                    discountUnit === u
                      ? "bg-primary text-primary-foreground"
                      : "bg-background",
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </div>

        {discount > 0 && (
          <div className="flex items-center justify-between text-sm text-destructive">
            <span>Discount applied</span>
            <span>−{inr(discount)}</span>
          </div>
        )}

        {gstAmount > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{gstRate ? `GST @${gstRate}%` : "GST"}</span>
            <span>+{inr(gstAmount)}</span>
          </div>
        )}

        {/* The selected table's charge. Sits BELOW the GST line because that is
            where it lands in the arithmetic — it is added after tax, not taxed.
            Rendered only when the table actually names a charge, so the
            overwhelming majority of bills never see this row at all. */}
        {chargeLabel !== "" && (entitledCharge > 0 || charge > 0) && (
          <>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span
                className="min-w-0 flex-1 truncate text-muted-foreground"
                title={chargeLabel}
              >
                {chargeLabel}
              </span>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  value={charge === 0 ? "" : charge}
                  onChange={(e) =>
                    onChargeChange(Math.max(0, Number(e.target.value) || 0))
                  }
                  placeholder="0"
                  className="h-8 w-20 text-right"
                  aria-label={`${chargeLabel} amount`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => onChargeChange(0)}
                  disabled={charge === 0}
                  title={`Waive ${chargeLabel}`}
                  aria-label={`Waive ${chargeLabel}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Says out loud that this bill no longer matches the table's own
                setting, and offers the way back — otherwise a waiver made on
                the previous customer silently rides onto the next one. */}
            {charge !== entitledCharge && (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {charge === 0
                    ? `${chargeLabel} waived`
                    : `${chargeLabel} changed from ${inr(entitledCharge)}`}
                </span>
                <button
                  type="button"
                  onClick={onChargeReset}
                  className="shrink-0 underline underline-offset-2 hover:text-foreground"
                >
                  Undo
                </button>
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-between border-t pt-2 text-base font-bold">
          <span>Total</span>
          <span>{inr(total)}</span>
        </div>

        <CartActions
          resuming={resuming}
          hasNew={hasNew}
          nextRound={nextRound}
          disabled={items.length === 0 || isBusy}
          onSendToKitchen={onSendToKitchen}
          onPayNow={onPayNow}
          onSettle={onSettle}
        />
      </div>
    </div>
  );
}

// Primary + secondary CTAs, chosen by tab state (single dominant action each).
function CartActions({
  resuming,
  hasNew,
  nextRound,
  disabled,
  onSendToKitchen,
  onPayNow,
  onSettle,
}: {
  resuming: boolean;
  hasNew: boolean;
  nextRound?: number;
  disabled?: boolean;
  onSendToKitchen?: () => void;
  onPayNow?: () => void;
  onSettle?: () => void;
}) {
  if (resuming) {
    return (
      <div className="space-y-2">
        {hasNew && (
          <Button className="w-full" size="lg" disabled={disabled} onClick={onSendToKitchen}>
            <ChefHat className="mr-2 h-4 w-4" /> Send round {nextRound}
          </Button>
        )}
        {/* Settle is blocked while there are unsent items — otherwise they'd be
            dropped from both the bill and the kitchen. Send the round first. */}
        <Button
          className="w-full"
          size="lg"
          variant={hasNew ? "outline" : "default"}
          disabled={disabled || hasNew}
          onClick={onSettle}
        >
          Settle &amp; Pay
        </Button>
        {hasNew && (
          <p className="text-center text-xs text-muted-foreground">
            Send the new items to the kitchen before settling.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Button className="w-full" size="lg" disabled={disabled} onClick={onSendToKitchen}>
        <ChefHat className="mr-2 h-4 w-4" /> Send to Kitchen
      </Button>
      <Button
        className="w-full"
        size="lg"
        variant="outline"
        disabled={disabled}
        onClick={onPayNow}
      >
        Pay Now
      </Button>
    </div>
  );
}

