/**
 * CB-DL-2 S4 — the `--reset` step: empties the listed transactional
 * collections (indexes survive — `deleteMany({})`, never `drop()`) and, when
 * "orders" is one of them, releases order-derived occupancy so a reset
 * database does not leave the floor plan stuck Occupied against orders that
 * no longer exist. A table an operator has marked Reserved is left alone —
 * that status is set by staff intent (components/tables/TableCard.tsx), not
 * by an order, and a reset must never erase it.
 * RAW DRIVER ONLY (same discipline as the rest of scripts/migrate-links/**).
 */
import type { Db } from "mongodb";

// The Table status a released table returns to (packages/shared TABLE_STATUSES
// — "Available" is the free state every occupancy guard reads).
export const TABLE_AVAILABLE_STATUS = "Available";

// The one status the reset must never touch (packages/shared TABLE_STATUSES)
// — set by staff tapping a table (components/tables/TableCard.tsx) and read
// by the seating guard (lib/order-table-move.ts); a reset targets ORDER-
// derived occupancy only, never an operator's manual reservation.
const TABLE_RESERVED_STATUS = "Reserved";

export async function applyReset(
  db: Db,
  collections: readonly string[],
): Promise<{ deleted: Record<string, number>; tablesReleased: number; reservedKept: number }> {
  const deleted: Record<string, number> = {};
  for (const name of collections) {
    const result = await db.collection(name).deleteMany({});
    deleted[name] = result.deletedCount;
  }

  let tablesReleased = 0;
  let reservedKept = 0;
  if (collections.includes("orders")) {
    const releaseResult = await db
      .collection("tables")
      .updateMany(
        { status: { $ne: TABLE_RESERVED_STATUS } },
        { $unset: { currentOrderId: "" }, $set: { status: TABLE_AVAILABLE_STATUS } },
      );
    tablesReleased = releaseResult.modifiedCount;
    reservedKept = await db.collection("tables").countDocuments({ status: TABLE_RESERVED_STATUS });
  }

  return { deleted, tablesReleased, reservedKept };
}
