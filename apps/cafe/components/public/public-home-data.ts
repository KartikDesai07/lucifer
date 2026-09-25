import type { PublicOrderRequestStatusData } from "@pos/shared/public";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import { isActiveOrderStatus } from "@/components/public/PublicStatusChip";

// S7 / CB-6C — pure data-shaping for the diner Home tab. No React, no fetch:
// the shell resolves each order-code row (code + resolved data | null) through
// useMyOrders and holds the menu snapshot; this file only PICKS what Home
// shows — which past order the "Order again" card offers, which order is
// still live for the active-order card, which items the popular row lists.

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

// Parses createdAt for ordering; an unparseable value sorts as -Infinity
// (never throws, never wins over a parseable date).
function comparableTime(createdAt: string): number {
  const time = Date.parse(createdAt);
  return Number.isNaN(time) ? -Infinity : time;
}

// Picks the row with the NEWEST createdAt — never "first in the array": the
// array is in fetch-resolution order (whichever code's request settled
// first), not chronological order. Rows still resolving (data === null) are
// ignored rather than treated as "oldest".
export function pickLastOrder(orders: ReadonlyArray<HomeOrderRow>): HomeLastOrder | null {
  let best: HomeLastOrder | null = null;
  let bestTime = -Infinity;

  for (const order of orders) {
    if (order.data === null) continue;
    const time = comparableTime(order.data.createdAt);
    if (best !== null && time <= bestTime) continue;
    best = { code: order.code, ...order.data };
    bestTime = time;
  }

  return best;
}

// ── CB-6C additions ────────────────────────────────────────────────────────

// The one order the counter can still act on, for Home's "alive" card.
export interface HomeActiveOrder {
  code: string;
  status: "pending" | "accepting";
  itemCount: number;
  total: number;
  itemLines: { name: string; qty: number }[];
  createdAt: string;
}

interface ResolvedOrderRow {
  code: string;
  data: PublicOrderRequestStatusData | null;
}

// CB-6D-B — every pending/accepting resolved row, sorted newest first (for
// the Orders tab's "Live now" section, which can show more than one). Ties
// keep the FIRST seen: a stable sort, since Array.prototype.sort is stable
// and the comparator only breaks ties when times actually differ.
export function pickActiveOrders(orders: ReadonlyArray<ResolvedOrderRow>): HomeActiveOrder[] {
  const active: HomeActiveOrder[] = [];

  for (const order of orders) {
    const data = order.data;
    if (data === null || !isActiveOrderStatus(data.status)) continue;
    active.push({
      code: order.code,
      status: data.status,
      itemCount: data.itemCount,
      total: data.total,
      itemLines: data.items.map((item) => ({ name: item.name, qty: item.qty })),
      createdAt: data.createdAt,
    });
  }

  active.sort((a, b) => comparableTime(b.createdAt) - comparableTime(a.createdAt));
  return active;
}

// Newest pending/accepting order, or null — delegates to pickActiveOrders so
// there is one home for the "which orders are active" filter+sort logic.
export function pickActiveOrder(orders: ReadonlyArray<ResolvedOrderRow>): HomeActiveOrder | null {
  return pickActiveOrders(orders)[0] ?? null;
}

// Time-of-day greeting from the LOCAL hour (0-23). Boundaries are the common
// English ones: morning until noon, afternoon until 5pm, evening otherwise
// (including the small hours — a cafe open at 1am is still "this evening").
export const GREETING_MORNING_FROM_HOUR = 5;
export const GREETING_AFTERNOON_FROM_HOUR = 12;
export const GREETING_EVENING_FROM_HOUR = 17;

export function greetingFor(hour: number): string {
  if (hour >= GREETING_EVENING_FROM_HOUR || hour < GREETING_MORNING_FROM_HOUR) return "Good evening";
  if (hour >= GREETING_AFTERNOON_FROM_HOUR) return "Good afternoon";
  return "Good morning";
}

// "Cappuccino ×2, Fries +3 more" — the first `max` line names (with a qty
// mark when more than one), then a count of the REMAINING lines. Empty
// input → "".
export function itemNamesPreview(
  items: ReadonlyArray<{ name: string; qty: number }>,
  max = 2,
): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, max).map((item) => (item.qty > 1 ? `${item.name} ×${item.qty}` : item.name));
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}

// Popular items resolved against the LIVE menu in the aggregation's own
// order: unknown ids (delisted/hidden) and sold-out items are skipped, never
// backfilled, capped at `limit`. An empty result means the row is not drawn.
export function pickPopularItems(
  items: ReadonlyArray<PublicMenuProduct> | undefined,
  popular: ReadonlyArray<string> | undefined,
  limit: number,
): PublicMenuProduct[] {
  if (!items || !popular || limit <= 0) return [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const picked: PublicMenuProduct[] = [];
  for (const id of popular) {
    const item = byId.get(id);
    if (!item || item.available === false) continue;
    picked.push(item);
    if (picked.length === limit) break;
  }
  return picked;
}

// ── CB-6D-A — "Daily offers" moves Menu → Home ──────────────────────────────

// A phone-width scroller, never the whole discounted list.
export const OFFER_ITEMS_MAX = 10;

// Every available, currently-discounted item, in the LIVE MENU'S OWN order —
// the same filter the (now-deleted) Menu-tab offers strip used, feeding
// Home's "Daily offers" row instead.
export function pickOfferItems(
  items: ReadonlyArray<PublicMenuProduct> | undefined,
  limit: number = OFFER_ITEMS_MAX,
): PublicMenuProduct[] {
  return (items ?? []).filter((item) => item.available && item.discount > 0).slice(0, limit);
}
