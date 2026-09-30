import { connectDB } from "@/lib/db";
import cache from "@/lib/cache";
import { Product } from "@/models/Product";
import {
  success,
  failure,
  validateBody,
  requireAuth,
  serverError,
} from "@/lib/api-helpers";
import { bulkProductsSchema, isStaffBulkAction } from "@/schemas";
import { checkCategoryExists } from "@/lib/category-admin";
import { bulkUpdateOf } from "@/lib/product-bulk";
import { PUBLIC_MENU_CACHE_KEY } from "@/lib/public-menu";
import type { ProductBulkResult } from "@/types";

export const dynamic = "force-dynamic";

// POST /api/products/bulk — the Items page's bulk bar (Menu redesign,
// 2026-09-30). Staff may only run out-of-stock/in-stock (STAFF_PRODUCT_BULK_
// ACTIONS); every other action is admin-only, checked here — BEFORE the
// updateMany — rather than relying on the UI to hide the button.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, bulkProductsSchema);
  if ("error" in parsed) return parsed.error;
  const { action, ids } = parsed.data;

  // The per-action role check runs BEFORE any DB write: a staff session
  // naming an admin-only action must change nothing, not even a partial
  // batch of the ids it happened to be allowed to touch.
  if (authed.session.user.role !== "admin" && !isStaffBulkAction(action)) {
    return failure("Admin access required", 403);
  }

  try {
    await connectDB();

    const categoryId = "categoryId" in parsed.data ? parsed.data.categoryId : undefined;
    if (action === "move" && categoryId) {
      const invalid = await checkCategoryExists(categoryId);
      if (invalid) return failure(invalid, 400);
    }

    const { stateFilter, update } = bulkUpdateOf(action, categoryId);
    const res = await Product.updateMany(
      { _id: { $in: ids }, ...stateFilter },
      update,
    );

    cache.del("products");
    cache.del(PUBLIC_MENU_CACHE_KEY);

    const result: ProductBulkResult = {
      action,
      requested: ids.length,
      matched: res.matchedCount ?? 0,
      modified: res.modifiedCount ?? 0,
    };
    return success(result);
  } catch (error) {
    return serverError("Failed to apply the bulk action", error);
  }
}
