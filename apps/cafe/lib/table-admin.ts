import { Table } from "@/models/Table";
import {
  NO_TABLE_CHARGE,
  tableChargeOf,
  type TableChargeConfig,
} from "@/lib/receipt";

// A table's name is what everything else points at: an open tab's receipt and
// KOT show it, a reservation books it by it, and — because Order lives on the
// LEDGER cluster while Table lives on CORE — a rename can never cascade to
// historical orders (cross-cluster writes are forbidden and ledger rows are
// immutable). So a table may only be renamed or removed while it is free
// (no open tab pointing at it); editing just its capacity is always safe.

export const TABLE_BUSY_ERROR = "Free the table before renaming or removing it";
export const TABLE_DUPLICATE_ERROR = "A table with that name already exists";
export const TABLE_NOT_FOUND_ERROR = "Table not found";
export const TABLE_CLAIMED_ERROR = "This table was already claimed by another order";

export function unknownTableMessage(tableNo: string): string {
  return `Table "${tableNo}" is not on the floor plan`;
}

export interface TableOccupancy {
  status: string;
  currentOrderId?: string;
}

export function isTableFree(table: TableOccupancy): boolean {
  return table.status === "Available" && !table.currentOrderId;
}

// Mongo filter fragment matching only a free table. currentOrderId is unset on
// seeded tables and "" once freed, so both must match.
export const FREE_TABLE_FILTER = {
  status: "Available",
  currentOrderId: { $in: [null, ""] },
};

// Update filter for PUT /api/tables/[tableNo] — the ONE safe way to write the
// live status/order pointer. `expectedCurrentOrderId` (an echo of the order the
// caller believes currently holds the table — CR1.5 Slice 2) is a FILTER
// directive, never a stored field: when supplied, the write only lands if
// currentOrderId still equals it, so a second order that claimed the table
// first can never be silently overwritten. A caller that omits the echo keeps
// today's plain-tableNo behavior — that omission is deliberate for callers
// that genuinely have nothing to assert, not a license to skip it (a blind
// free was the CR1-audit bug this guards against).
export function freeTableFilter(
  tableNo: string,
  expectedCurrentOrderId?: string,
): Record<string, unknown> {
  return {
    tableNo,
    ...(expectedCurrentOrderId !== undefined
      ? { currentOrderId: expectedCurrentOrderId }
      : {}),
  };
}

// Confirms a tableNo names an actual table on this cafe's floor plan. Returns
// null for a falsy tableNo (walk-in / no table — always valid) or when the
// table exists; otherwise the rejection message. Caller must have already
// called connectDB().
export async function checkTableExists(tableNo?: string): Promise<string | null> {
  if (!tableNo) return null;
  const exists = await Table.exists({ tableNo });
  return exists ? null : unknownTableMessage(tableNo);
}

// The extra charge a table is configured to add, read SERVER-SIDE at pricing
// time from the stored document — never echoed back from the request. The
// naming rule lives in `tableChargeOf` so the POS applies exactly the same one;
// what this adds is that the CLIENT CANNOT INVENT a charge: a table with
// nothing configured yields 0 whatever the request body says, so an operator
// may waive or adjust the table's charge but never conjure one onto a table
// that has none.
//
// Doubles as the existence check (same single query), so a caller that needs
// both does not pay for two round trips.
export async function resolveTableCharge(
  tableNo?: string,
): Promise<{ error: string } | { charge: TableChargeConfig }> {
  if (!tableNo) return { charge: NO_TABLE_CHARGE };
  const doc = await Table.findOne({ tableNo })
    .select("chargeAmount chargeLabel")
    .lean();
  if (!doc) return { error: unknownTableMessage(tableNo) };
  return { charge: tableChargeOf(doc) };
}
