import { connectDB } from "@/lib/db";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { buildDashboardLive } from "@/lib/dashboard/live";

export const dynamic = "force-dynamic";

// GET /api/dashboard/live — the "Needs attention" strip (open tabs, QR orders
// waiting, dues, unavailable dishes, today's bookings). Staff-visible, uncached:
// realtime nudges refetch it, so it must never answer from a stale copy.
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    return success(await buildDashboardLive());
  } catch (error) {
    return serverError("Failed to load the live counts", error);
  }
}
