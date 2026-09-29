import { z } from "zod";
import { connectDB } from "@/lib/db";
import { failure, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { parseDashboardRange } from "@/lib/dashboard/range";
import { buildItemDetail } from "@/lib/reports/items-build";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";

export const dynamic = "force-dynamic";

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;
const LABEL_MIN_LEN = 1;
const LABEL_MAX_LEN = 200;

const detailQuerySchema = z.object({
  productId: z.union([z.literal(""), z.string().regex(OBJECT_ID_HEX, "Not a valid product id")]),
  label: z.string().trim().min(LABEL_MIN_LEN).max(LABEL_MAX_LEN),
});

// GET /api/reports/items/detail?from&to&productId&label — one item's
// day/hour drill-down (lib/reports/items-build.ts buildItemDetail),
// admin-only. `productId` "" means the item's product no longer exists.
export async function GET(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const parsed = parseDashboardRange({ from: sp.get("from"), to: sp.get("to") }, now, MAX_REPORT_RANGE_DAYS);
  if ("error" in parsed) return failure(parsed.error, 400);

  const query = detailQuerySchema.safeParse({ productId: sp.get("productId") ?? "", label: sp.get("label") ?? "" });
  if (!query.success) return failure(query.error.issues[0]?.message ?? "Invalid item", 400);

  try {
    await connectDB();
    return success(await buildItemDetail(parsed.range, query.data, now));
  } catch (error) {
    return serverError("Failed to build the item detail", error);
  }
}
