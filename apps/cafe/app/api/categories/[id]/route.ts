import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import cache from "@/lib/cache";
import {
  success,
  failure,
  notFound,
  validateBody,
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { updateCategorySchema } from "@/schemas";
import { PUBLIC_MENU_CACHE_KEY } from "@/lib/public-menu";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PUT /api/categories/[id] — rename / reorder. Admin-only (owner, 2026-09-30).
// Products link by categoryId only, so a rename touches nothing on the
// product side — no cascade needed.
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Category not found");

  const parsed = await validateBody(req, updateCategorySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const existing = await Category.findById(id);
    if (!existing) return notFound("Category not found");

    // Printing Phase 2 (spec §6.2): stationId null sends the category back to the default station by
    // removing the field (omit-empty); a plain set would STORE null.
    // Skip-KOT: noKot null (the switch back ON) is removed the same way; true is stored (omit-empty: never false).
    const { stationId, noKot, ...rest } = parsed.data;
    existing.set(rest);
    if (stationId === null) existing.set("stationId", undefined);
    else if (stationId !== undefined) existing.set("stationId", stationId);
    if (noKot === null) existing.set("noKot", undefined);
    else if (noKot !== undefined) existing.set("noKot", noKot);
    await existing.save();

    cache.del("categories");
    cache.del(PUBLIC_MENU_CACHE_KEY);
    return success(existing.toObject());
  } catch (e) {
    if (isDuplicateKeyError(e)) return failure("Category already exists", 400);
    return serverError("Failed to update category", e);
  }
}

// DELETE /api/categories/[id] — delete only if empty (see the guard below), clear caches
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Category not found");

  try {
    await connectDB();
    const category = await Category.findById(id);
    if (!category) return notFound("Category not found");

    // Refuse to delete a category still in use — products link by categoryId
    // only, so a delete here would orphan every product's link. ALL products
    // count (archived included): an archived product can still be restored.
    const count = await Product.countDocuments({ categoryId: id });
    if (count > 0) {
      return failure(
        `This category still has ${count} items. Move them to another category first.`,
        409,
      );
    }

    await category.deleteOne();

    cache.del("categories");
    cache.del("products");
    cache.del(PUBLIC_MENU_CACHE_KEY);
    return success({ deleted: true });
  } catch (error) {
    return serverError("Failed to delete category", error);
  }
}
