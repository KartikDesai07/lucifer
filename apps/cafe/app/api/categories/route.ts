import { createCollectionRoute } from "@/lib/crud-route";
import { CATEGORY_LIST, listSpecConfig } from "@/lib/masters";
import { createCategorySchema } from "@/schemas";

export const dynamic = "force-dynamic";

// GET /api/categories — list all (cached, TTL.CATEGORIES)
// POST /api/categories — create (clears cache)
//
// The list itself is described once, in CATEGORY_LIST (lib/masters.ts), which
// GET /api/bootstrap serves the categories part from too — `listSpecConfig`
// spreads its model/cacheKey/ttl/sort/filter in so the two cannot disagree.
export const { GET, POST } = createCollectionRoute({
  ...listSpecConfig(CATEGORY_LIST),
  createSchema: createCategorySchema,
  entity: { singular: "category", plural: "categories" },
  onDuplicate: "Category already exists",
});
