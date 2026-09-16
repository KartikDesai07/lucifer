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
  // "Has variations" OFF sends variations: null — the one way an admin can say
  // an item is no longer sold by size. Without this the null would be STORED
  // (or, before the sentinel, dropped entirely and silently ignored).
  // publicVisible works the same way: "Show on public menu" ON sends null so
  // the field goes back to ABSENT (= visible, omit-empty) — a stored `true`
  // would silently change what the CSV import and the $ne:false filter mean.
  nullClearsFields: ["variations", "publicVisible"],
  softDelete: true,
});
