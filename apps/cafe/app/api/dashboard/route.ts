import { connectDB } from "@/lib/db";
import { success, failure, requireAuth, serverError } from "@/lib/api-helpers";
import { parseDashboardRange } from "@/lib/dashboard/range";
import { buildDashboard } from "@/lib/dashboard/build";

export const dynamic = "force-dynamic";

// GET /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD — the dashboard's range
// aggregates (lib/dashboard/build.ts), compared with the previous period.
// One day is staff-visible (the day summary's rule, CR1.5 S5); more than one
// day is reporting data, admin-only (the reports route's rule). Uncached:
// orders are never cached, and every read here is a bounded, index-backed
// aggregate — freshness comes from the client's poll.
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const parsed = parseDashboardRange({ from: sp.get("from"), to: sp.get("to") }, now);
  if ("error" in parsed) return failure(parsed.error, 400);
  const { range } = parsed;
  if (range.from !== range.to && authed.session.user.role !== "admin") {
    return failure("Only an admin can view more than one day", 403);
  }

  try {
    await connectDB();
    return success(await buildDashboard(range, now));
  } catch (error) {
    return serverError("Failed to build the dashboard", error);
  }
}
