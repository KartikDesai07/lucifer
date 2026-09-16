import type { PublicOrderRequestStatusData } from "@pos/shared/public";

// S7 — pure data-shaping for the diner Home tab. No React, no fetch: the
// shell resolves each order-code row (code + resolved data | null) itself,
// this file only picks which ONE row the "Order again" card should show.

export interface HomeLastOrder {
  code: string;
  itemCount: number;
  total: number;
  createdAt: string;
  // Carried so the Home card can SAY what happened to this order. Without it
  // a REJECTED order still read as a plain "Order again" invitation, quietly
  // asking the diner to repeat one the cafe had just refused (review
  // 2026-09-13).
  status: PublicOrderRequestStatusData["status"];
}

interface HomeOrderRow {
  code: string;
  data: {
    itemCount: number;
    total: number;
    createdAt: string;
    status: PublicOrderRequestStatusData["status"];
  } | null;
}

// Picks the row with the NEWEST createdAt — never "first in the array": the
// array is in fetch-resolution order (whichever code's request settled
// first), not chronological order. Rows still resolving (data === null) are
// ignored rather than treated as "oldest". An unparseable createdAt sorts as
// -Infinity (never throws, never wins over a parseable date).
export function pickLastOrder(orders: ReadonlyArray<HomeOrderRow>): HomeLastOrder | null {
  let best: HomeLastOrder | null = null;
  let bestTime = -Infinity;

  for (const order of orders) {
    if (order.data === null) continue;
    const time = Date.parse(order.data.createdAt);
    const comparableTime = Number.isNaN(time) ? -Infinity : time;
    if (best !== null && comparableTime <= bestTime) continue;
    best = { code: order.code, ...order.data };
    bestTime = comparableTime;
  }

  return best;
}
