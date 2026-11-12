import mongoose from "mongoose";
import { failure, notFound, requireAdmin, serverError, success, validateBody } from "@/lib/api-helpers";
import cache from "@/lib/cache";
import { getStockUse, setStockUse, STOCK_USE_PRODUCT_NOT_FOUND_ERROR } from "@/lib/inventory/stock-use-write";
import { PRODUCT_LIST } from "@/lib/masters";
import { stockUseSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET / PUT /api/products/[id]/stock-use (admin): what one sold unit of a menu item takes out of stock. A route of
// its own on purpose: the product schemas and the product PUT never carry stockUse (and after a rollback it 404s).
export async function GET(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(STOCK_USE_PRODUCT_NOT_FOUND_ERROR);

  try {
    const result = await getStockUse(id);
    if (!result.ok) return failure(result.error, result.status);
    return success(result.dto);
  } catch (error) {
    return serverError("Failed to load the stock use", error);
  }
}

export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(STOCK_USE_PRODUCT_NOT_FOUND_ERROR);

  const parsed = await validateBody(req, stockUseSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await setStockUse(id, parsed.data);
    if (!result.ok) return failure(result.error, result.status);
    // The settle peeks this cached list for stock links, so a changed recipe must not outlive it.
    cache.del(PRODUCT_LIST.cacheKey);
    return success(result.dto);
  } catch (error) {
    return serverError("Failed to save the stock use", error);
  }
}
