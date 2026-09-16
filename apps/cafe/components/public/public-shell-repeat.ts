import { toast } from "sonner";

import type { PublicGstConfig, PublicStatusItem } from "@pos/shared/public";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import { buildRepeatCart } from "@/components/public/public-cart-math";
import { readCart, writeCart, type CartLine } from "@/components/public/public-cart-store";

const MENU_ENDPOINT = "/api/public/menu";

// The default shape of the public menu payload's gst field before the shell's
// own fetch resolves — mirrors PublicOrderFlow's own DEFAULT_GST exactly (that
// component owns its own copy in its own state; this module cannot import it
// without reaching into a file that is already at this repo's file budget).
// A pre-load bill must never invent tax, so both copies stay { enabled:
// false, rate: 0, mode: "inclusive" } until a real fetch resolves.
export const SHELL_DEFAULT_GST: PublicGstConfig = { enabled: false, rate: 0, mode: "inclusive" };

interface PublicMenuFetchResult {
  items: PublicMenuProduct[];
  gst: PublicGstConfig;
}

// Extracted from PublicDinerShell.tsx (S12 — file budget). Narrowed to the
// TWO fields the shell has any business holding — `items` for
// buildRepeatCart's re-validation, `gst` for the Orders tab's bill view — not
// the whole /api/public/menu payload.
//
// The route is cached (max-age=30, swr=60) AND in-process, so calling this a
// second time (once for the repeat path, once to seed shell gst state) is
// almost always a cache hit, never a second real load.
async function fetchMenu(): Promise<PublicMenuFetchResult | null> {
  try {
    const res = await fetch(MENU_ENDPOINT);
    if (!res.ok) return null;
    const envelope = (await res.json().catch(() => null)) as
      | { success: true; data: { items: PublicMenuProduct[]; gst: PublicGstConfig } }
      | null;
    return envelope?.success ? { items: envelope.data.items, gst: envelope.data.gst } : null;
  } catch {
    return null;
  }
}

export async function fetchMenuGst(): Promise<PublicGstConfig | null> {
  const menu = await fetchMenu();
  return menu?.gst ?? null;
}

interface RepeatOrderResult {
  next: CartLine[];
  added: number;
  skipped: number;
}

// "Order this again": rebuild the cart from a past order, VALIDATED against
// the live menu (buildRepeatCart drops anything removed, hidden, sold out or
// whose variation is gone — a repeat must never re-add at a stale price),
// merge it onto whatever is already in the cart, and report what happened so
// the caller can persist + toast. Returns null when the menu could not be
// reached at all (a network hiccup, distinct from "nothing matched").
export async function repeatOrderCart(items: PublicStatusItem[]): Promise<RepeatOrderResult | null> {
  const menu = await fetchMenu();
  if (menu === null) return null;
  const { next, added, skipped } = buildRepeatCart(readCart(), items, menu.items);
  return { next, added, skipped };
}

// Persists the rebuilt cart and reports the outcome via toast — never
// silently short: a diner who sees 3 of 5 items must be told, or a trimmed
// repeat reads as a faithful one.
export function applyRepeatOrder(result: RepeatOrderResult): boolean {
  if (result.added === 0) {
    toast.error("Nothing from that order is available right now.");
    return false;
  }
  writeCart(result.next);
  toast.success(
    result.skipped > 0
      ? `Added ${result.added} ${result.added === 1 ? "item" : "items"} — ${result.skipped} not available today.`
      : `Added ${result.added} ${result.added === 1 ? "item" : "items"} to your cart.`,
  );
  return true;
}
