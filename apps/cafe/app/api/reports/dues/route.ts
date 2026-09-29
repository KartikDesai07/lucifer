import { connectDB } from "@/lib/db";
import { failure, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { parseDashboardRange } from "@/lib/dashboard/range";
import { buildDuesReport } from "@/lib/reports/dues-build";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";

export const dynamic = "force-dynamic";

// GET /api/reports/dues?from=YYYY-MM-DD&to=YYYY-MM-DD — the Customer dues
// report (lib/reports/dues-build.ts), admin-only. `outstanding` inside the
// built report is LIVE (not ranged); `range` only bounds `collected`/`creditGiven`.
export async function GET(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const parsed = parseDashboardRange({ from: sp.get("from"), to: sp.get("to") }, now, MAX_REPORT_RANGE_DAYS);
  if ("error" in parsed) return failure(parsed.error, 400);

  try {
    await connectDB();
    return success(await buildDuesReport(parsed.range, now));
  } catch (error) {
    return serverError("Failed to build the dues report", error);
  }
}
