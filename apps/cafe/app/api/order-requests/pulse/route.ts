import { connectDB } from "@/lib/db";
import { readPosPulse } from "@/lib/pos-pulse";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// GET /api/order-requests/pulse (CR2.3 §20) — the staff-attention pulse every
// dashboard tab polls every 20s (PosPulseProvider), replacing the old sidebar
// badge poll one-for-one so requests/min is unchanged.
//
// Threat model: authenticated staff-only (requireAuth, same as every sibling
// under /api/order-requests), READ-ONLY (no write, no pruneOrderRequests —
// see lib/pos-pulse.ts's own comment), and never cached (live state, exactly
// like /api/order-requests and /api/orders). Being a hot path is exactly why
// it must stay two bounded index-backed queries and nothing else — this
// route must never grow a third query or a write.
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    const data = await readPosPulse();
    return noStore(success(data));
  } catch (error) {
    return noStore(serverError("Failed to fetch pos pulse", error));
  }
}
