import { failure, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { parseDashboardRange } from "@/lib/dashboard/range";
import { buildExpenseReport } from "@/lib/expenses/report";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";

export const dynamic = "force-dynamic";

// GET /api/reports/expenses?from=YYYY-MM-DD&to=YYYY-MM-DD — the Expenses report
// (lib/expenses/report.ts): totals by category, day and payment mode over the
// active (not deleted) rows. Admin-only like every report. "Sales − expenses"
// is composed in the browser from the Sales report — no coupling here.
export async function GET(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const parsed = parseDashboardRange({ from: sp.get("from"), to: sp.get("to") }, new Date(), MAX_REPORT_RANGE_DAYS);
  if ("error" in parsed) return failure(parsed.error, 400);

  try {
    return success(await buildExpenseReport(parsed.range));
  } catch (error) {
    return serverError("Failed to build the expenses report", error);
  }
}
