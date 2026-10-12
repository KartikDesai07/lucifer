"use client";

import { Ban } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CartLine, CartSection } from "@/components/pos/CartLine";
import type { CartItem } from "@/hooks/use-cart";

// The cart's locked "Sent to kitchen" group (lines already fired on a resumed
// tab) with the Void an item action, split out of Cart.tsx (S5a,
// behaviour-preserving move) so that file stops growing. Renders nothing when
// no line has been fired.
export function CartSentSection({
  fired,
  resuming,
  onVoidItem,
  isBusy,
}: {
  fired: CartItem[];
  resuming: boolean;
  onVoidItem?: () => void;
  isBusy?: boolean;
}) {
  if (fired.length === 0) return null;
  return (
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
  );
}
