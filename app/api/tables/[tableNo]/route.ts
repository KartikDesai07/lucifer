import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import cache from "@/lib/cache";
import {
  success,
  notFound,
  validateBody,
  requireAuth,
  serverError,
} from "@/lib/api-helpers";
import { updateTableSchema } from "@/schemas";

export const dynamic = "force-dynamic";

const CACHE_KEY = "tables";

type Params = { params: Promise<{ tableNo: string }> };

// PUT /api/tables/[tableNo] — update status + order pointer (clears cache)
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { tableNo } = await params;

  const parsed = await validateBody(req, updateTableSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const update: Record<string, unknown> = { status: parsed.data.status };
    // Freeing a table clears its order pointer; otherwise honor the new one.
    if (parsed.data.status === "Available") {
      update.currentOrderId = "";
    } else if (parsed.data.currentOrderId !== undefined) {
      update.currentOrderId = parsed.data.currentOrderId;
    }

    const table = await Table.findOneAndUpdate({ tableNo }, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!table) return notFound("Table not found");

    cache.del(CACHE_KEY);
    return success(table);
  } catch (error) {
    return serverError("Failed to update table", error);
  }
}
