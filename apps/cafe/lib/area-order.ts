// Pure helpers for PATCH /api/areas (the Areas sheet's drag-and-drop
// arrangement). No DB import - the route owns connectDB()/Area; this only shapes
// the bulkWrite ops. Client-safe (hooks/use-areas imports AREAS_FRESH_PARAM).
// Mirrors lib/category-order.ts, whose sameIdSet the route reuses.

// GET /api/areas?fresh=1 drops this instance's cached list and reads the DB
// (the recovery read after a failed save or a stale area id).
export const AREAS_FRESH_PARAM = "fresh";

// The exact 409 copy when the submitted id list is not the current set (another
// screen added, removed or renamed an area since this one loaded its list).
export const AREA_LIST_CHANGED_ERROR =
  "The area list changed on another screen. It has been refreshed — arrange again.";

// One $set per area, position = index - the whole arrangement lands as a single
// round trip, so an interrupted request cannot leave an order nobody chose.
export function areaReorderOps(ids: readonly string[]) {
  return ids.map((id, index) => ({
    updateOne: { filter: { _id: id }, update: { $set: { displayOrder: index } } },
  }));
}
