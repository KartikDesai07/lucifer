import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { claimKotPrint } from "@/lib/pos-pulse";
import { success, notFound, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/order-requests/[id]/kot-claim (CR2.3 D9) — the staff-side claim
// that gates auto-print of a self-order's KOT to exactly one caller. A lost
// race (`claimed:false, reason:"raced"`) is a NORMAL outcome, not an error —
// this always answers 200 so the client's auto-print bridge can just skip a
// lost claim instead of surfacing an error toast for it.
export async function POST(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  // Checked BEFORE any query and never echoed back — mirrors every other
  // [id] route's notFound() convention for a malformed id.
  if (!mongoose.isValidObjectId(id)) return noStore(notFound("Order request not found"));

  try {
    await connectDB();
    const result = await claimKotPrint(id);
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to claim KOT print", error));
  }
}
