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
  requireAuth,
  isDuplicateKeyError,
} from "@/lib/api-helpers";
import { updateCategorySchema } from "@/schemas";
import { UNCATEGORIZED } from "@/lib/constants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PUT /api/categories/[id] — rename / reorder. A rename is propagated to every
// product that stored the old (denormalized) category name so none are orphaned.
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Category not found");

  const parsed = await validateBody(req, updateCategorySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const existing = await Category.findById(id);
    if (!existing) return notFound("Category not found");

    const oldName = existing.name;
    const renamed =
      parsed.data.name !== undefined && parsed.data.name !== oldName;

    existing.set(parsed.data);
    await existing.save();

    if (renamed) {
      await Product.updateMany(
        { category: oldName },
        { category: existing.name },
      );
      cache.del("products");
    }

    cache.del("categories");
    return success(existing.toObject());
  } catch (e) {
    if (isDuplicateKeyError(e)) return failure("Category already exists", 400);
    return failure("Failed to update category");
  }
}

// DELETE /api/categories/[id] — delete + reassign orphaned products, clear caches
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Category not found");

  try {
    await connectDB();
    const category = await Category.findById(id);
    if (!category) return notFound("Category not found");

    // Reassign products in this category so none are left orphaned.
    await Product.updateMany(
      { category: category.name },
      { category: UNCATEGORIZED },
    );
    await category.deleteOne();

    cache.del("categories");
    cache.del("products");
    return success({ deleted: true });
  } catch {
    return failure("Failed to delete category");
  }
}
