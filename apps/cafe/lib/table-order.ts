// Pure helper for PATCH /api/tables (floor-plan arrangement). No DB import —
// the route owns connectDB()/Table; this only shapes the bulkWrite ops.

// One $set per table, position = index. Expressed as bulkWrite ops so the
// whole arrangement is a single round trip: a per-table request storm can be
// interrupted half-way and leave the floor plan in an order nobody chose.
export function reorderOps(tableNos: string[]) {
  return tableNos.map((tableNo, index) => ({
    updateOne: { filter: { tableNo }, update: { $set: { displayOrder: index } } },
  }));
}
