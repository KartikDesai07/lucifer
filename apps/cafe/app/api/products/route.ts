import { Product } from "@/models/Product";
import { TTL } from "@/lib/cache";
import { createCollectionRoute } from "@/lib/crud-route";
import { createProductSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// GET /api/products — list non-archived products (cached 5min), or the archived
//   ones with `?archived=true` (uncached — a smaller, rarely-read management view).
// POST /api/products — create a product (clears cache)
export const { GET, POST } = createCollectionRoute({
  model: Product,
  cacheKey: "products",
  ttl: TTL.PRODUCTS,
  createSchema: createProductSchema,
  entity: { singular: "product", plural: "products" },
  sort: { category: 1, name: 1 },
  baseFilter: { isActive: true },
  // `?archived=true` flips the active baseFilter to list soft-deleted products
  // (the later spread wins in crud-route) and bypasses the shared cache.
  listFilter: (sp) => {
    const archived = sp.get("archived") === "true";
    return { query: archived ? { isActive: false } : {}, filtered: archived };
  },
});
