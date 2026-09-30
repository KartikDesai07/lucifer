// Pure helpers for PATCH /api/categories (drag-and-drop arrangement, Menu
// redesign 2026-09-30). No DB import — the route owns connectDB()/Category;
// this only compares id sets and shapes the bulkWrite ops. Mirrors
// lib/table-order.ts's reorderOps idiom.

// R22 (arbitration ruling) — the exact 409 copy when the submitted id list is
// not the current set (another screen/device added, removed or renamed a
// category since this one loaded its list).
export const CATEGORY_LIST_CHANGED_ERROR =
  "The category list changed on another screen. It has been refreshed — arrange again.";

// True only when both arrays contain exactly the same ids, order irrelevant.
// The route uses this to refuse a stale/partial list rather than silently
// dropping or ignoring a category the caller didn't know about.
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

// One $set per category, position = index — the whole arrangement lands as a
// single round trip (a per-category request storm could otherwise be
// interrupted half-way and leave the list in an order nobody chose).
export function categoryReorderOps(ids: readonly string[]) {
  return ids.map((id, index) => ({
    updateOne: { filter: { _id: id }, update: { $set: { order: index } } },
  }));
}
