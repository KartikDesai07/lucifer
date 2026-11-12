import mongoose from "mongoose";
import { failure, notFound, requireAdmin, serverError, success, validateBody } from "@/lib/api-helpers";
import { STOCK_ITEM_NOT_FOUND_ERROR, toStockItemDto, updateStockItem } from "@/lib/inventory/items";
import { updateStockItemSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/inventory/items/[id]: rename, set or clear the low-stock level, or archive (admin). There is no
// DELETE: an archived item stays in old bills and entries. The unit and the stock number are not writable here.
export async function PATCH(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound(STOCK_ITEM_NOT_FOUND_ERROR);

  const parsed = await validateBody(req, updateStockItemSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await updateStockItem(id, parsed.data);
    if (!result.ok) return failure(result.error, result.status);
    return success(toStockItemDto(result.row, true));
  } catch (error) {
    return serverError("Failed to update the stock item", error);
  }
}
