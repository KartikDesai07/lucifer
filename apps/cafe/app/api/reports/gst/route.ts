import { connectDB } from "@/lib/db";
import { failure, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { parseDashboardRange, rangeDays } from "@/lib/dashboard/range";
import { buildGstReport } from "@/lib/reports/gst-build";
import { GST_BILLS_MAX_DAYS } from "@/lib/reports/gst-display";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";

export const dynamic = "force-dynamic";

const BILLS_ON = "1";

// GET /api/reports/gst?from=YYYY-MM-DD&to=YYYY-MM-DD&bills=1 — the GST report
// (lib/reports/gst-build.ts), admin-only. `bills=1` adds the bill-wise CSV rows.
export async function GET(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const parsed = parseDashboardRange({ from: sp.get("from"), to: sp.get("to") }, now, MAX_REPORT_RANGE_DAYS);
  if ("error" in parsed) return failure(parsed.error, 400);
  const bills = sp.get("bills") === BILLS_ON;
  if (bills && rangeDays(parsed.range) > GST_BILLS_MAX_DAYS) {
    return failure(`Bill-wise rows cover at most ${GST_BILLS_MAX_DAYS} days per request`, 400);
  }

  try {
    await connectDB();
    return success(await buildGstReport(parsed.range, now, { bills }));
  } catch (error) {
    return serverError("Failed to build the GST report", error);
  }
}
