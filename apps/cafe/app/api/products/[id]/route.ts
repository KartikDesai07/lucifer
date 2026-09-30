import { Product } from "@/models/Product";
import { createItemRoute } from "@/lib/crud-route";
import { updateProductSchema } from "@/schemas";
import { STAFF_PRODUCT_FIELDS } from "@/lib/write-access";
import { PUBLIC_MENU_CACHE_KEY } from "@/lib/public-menu";

export const dynamic = "force-dynamic";

// GET /api/products/[id] — fetch one
// PUT /api/products/[id] — update. Staff may send ONLY {available} (R1); every
//   other field, or DELETE (restore/archive), is admin-only. Clears caches.
// DELETE /api/products/[id] — soft delete (isActive:false), admin-only, clears
//   caches.
export const { GET, PUT, DELETE } = createItemRoute({
  model: Product,
  cacheKey: "products",
  updateSchema: updateProductSchema,
  // G17 (Menu redesign wording): crud-route's generated messages ("Item not
  // found", "Failed to update item") now read "item", matching the renamed
  // Items screen — never "product", which the redesign retired everywhere.
  entity: { singular: "item", plural: "items" },
  writeGuard: "admin",
  staffUpdateFields: STAFF_PRODUCT_FIELDS,
  // R7 — an edit, a restock toggle, an archive or a restore can all change
  // what the public QR menu should show.
  invalidateKeys: [PUBLIC_MENU_CACHE_KEY],
  // "Has variations" OFF sends variations: null — the one way an admin can say
  // an item is no longer sold by size. Without this the null would be STORED
  // (or, before the sentinel, dropped entirely and silently ignored).
  // publicVisible works the same way: "Show on public menu" ON sends null so
  // the field goes back to ABSENT (= visible, omit-empty) — a stored `true`
  // would silently change what the CSV import and the $ne:false filter mean.
  // icon works the same way: "Remove icon" sends null so the field goes back
  // to ABSENT — a stored explicit value here would defeat the catalogue's
  // append-only, omit-empty discipline (product-icons.ts).
  nullClearsFields: ["variations", "publicVisible", "icon"],
  softDelete: true,
});
