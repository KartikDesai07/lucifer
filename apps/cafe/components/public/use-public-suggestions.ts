import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api-client";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import type { CartLine } from "@/components/public/public-cart-store";

// S4 — a SECOND, independent fetch of /api/public/menu, same pattern as
// PublicOrderFlow's own table-charge fetch (onMenuData's contract is
// items/gst only, so this stays out of it rather than widening that
// callback).
interface PublicMenuPopularInfo {
  popular: string[];
}

// S4 — Baymard: relevance over padding, never backfilled.
const SUGGESTION_LIMIT = 3;

// Extracted from PublicOrderFlow.tsx (mechanical, ~300-line cap): owns the
// popular-items fetch and the pure derivation of what to suggest, so the
// component only consumes the finished list. Behavior-identical to the
// original inline effect/useMemo pair.
export function usePublicSuggestions(
  menuItems: PublicMenuProduct[] | null,
  cart: CartLine[],
): PublicMenuProduct[] {
  const [popularIds, setPopularIds] = useState<string[]>([]);

  // A failed/slow fetch leaves popularIds at its [] default — the
  // suggestions section already renders nothing for an empty list.
  useEffect(() => {
    let active = true;
    apiGet<PublicMenuPopularInfo>("/api/public/menu")
      .then((data) => {
        if (active) setPopularIds(data.popular);
      })
      .catch(() => {
        if (active) setPopularIds([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // Top sellers resolved against the LIVE menu (FIX4's freshness
  // discipline), narrowed to a no-variation item not already in the cart,
  // capped at SUGGESTION_LIMIT in the aggregation's own popularity order.
  return useMemo(() => {
    if (!menuItems) return [];
    const byId = new Map(menuItems.map((item) => [item.id, item]));
    const cartProductIds = new Set(cart.map((line) => line.productId));
    const picked: PublicMenuProduct[] = [];
    for (const id of popularIds) {
      const item = byId.get(id);
      if (!item) continue;
      if (item.available === false) continue;
      if (item.variations?.length) continue;
      if (cartProductIds.has(item.id)) continue;
      picked.push(item);
      if (picked.length === SUGGESTION_LIMIT) break;
    }
    return picked;
  }, [popularIds, menuItems, cart]);
}
