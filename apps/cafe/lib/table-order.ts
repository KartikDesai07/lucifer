// Pure helper for PATCH /api/tables (floor-plan arrangement). No DB import —
// the route owns connectDB()/Table; this only shapes the bulkWrite ops.
// Client-safe (hooks/use-tables imports TABLES_FRESH_PARAM from here).

// GET /api/tables?fresh=1 drops this instance's cached list and reads the DB
// (the Setup screen's recovery read after a 409 or a failed save).
export const TABLES_FRESH_PARAM = "fresh";

// A reorder names EVERY table. A list that no longer matches the floor plan
// (a table added, renamed or removed on another screen since this one loaded)
// is refused whole — the Categories rule — so nothing is half-arranged.
export const TABLE_LIST_CHANGED_ERROR =
  "The table list changed on another screen. It has been refreshed — arrange again.";

/** Same set of names, in any order. Duplicates never match (the zod schema
 *  refuses them first; this stays correct on its own). */
export function sameTableSet(submitted: readonly string[], current: readonly string[]): boolean {
  if (submitted.length !== current.length) return false;
  const want = new Set(submitted);
  if (want.size !== submitted.length) return false;
  const have = new Set(current);
  return have.size === current.length && submitted.every((tableNo) => have.has(tableNo));
}

// One $set per table, position = index. Expressed as bulkWrite ops so the
// whole arrangement is a single round trip: a per-table request storm can be
// interrupted half-way and leave the floor plan in an order nobody chose.
export function reorderOps(tableNos: string[]) {
  return tableNos.map((tableNo, index) => ({
    updateOne: { filter: { tableNo }, update: { $set: { displayOrder: index } } },
  }));
}
