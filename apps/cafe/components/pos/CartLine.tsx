"use client";

import type { ReactNode } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";

import { inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CartItem } from "@/hooks/use-cart";

// A labelled group of cart lines ("Sent to kitchen" / "New items").
export function CartSection({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div>
      {label && (
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      )}
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

// One cart line. `locked` lines (already fired to the kitchen) show their qty
// statically with no steppers or remove; unfired lines are fully editable.
export function CartLine({
  item,
  locked,
  onUpdateQty,
  onRemove,
}: {
  item: CartItem;
  locked?: boolean;
  onUpdateQty?: (lineId: string, qty: number) => void;
  onRemove?: (lineId: string) => void;
}) {
  return (
    <li className={cn("rounded-md p-2", locked ? "opacity-70" : "hover:bg-muted/50")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.name}</p>
          {item.modifiers.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">
              {item.modifiers.join(", ")}
            </p>
          )}
          {item.instructions && (
            <p className="truncate text-xs italic text-muted-foreground">
              {item.instructions}
            </p>
          )}
        </div>
        <span className="shrink-0 text-sm font-semibold">
          {inr(item.price * item.qty)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        {locked ? (
          <span className="text-xs text-muted-foreground">×{item.qty} · sent</span>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onUpdateQty?.(item.lineId, item.qty - 1)}
              aria-label="Decrease quantity"
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-7 text-center text-sm">{item.qty}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onUpdateQty?.(item.lineId, item.qty + 1)}
              aria-label="Increase quantity"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        )}
        {!locked && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove?.(item.lineId)}
            aria-label={`Remove ${item.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}
