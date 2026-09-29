import { connectDB } from "@/lib/db";
import { failure, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { parseDashboardRange } from "@/lib/dashboard/range";
import { parseHourDetailQuery } from "@/lib/reports/order-types-query";
import { buildHourDetail } from "@/lib/reports/order-types-build";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";

export const dynamic = "force-dynamic";

// GET /api/reports/order-types/detail?from&to&hour&type — one hour's
// day-by-day drill-down (lib/reports/order-types-build.ts buildHourDetail),
// admin-only. `type` absent means every order type.
export async function GET(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const parsed = parseDashboardRange({ from: sp.get("from"), to: sp.get("to") }, now, MAX_REPORT_RANGE_DAYS);
  if ("error" in parsed) return failure(parsed.error, 400);

  const query = parseHourDetailQuery(sp);
  if ("error" in query) return failure(query.error, 400);

  try {
    await connectDB();
    return success(await buildHourDetail(parsed.range, query.hour, query.type, now));
  } catch (error) {
    return serverError("Failed to build the hour detail", error);
  }
}
