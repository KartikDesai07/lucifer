import { Category } from "@/models/Category";
import { TTL } from "@/lib/cache";
import { createCollectionRoute } from "@/lib/crud-route";
import { createCategorySchema } from "@/schemas";

export const dynamic = "force-dynamic";

// GET /api/categories — list all (cached 5min)
// POST /api/categories — create (clears cache)
export const { GET, POST } = createCollectionRoute({
  model: Category,
  cacheKey: "categories",
  ttl: TTL.CATEGORIES,
  createSchema: createCategorySchema,
  entity: { singular: "category", plural: "categories" },
  sort: { order: 1, name: 1 },
  onDuplicate: "Category already exists",
});
