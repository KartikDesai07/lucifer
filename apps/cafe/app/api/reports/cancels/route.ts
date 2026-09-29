import { connectDB } from "@/lib/db";
import { failure, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { parseDashboardRange } from "@/lib/dashboard/range";
import { buildCancelsReport } from "@/lib/reports/cancels-build";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";

export const dynamic = "force-dynamic";

// GET /api/reports/cancels?from=YYYY-MM-DD&to=YYYY-MM-DD — the Cancel &
// discounts report (lib/reports/cancels-build.ts), admin-only.
export async function GET(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const parsed = parseDashboardRange({ from: sp.get("from"), to: sp.get("to") }, now, MAX_REPORT_RANGE_DAYS);
  if ("error" in parsed) return failure(parsed.error, 400);

  try {
    await connectDB();
    return success(await buildCancelsReport(parsed.range, now));
  } catch (error) {
    return serverError("Failed to build the cancels report", error);
  }
}
