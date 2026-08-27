import { FREE_TABLE_FILTER, isTableFree, type TableOccupancy } from "@/lib/table-admin";

// POST /api/orders/[id]/table — move a LIVE tab to another table, as one pure
// decision layer (the route stays a thin orchestrator), exactly like
// order-void.ts does for item voids. Order (LEDGER) and Table (CORE) live on
// different clusters, so a transaction across them is FORBIDDEN — everything
// here exists to make the route's WRITE ORDER, not a lock, the safety net.

export const ORDER_NOT_LIVE_ERROR =
  "Only an open tab can be moved — this order is already closed";
export const ORDER_NO_TABLE_ERROR =
  "This order has no table to move — it is a walk-in";
export const SAME_TABLE_ERROR = "The order is already on that table";
export const TABLE_TAKEN_ERROR = "That table is already running a bill — pick a free one";
export const TABLE_RESERVED_ERROR = "That table is reserved — free it first or pick another";
export const ORDER_STALE_ERROR = "Order changed — reload and try again";

// The only order status a move ever touches. A move carries no money, so —
// unlike /items and /settle — gating on `payment` too would only manufacture
// false 409s on a perfectly live tab.
export const MOVABLE_ORDER_STATUS = "Pending";

// Whether `table` may take this order, and why not when it can't. `null` means
// the move may proceed. Checked in this order:
//   1. the table already points at THIS order (a retried request that already
//      claimed it) — not a conflict, so null.
//   2. it points at a DIFFERENT order — genuinely taken.
//   3. `Reserved` with no pointer gets its own message (a booking, not a bill).
//   4. anything else not `isTableFree` (e.g. `Occupied` with a stale/absent
//      pointer) falls back to the generic TAKEN message.
export function tableUnavailableReason(
  table: TableOccupancy,
  orderId: string,
): string | null {
  if (table.currentOrderId === orderId) return null;
  if (table.currentOrderId) return TABLE_TAKEN_ERROR;
  if (table.status === "Reserved") return TABLE_RESERVED_ERROR;
  return isTableFree(table) ? null : TABLE_TAKEN_ERROR;
}

// The order's own CAS: asserts BOTH that the tab is still open AND that it is
// still on the table we read it from, so a settle/cancel or a second
// terminal's move landing in between makes this write a no-match — never a
// silent overwrite of whichever change got there first.
export function moveOrderFilter(id: string, fromTableNo: string): Record<string, unknown> {
  return { _id: id, status: MOVABLE_ORDER_STATUS, tableNo: fromTableNo };
}

// The destination's CAS: only claim a table that is genuinely free right now.
export function claimTableFilter(tableNo: string): Record<string, unknown> {
  return { tableNo, ...FREE_TABLE_FILTER };
}

// Written on a successful claim — needs the id, so a function rather than a
// bare constant (mirrors `freeTableFilter`'s echo-arg shape in table-admin.ts).
export function occupyUpdate(orderId: string): Record<string, unknown> {
  return { status: "Occupied", currentOrderId: orderId };
}

// Written on every release (a lost claim, or freeing the vacated old table).
export const RELEASE_UPDATE = { status: "Available", currentOrderId: "" };
