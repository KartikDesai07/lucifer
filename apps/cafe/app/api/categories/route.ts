import { createCollectionRoute } from "@/lib/crud-route";
import { CATEGORY_LIST, listSpecConfig, listCategories } from "@/lib/masters";
import { createCategorySchema, reorderCategoriesSchema } from "@/schemas";
import { connectDB } from "@/lib/db";
import { Category } from "@/models/Category";
import cache from "@/lib/cache";
import { success, failure, validateBody, requireAdmin, serverError } from "@/lib/api-helpers";
import { sameIdSet, categoryReorderOps, CATEGORY_LIST_CHANGED_ERROR } from "@/lib/category-order";
import { PUBLIC_MENU_CACHE_KEY } from "@/lib/public-menu";

export const dynamic = "force-dynamic";

const CACHE_KEY = CATEGORY_LIST.cacheKey;

// GET /api/categories — list all (cached, TTL.CATEGORIES), or an UNCACHED read
//   with `?fresh=1` (R12 — used after a 409 to refetch a list another screen
//   or device just changed, so the retry can never race a stale in-process
//   cache on THIS instance).
// POST /api/categories — create (admin-only; clears cache)
// PATCH /api/categories — save the drag-and-drop arrangement (admin-only)
//
// The list itself is described once, in CATEGORY_LIST (lib/masters.ts), which
// GET /api/bootstrap serves the categories part from too — `listSpecConfig`
// spreads its model/cacheKey/ttl/sort/filter in so the two cannot disagree.
export const { GET, POST } = createCollectionRoute({
  ...listSpecConfig(CATEGORY_LIST),
  createSchema: createCategorySchema,
  entity: { singular: "category", plural: "categories" },
  onDuplicate: "Category already exists",
  // Menu redesign (owner, 2026-09-30): categories are admin-only end to end.
  writeGuard: "admin",
  invalidateKeys: [PUBLIC_MENU_CACHE_KEY],
  // `?fresh=1` bypasses the shared cache for an always-uncached read — same
  // "filtered reads skip the cache" mechanism products' `?archived=true` uses.
  listFilter: (sp) => ({ query: {}, filtered: sp.get("fresh") === "1" }),
});

// PATCH /api/categories — the WHOLE ordered id list is sent (mirrors PATCH
// /api/tables' reorderTablesSchema idiom): positions are derived from the
// index, so a client can never invent a sparse or colliding order. The route
// refuses a list that is not EXACTLY the current set (R22) rather than
// silently reordering a subset or dropping a category nobody mentioned.
//
// R2 (accepted residual risk, no CAS): two admins dragging in the same instant
// can both pass the same-set check and each bulkWrite a slightly different
// order; the CATEGORY_LIST sort ({order:1, name:1}) keeps the result
// deterministic either way, and the next reorder renumbers cleanly. No lock
// is taken — an admin category-order collision is rare and self-healing.
export async function PATCH(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, reorderCategoriesSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const current = await Category.find().select("_id").lean();
    const currentIds = current.map((c) => String(c._id));

    if (!sameIdSet(parsed.data.ids, currentIds)) {
      return failure(CATEGORY_LIST_CHANGED_ERROR, 409);
    }

    await Category.bulkWrite(categoryReorderOps(parsed.data.ids));
    cache.del(CACHE_KEY);
    cache.del(PUBLIC_MENU_CACHE_KEY);
    return success(await listCategories());
  } catch (error) {
    return serverError("Failed to save the arrangement", error);
  }
}
