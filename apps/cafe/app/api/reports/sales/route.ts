import { connectDB } from "@/lib/db";
import { failure, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { parseDashboardRange } from "@/lib/dashboard/range";
import { buildSalesReport } from "@/lib/reports/sales-build";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";

export const dynamic = "force-dynamic";

// GET /api/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD — the Sales summary
// report (lib/reports/sales-build.ts), admin-only (reporting data — mirrors
// app/api/dashboard/route.ts's shape, wider cap).
export async function GET(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const parsed = parseDashboardRange({ from: sp.get("from"), to: sp.get("to") }, now, MAX_REPORT_RANGE_DAYS);
  if ("error" in parsed) return failure(parsed.error, 400);

  try {
    await connectDB();
    return success(await buildSalesReport(parsed.range, now));
  } catch (error) {
    return serverError("Failed to build the sales report", error);
  }
}
