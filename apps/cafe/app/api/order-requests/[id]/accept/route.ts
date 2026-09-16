import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { acceptOrderRequest } from "@/lib/order-request-accept";
import { success, failure, notFound, requireAuth, serverError } from "@/lib/api-helpers";
import { toTrayRequest, noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/order-requests/[id]/accept (CR2.2 SLICE 6) — the staff-side call
// into the accept bridge. The ORDER rides back whole: the staff browser feeds
// it straight to the existing KOT print queue and it carries no diner
// mobile, so only the `request` half needs the role-based mask.
export async function POST(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  // Checked BEFORE any query and never echoed back — mirrors every other
  // [id] route's notFound() convention for a malformed id.
  if (!mongoose.isValidObjectId(id)) return noStore(notFound("Order request not found"));

  try {
    await connectDB();
    // Staff path — the upserting getter is correct here (unlike public
    // routes, which must never write on an unauthenticated render).
    const settings = await getSettings();
    const result = await acceptOrderRequest(id, {
      actor: authed.session.user.name ?? "",
      settings,
      createCustomer: true,
    });
    if ("error" in result) return noStore(failure(result.error, result.status));

    const role = authed.session.user.role;
    return noStore(
      success({
        order: result.order,
        request: toTrayRequest(result.request, role),
        replayed: result.replayed,
      }),
    );
  } catch (error) {
    return noStore(serverError("Failed to accept order request", error));
  }
}
