import { cafeDateString } from "@pos/shared/utils";
import type { PublicOrderRequestStatusData } from "@pos/shared/public";
import { isActiveOrderStatus } from "@/components/public/PublicStatusChip";

// S8 — pure date-grouping for the diner's "My Orders" list. NO React import:
// PublicMyOrdersTab calls this once per render off its own `orders` state.
//
// Grouping key is the cafe-local (IST) CALENDAR DAY of `data.createdAt`, via
// the repo's own cafeDateString — never toLocaleDateString/getDate/getMonth,
// which read the RUNNING BROWSER/SERVER's timezone, not the cafe's. This
// matters here specifically: cafeDateString's IST flip does not line up with
// a UTC-based "today", so a naive implementation mislabels orders placed in
// the few hours either side of the UTC day boundary.

export interface PastOrder {
  code: string;
  data: PublicOrderRequestStatusData | null;
  // F8 (CB-6D-B review fix, LOW) — true while this row's fetch is still in
  // flight (seeded by use-my-orders.ts, cleared once that row's fetch
  // settles by any outcome). Absent/undefined means settled — either
  // resolved with data, or a resolve that failed and is not going to retry.
  pending?: true;
}

export interface OrderDateGroup {
  key: string;
  label: string;
  orders: PastOrder[];
}

// Sentinel group key for rows whose fetch hasn't resolved yet — never a real
// cafeDateString output (those are always "YYYY-MM-DD"), so it can never
// collide with a real day group.
const UNRESOLVED_GROUP_KEY = "unresolved";
const UNRESOLVED_GROUP_LABEL = "More orders";

// Month abbreviations for the non-Today/Yesterday label below. Indexed
// directly by the 1-based month parsed out of the "YYYY-MM-DD" day key — no
// Date object or locale API involved, so there is no timezone to get wrong.
const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function dayLabel(dayKey: string, todayKey: string, yesterdayKey: string): string {
  if (dayKey === todayKey) return "Today";
  if (dayKey === yesterdayKey) return "Yesterday";
  // Readable label built directly from the day key's own digits (never a
  // Date/locale reformat of it), e.g. "2026-09-10" -> "10 Sep 2026".
  const [year, month, day] = dayKey.split("-");
  const monthName = MONTH_ABBR[Number(month) - 1];
  return `${Number(day)} ${monthName} ${year}`;
}

export function groupOrdersByDate(orders: PastOrder[], now: Date): OrderDateGroup[] {
  if (orders.length === 0) return [];

  const todayKey = cafeDateString(now);
  const yesterdayKey = cafeDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  const byKey = new Map<string, PastOrder[]>();
  const unresolved: PastOrder[] = [];

  for (const order of orders) {
    if (order.data === null) {
      unresolved.push(order);
      continue;
    }
    const key = cafeDateString(new Date(order.data.createdAt));
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(order);
    } else {
      byKey.set(key, [order]);
    }
  }

  // Newest-day-first: day keys are "YYYY-MM-DD" strings, so a plain string
  // sort descending is also a chronological sort descending.
  const dayKeys = [...byKey.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  const groups: OrderDateGroup[] = dayKeys.map((key) => ({
    key,
    label: dayLabel(key, todayKey, yesterdayKey),
    // Newest-first within the group: createdAt is an ISO string, so a plain
    // descending string sort is also chronological here.
    orders: [...byKey.get(key)!].sort((a, b) =>
      a.data!.createdAt < b.data!.createdAt ? 1 : a.data!.createdAt > b.data!.createdAt ? -1 : 0,
    ),
  }));

  if (unresolved.length > 0) {
    groups.push({ key: UNRESOLVED_GROUP_KEY, label: UNRESOLVED_GROUP_LABEL, orders: unresolved });
  }

  return groups;
}

// CB-6D-B — splits the diner's order list into the "Live now" rows (still
// pending/accepting, drawn as PublicActiveOrderCard) and everything else
// (settled AND unresolved), which stays in the day-grouped list below. Pure,
// never mutates `orders`.
//
// F6 (CB-6D-B review fix, LOW) — `live` used to be string-sorted newest-first
// here, but its only caller (pickActiveOrders, via Date.parse) re-sorts it
// anyway — two ordering rules for one list, and the string sort was the dead
// one (it also mis-orders mixed-form ISO timestamps, e.g. a "+05:30" offset
// form against a "Z" form). `live` now keeps INPUT order; pickActiveOrders
// owns newest-first.
export function splitLiveOrders(orders: readonly PastOrder[]): { live: PastOrder[]; rest: PastOrder[] } {
  const live: PastOrder[] = [];
  const rest: PastOrder[] = [];

  for (const order of orders) {
    if (order.data !== null && isActiveOrderStatus(order.data.status)) {
      live.push(order);
    } else {
      rest.push(order);
    }
  }

  return { live, rest };
}

// F8 (CB-6D-B review fix, LOW) — the first painted frame seeded every order
// row `{ code, data: null }` before any fetch settled, and the tab's only
// skeleton gate was `orders === null`, so that first frame briefly listed
// EVERY order as an unresolved Link under "More orders" (visible now that
// "Live now" makes the re-shuffle obvious). Splits `orders` into the settled
// rows (grouped as normal) and a count of still-pending rows (rendered as
// trailing skeleton placeholders instead). Pure, input order preserved.
export function partitionPending(
  orders: readonly PastOrder[],
): { settled: PastOrder[]; pendingCount: number } {
  const settled: PastOrder[] = [];
  let pendingCount = 0;

  for (const order of orders) {
    if (order.pending) {
      pendingCount++;
    } else {
      settled.push(order);
    }
  }

  return { settled, pendingCount };
}
