"use client";

import { useCallback, useMemo, useState } from "react";
import type { OrderItem, OrderItemInput, Product } from "@/types";

export interface CartItem {
  lineId: string; // stable key: product + modifiers + instructions (+ index for fired lines)
  productId: string;
  name: string;
  price: number; // effective unit price after the product's % discount
  qty: number;
  modifiers: string[];
  instructions: string;
  kotRound: number; // 0 = new/unfired (editable); >=1 = already fired (locked)
}

// Unit price after applying the product-level percentage discount, rounded to
// whole rupees (the cafe bills in whole INR — see inr() formatting).
export function effectivePrice(product: Pick<Product, "price" | "discount">): number {
  const off = (product.price * (product.discount ?? 0)) / 100;
  return Math.max(0, Math.round(product.price - off));
}

// Two cart lines merge only when product + modifiers + instructions all match,
// so "Pizza (extra cheese)" stays separate from a plain "Pizza".
function lineKey(productId: string, modifiers: string[], instructions: string) {
  return [productId, [...modifiers].sort().join(","), instructions.trim()].join("|");
}

// Seed a cart line from an order item when resuming an open tab. Already-fired
// items carry their round (>=1) so the UI can lock them; the index keeps the
// lineId unique even when the same product was fired in two different rounds
// (a plain lineKey would collide and break React keys).
export function cartItemFromOrderItem(it: OrderItem, index: number): CartItem {
  return {
    lineId: `${lineKey(it.productId, it.modifiers, it.instructions)}#${index}`,
    productId: it.productId,
    name: it.name,
    price: it.price,
    qty: it.qty,
    modifiers: it.modifiers,
    instructions: it.instructions,
    kotRound: it.kotRound,
  };
}

// Map a cart line to the order-item input the API expects (drops lineId/kotRound —
// the server stamps the round). Inverse of cartItemFromOrderItem.
export function cartItemToInput(ci: CartItem): OrderItemInput {
  return {
    productId: ci.productId,
    name: ci.name,
    price: ci.price,
    qty: ci.qty,
    modifiers: ci.modifiers,
    instructions: ci.instructions,
  };
}

export interface UseCart {
  cart: CartItem[];
  count: number;
  subtotal: number;
  newCount: number; // qty across unfired (kotRound 0) lines
  addToCart: (
    product: Product,
    opts?: { modifiers?: string[]; instructions?: string; qty?: number },
  ) => void;
  updateQty: (lineId: string, qty: number) => void;
  removeFromCart: (lineId: string) => void;
  clearCart: () => void;
  hydrate: (items: CartItem[]) => void; // replace the cart wholesale (resume a tab)
}

export function useCart(): UseCart {
  const [cart, setCart] = useState<CartItem[]>([]);

  const addToCart = useCallback<UseCart["addToCart"]>((product, opts = {}) => {
    const modifiers = opts.modifiers ?? [];
    const instructions = opts.instructions ?? "";
    const addQty = opts.qty ?? 1;
    const key = lineKey(product._id, modifiers, instructions);

    setCart((prev) => {
      // Only fold into an UNFIRED matching line — a fired line is locked, so a new
      // add of the same product becomes a fresh line (it belongs to the next round).
      const idx = prev.findIndex(
        (ci) => ci.lineId === key && ci.kotRound === 0,
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + addQty };
        return next;
      }
      return [
        ...prev,
        {
          lineId: key,
          productId: product._id,
          name: product.name,
          price: effectivePrice(product),
          qty: addQty,
          modifiers,
          instructions,
          kotRound: 0,
        },
      ];
    });
  }, []);

  // Qty/remove only ever act on unfired lines — fired lines are locked (already
  // sent to the kitchen). The UI also disables their controls.
  const updateQty = useCallback<UseCart["updateQty"]>((lineId, qty) => {
    setCart((prev) =>
      qty <= 0
        ? prev.filter((ci) => !(ci.lineId === lineId && ci.kotRound === 0))
        : prev.map((ci) =>
            ci.lineId === lineId && ci.kotRound === 0 ? { ...ci, qty } : ci,
          ),
    );
  }, []);

  const removeFromCart = useCallback<UseCart["removeFromCart"]>((lineId) => {
    setCart((prev) =>
      prev.filter((ci) => !(ci.lineId === lineId && ci.kotRound === 0)),
    );
  }, []);

  const clearCart = useCallback(() => setCart([]), []);
  const hydrate = useCallback<UseCart["hydrate"]>((items) => setCart(items), []);

  const subtotal = useMemo(
    () => cart.reduce((sum, ci) => sum + ci.price * ci.qty, 0),
    [cart],
  );
  const count = useMemo(
    () => cart.reduce((sum, ci) => sum + ci.qty, 0),
    [cart],
  );
  const newCount = useMemo(
    () => cart.reduce((sum, ci) => (ci.kotRound === 0 ? sum + ci.qty : sum), 0),
    [cart],
  );

  return {
    cart,
    count,
    subtotal,
    newCount,
    addToCart,
    updateQty,
    removeFromCart,
    clearCart,
    hydrate,
  };
}
