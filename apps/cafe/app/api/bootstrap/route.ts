import { buildBootstrap } from "@/lib/bootstrap";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// GET /api/bootstrap (CB-DL-1) — the one authenticated call a dashboard tab
// makes on load to get every master list at once: settings, categories,
// products, tables and (admin only) staff. It replaces the five separate GETs
// each tab used to fire, so a reload costs one round trip instead of five.
//
// Threat model: authenticated staff-only (requireAuth, like every other master
// route), READ-ONLY, and never cached at the HTTP layer (no-store) — the
// staleness bound is the shared in-process cache's per-collection TTL, exactly
// as it is on the five routes this call stands in for. The staff part is
// admin-only and byte-equal to GET /api/staff (no password field); a non-admin
// session gets `staff: null`.
//
// All the DB work lives in buildBootstrap (lib/bootstrap.ts), which owns the
// single database connect and calls the routes' own list functions — this file
// runs no query of its own so the two can never diverge.
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const includeStaff = authed.session.user.role === "admin";

  try {
    return noStore(success(await buildBootstrap({ includeStaff })));
  } catch (error) {
    return noStore(serverError("Failed to load master data", error));
  }
}
