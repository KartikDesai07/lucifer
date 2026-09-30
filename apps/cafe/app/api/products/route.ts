import { createCollectionRoute } from "@/lib/crud-route";
import { PRODUCT_LIST, listSpecConfig } from "@/lib/masters";
import { createProductSchema } from "@/schemas";
import { checkCategoryExists } from "@/lib/category-admin";
import { PUBLIC_MENU_CACHE_KEY } from "@/lib/public-menu";

export const dynamic = "force-dynamic";

// GET /api/products — list non-archived products (cached, TTL.PRODUCTS), or the
//   archived ones with `?archived=true` (uncached — a smaller, rarely-read
//   management view).
// POST /api/products — create a product (admin-only; clears caches)
//
// The unfiltered list is described once, in PRODUCT_LIST (lib/masters.ts), which
// GET /api/bootstrap serves the products part from too — `listSpecConfig`
// spreads its model/cacheKey/ttl/sort/filter in so the two cannot disagree.
export const { GET, POST } = createCollectionRoute({
  ...listSpecConfig(PRODUCT_LIST),
  createSchema: createProductSchema,
  // G17 (Menu redesign wording): crud-route's generated messages ("Item not
  // found", "Failed to create item") now read "item", matching the renamed
  // Items screen — never "product", which the redesign retired everywhere.
  entity: { singular: "item", plural: "items" },
  // Menu redesign (owner, 2026-09-30): only an admin may add an item.
  writeGuard: "admin",
  // R7 — a new item can join the public QR menu immediately.
  invalidateKeys: [PUBLIC_MENU_CACHE_KEY],
  // `?archived=true` flips the active baseFilter to list soft-deleted products
  // (the later spread wins in crud-route) and bypasses the shared cache.
  listFilter: (sp) => {
    const archived = sp.get("archived") === "true";
    // B2 D8: ?fresh=1 is an uncached read of the same active list (New Order's
    // post-409 / focus refresh must bypass the 20 s per-instance cache).
    return { query: archived ? { isActive: false } : {}, filtered: archived || sp.get("fresh") === "1" };
  },
  // C12 — reject a categoryId that names no live Category (previously a 201
  // with a dangling link) before the create even runs.
  validate: (data) => checkCategoryExists(data.categoryId),
});
