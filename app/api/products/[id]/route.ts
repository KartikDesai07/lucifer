import { Product } from "@/models/Product";
import { createItemRoute } from "@/lib/crud-route";
import { updateProductSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// GET /api/products/[id] — fetch one
// PUT /api/products/[id] — update (clears cache)
// DELETE /api/products/[id] — soft delete (isActive:false), clears cache
export const { GET, PUT, DELETE } = createItemRoute({
  model: Product,
  cacheKey: "products",
  updateSchema: updateProductSchema,
  entity: { singular: "product", plural: "products" },
  softDelete: true,
});
