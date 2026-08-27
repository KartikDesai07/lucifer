"use client";

import { useCallback, useMemo, useState } from "react";
import { effectiveUnitPrice } from "@pos/shared/public";
import type { OrderItem, OrderItemInput, Product } from "@/types";

export interface CartItem {
  lineId: string; // stable key: product + modifiers + instructions + variation (+ index for fired lines)
  productId: string;
  name: string;
  price: number; // effective unit price after the product's % discount
  qty: number;
  // The variation this line is sold as (Small/Large…), snapshotted by name —
  // `price` above is already that variation's price. Absent for a product
  // sold one way only.
  variation?: string;
  modifiers: string[];
  instructions: string;
  kotRound: number; // 0 = new/unfired (editable); >=1 = already fired (locked)
}

// Unit price after applying the product-level percentage discount, rounded to
// whole rupees (the cafe bills in whole INR — see inr() formatting). Delegates
// to @pos/shared/public's effectiveUnitPrice — the SAME formula the public
// order route prices a diner's cart with server-side (CR2.2) — so the two
// surfaces can never drift apart on how a discount is applied.
export function effectivePrice(product: Pick<Product, "price" | "discount">): number {
  return effectiveUnitPrice(product.price, product.discount ?? 0);
}

// Two cart lines merge only when product + modifiers + instructions + variation
// all match, so "Pizza (extra cheese)" stays separate from a plain "Pizza" and a
// Small stays separate from a Large of the same item. Existing arg order kept;
// variation is appended last so every existing call site only needs one new arg.
function lineKey(
  productId: string,
  modifiers: string[],
  instructions: string,
  variation?: string,
) {
  return [
    productId,
    [...modifiers].sort().join(","),
    instructions.trim(),
    variation ?? "",
  ].join("|");
}

// Seed a cart line from an order item when resuming an open tab. Already-fired
// items carry their round (>=1) so the UI can lock them; the index keeps the
// lineId unique even when the same product was fired in two different rounds
// (a plain lineKey would collide and break React keys).
//
// The index is PREFIXED, not suffixed: a locally-added unfired line's lineId
// (see addToCart below) always starts with the raw productId, which is a
// 24-char lowercase-hex ObjectId — it can never start with '#'. Leading with
// '#' makes a rebuilt line's id structurally unable to collide with a
// preserved unfired one, no matter what free-text ends up in instructions/
// modifiers (a trailing "#<n>" suffix could otherwise coincide with one built
// from different, shorter instructions text). This is what lets
// nextCartFromServerItems below mix the two kinds of lines in one array.
export function cartItemFromOrderItem(it: OrderItem, index: number): CartItem {
  return {
    lineId: `#${index}:${lineKey(it.productId, it.modifiers, it.instructions, it.variation)}`,
    productId: it.productId,
    name: it.name,
    price: it.price,
    qty: it.qty,
    variation: it.variation,
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
    variation: ci.variation,
    modifiers: ci.modifiers,
    instructions: ci.instructions,
  };
}

// Rebuilds the cart from the server's authoritative items after a fire or a
// void. `keepUnfired: true` additionally carries over any lines in
// `previousCart` that are still unfired (kotRound 0) and so exist ONLY
// locally — the void re-sync path needs this so a cashier's in-progress,
// not-yet-sent addition isn't wiped by the server's void-only order.
//
// The FIRE path must call this with `keepUnfired: false` (the default): there,
// the previously-unfired lines have just been sent and come back inside
// `serverItems` already, so carrying them over from `previousCart` too would
// duplicate them on the tab and double-bill the guest.
//
// Pure + exported so it's unit-testable without mounting the hook.
export function nextCartFromServerItems(
  serverItems: OrderItem[],
  previousCart: CartItem[],
  keepUnfired: boolean,
): CartItem[] {
  const rebuilt = serverItems.map((it, i) => cartItemFromOrderItem(it, i));
  if (!keepUnfired) return rebuilt;
  const preserved = previousCart.filter((ci) => ci.kotRound === 0);
  return [...rebuilt, ...preserved];
}

export interface UseCart {
  cart: CartItem[];
  count: number;
  subtotal: number;
  newCount: number; // qty across unfired (kotRound 0) lines
  addToCart: (
    product: Product,
    opts?: { modifiers?: string[]; instructions?: string; qty?: number; variation?: string },
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
    const variation = opts.variation;
    const key = lineKey(product._id, modifiers, instructions, variation);

    // The chosen variation's OWN price bills the line once variations exist —
    // the product's `price` is only the base/reference figure then. Fall back
    // to the product's price when the name doesn't match anything on the
    // product: ModifierModal can only ever offer a name the product actually
    // has, so this only guards a future caller passing a stale/bad name.
    const chosenVariation = variation
      ? product.variations?.find((v) => v.name === variation)
      : undefined;
    const price = chosenVariation
      ? effectivePrice({ price: chosenVariation.price, discount: product.discount })
      : effectivePrice(product);

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
          price,
          qty: addQty,
          variation,
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
