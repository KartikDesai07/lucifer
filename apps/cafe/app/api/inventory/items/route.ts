import { created, failure, requireAdmin, requireAuth, serverError, success, validateBody } from "@/lib/api-helpers";
import { createStockItem, listStockItems, toStockItemDto } from "@/lib/inventory/items";
import { createStockItemSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// GET /api/inventory/items: any signed-in account (staff see what is in stock). Every active item, A to Z. The
// last purchase rate is a cost, so it is in the answer for an admin only.
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    return success(await listStockItems(authed.session.user.role === "admin"));
  } catch (error) {
    return serverError("Failed to fetch stock items", error);
  }
}

// POST /api/inventory/items: add a stock item (admin). The unit is chosen here and never changes afterwards.
export async function POST(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, createStockItemSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await createStockItem(parsed.data);
    if (!result.ok) return failure(result.error, result.status);
    return created(toStockItemDto(result.row, true));
  } catch (error) {
    return serverError("Failed to add the stock item", error);
  }
}
