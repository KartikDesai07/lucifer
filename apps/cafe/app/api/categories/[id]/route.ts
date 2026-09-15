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
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { updateCategorySchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PUT /api/categories/[id] — rename / reorder. Products link by categoryId
// only, so a rename touches nothing on the product side — no cascade needed.
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

    existing.set(parsed.data);
    await existing.save();

    cache.del("categories");
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
        `This category still has ${count} products. Move them to another category first.`,
        409,
      );
    }

    await category.deleteOne();

    cache.del("categories");
    cache.del("products");
    return success({ deleted: true });
  } catch (error) {
    return serverError("Failed to delete category", error);
  }
}
