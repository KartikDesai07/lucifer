import mongoose from "mongoose";
import { failure, notFound, requireAdmin, serverError, success, validateBody } from "@/lib/api-helpers";
import cache from "@/lib/cache";
import { STOCK_USE_PRODUCT_NOT_FOUND_ERROR, trackOwnStock } from "@/lib/inventory/stock-use-write";
import { PRODUCT_LIST } from "@/lib/masters";
import { ownStockSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/products/[id]/stock-use/own (admin): the one tap that makes a menu item its own stock item (one sold =
// one unit). Idempotent: a repeat tap answers 200 with the same stock use.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(STOCK_USE_PRODUCT_NOT_FOUND_ERROR);

  const parsed = await validateBody(req, ownStockSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await trackOwnStock(id, parsed.data.unit);
    if (!result.ok) return failure(result.error, result.status);
    cache.del(PRODUCT_LIST.cacheKey);
    return success(result.dto);
  } catch (error) {
    return serverError("Failed to track the item's own stock", error);
  }
}
