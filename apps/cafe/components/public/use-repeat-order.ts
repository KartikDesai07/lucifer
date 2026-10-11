"use client";

import { toast } from "sonner";

import type { PublicStatusItem } from "@pos/shared/public";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import { applyRepeatOrder, repeatOrderCart } from "@/components/public/public-shell-repeat";

// "Order this again" / Home quick add: rebuild the cart from past lines,
// VALIDATED against the live menu (repeatOrderCart drops anything removed,
// hidden, sold out or whose variation is gone — never a stale price), merge
// onto the current cart, persist, and tell the diner what happened.
// `onApplied` runs only when the merge really wrote to the cart — the shell
// uses it to remount the menu, refresh the badge and switch to the Menu tab.
export function useRepeatOrder(onApplied: () => void) {
  async function repeatOrder(items: PublicStatusItem[]) {
    const result = await repeatOrderCart(items);
    if (result === null) {
      toast.error("Couldn't reach the menu — please try again.");
      return;
    }
    if (!applyRepeatOrder(result)) return;
    onApplied();
  }

  // Home's one-tap add rides the SAME validated path — priced from the LIVE
  // menu by buildRepeatCart, never from the snapshot. Simple items only.
  function quickAdd(product: PublicMenuProduct) {
    void repeatOrder([{ productId: product.id, name: product.name, price: product.price, qty: 1, modifiers: [] }]);
  }

  return { repeatOrder, quickAdd };
}
