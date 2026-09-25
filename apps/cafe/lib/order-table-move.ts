import { FREE_TABLE_FILTER, isTableFree, type TableOccupancy } from "@/lib/table-admin";
import { voidGuardFilter } from "@/lib/order-void";

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

// The order's own CAS: asserts the tab is still open, still on the table we
// read it from, AND still the exact money state we priced the move's re-charge
// from — a move is now a read-modify-write on MONEY (CB-CHG plan §5A), not a
// bare tableNo swap, so the filter gains the terms the other money writers
// already use, reused rather than re-rolled: `total` (settle's term),
// `kotRounds` (add-round's term), and `voidGuardFilter` (the void's term,
// keyed on the trail's own length). This NARROWS the allowed-state set the
// old {_id, status, tableNo} filter matched, so it re-opens no existing race —
// it only makes MORE concurrent edits (a round fired, a void, a settle) make
// this write miss and 409, instead of silently clobbering one with a stale
// re-price.
export function moveOrderFilter(
  id: string,
  fromTableNo: string,
  order: { total: number; kotRounds?: number; voids?: unknown[] },
): Record<string, unknown> {
  return {
    _id: id,
    status: MOVABLE_ORDER_STATUS,
    tableNo: fromTableNo,
    total: order.total,
    kotRounds: order.kotRounds ?? 0,
    ...voidGuardFilter(order.voids?.length ?? 0),
  };
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
