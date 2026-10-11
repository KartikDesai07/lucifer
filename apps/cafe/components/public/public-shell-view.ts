import {
  pickActiveOrder,
  pickLastOrder,
  pickOfferItems,
  pickPopularItems,
} from "@/components/public/public-home-data";
import { SHELL_DEFAULT_GST, type MenuSnapshot } from "@/components/public/public-shell-repeat";
import type { PastOrder } from "@/components/public/public-orders-grouping";

// How many top sellers Home's "Popular here" row shows — a phone-width
// scroller, never the whole list.
const POPULAR_ROW_LIMIT = 8;

// Everything the shell derives for Home / Orders from the resolved order list
// and the menu snapshot — pure, so the shell stays under its line budget.
export function shellHomeView(orders: PastOrder[] | null, snapshot: MenuSnapshot | null) {
  return {
    activeOrder: orders ? pickActiveOrder(orders) : null,
    lastOrder: orders ? pickLastOrder(orders) : null,
    popularItems: pickPopularItems(snapshot?.items, snapshot?.popular, POPULAR_ROW_LIMIT),
    offerItems: pickOfferItems(snapshot?.items),
    // Seeded with the SAME default shape PublicOrderFlow uses — a pre-load bill
    // must never invent tax.
    gst: snapshot?.gst ?? SHELL_DEFAULT_GST,
    cafeName: snapshot?.restaurantName ?? "",
  };
}
