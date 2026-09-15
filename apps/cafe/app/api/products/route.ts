import { createCollectionRoute } from "@/lib/crud-route";
import { PRODUCT_LIST, listSpecConfig } from "@/lib/masters";
import { createProductSchema } from "@/schemas";
import { checkCategoryExists } from "@/lib/category-admin";

export const dynamic = "force-dynamic";

// GET /api/products — list non-archived products (cached, TTL.PRODUCTS), or the
//   archived ones with `?archived=true` (uncached — a smaller, rarely-read
//   management view).
// POST /api/products — create a product (clears cache)
//
// The unfiltered list is described once, in PRODUCT_LIST (lib/masters.ts), which
// GET /api/bootstrap serves the products part from too — `listSpecConfig`
// spreads its model/cacheKey/ttl/sort/filter in so the two cannot disagree.
export const { GET, POST } = createCollectionRoute({
  ...listSpecConfig(PRODUCT_LIST),
  createSchema: createProductSchema,
  entity: { singular: "product", plural: "products" },
  // `?archived=true` flips the active baseFilter to list soft-deleted products
  // (the later spread wins in crud-route) and bypasses the shared cache.
  listFilter: (sp) => {
    const archived = sp.get("archived") === "true";
    return { query: archived ? { isActive: false } : {}, filtered: archived };
  },
  // C12 — reject a categoryId that names no live Category (previously a 201
  // with a dangling link) before the create even runs.
  validate: (data) => checkCategoryExists(data.categoryId),
});
