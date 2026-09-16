import { z } from "zod";
import type { FilterQuery } from "mongoose";
import { connectDB } from "@/lib/db";
import { OrderRequest, ORDER_REQUEST_STATUSES, type IOrderRequest } from "@/models/OrderRequest";
import { pruneOrderRequests } from "@/lib/order-request-intake";
import { success, failure, requireAuth, serverError } from "@/lib/api-helpers";
import { toTrayRequest, noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Rows the staff tray reads per poll (oldest-pending-first) — bounded like
// CUSTOMER_SEARCH_LIMIT so a busy shift never hands back an unbounded list on
// a 512MB M0.
const ORDER_REQUEST_TRAY_LIMIT = 50;

// FIX9(a) — "open" is a virtual status the tray now queries by default: both
// live (actionable) states in one call, so the tray never has to poll
// pending and accepting separately.
const OPEN_STATUS_QUERY = "open";
const statusQuerySchema = z.union([z.literal(OPEN_STATUS_QUERY), z.enum(ORDER_REQUEST_STATUSES)]);

// GET /api/order-requests?status=pending — the staff order-request tray
// (CR2.2 SLICE 6). Requests are live state, exactly like orders — never
// cached (see lib/order-request-tray.ts's noStore).
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const statusParam = new URL(req.url).searchParams.get("status") ?? "pending";
  const parsedStatus = statusQuerySchema.safeParse(statusParam);
  if (!parsedStatus.success) return noStore(failure("Invalid status", 400));

  try {
    await connectDB();
    // Best-effort so the tray path prunes stale rows even on a quiet shift
    // with no diner POSTs to piggyback the sweep on (already bounded/
    // swallows its own errors — see pruneOrderRequests's own comment).
    await pruneOrderRequests(Date.now());
    const filter: FilterQuery<IOrderRequest> =
      parsedStatus.data === OPEN_STATUS_QUERY
        ? { status: { $in: ["pending", "accepting"] } }
        : { status: parsedStatus.data };

    const docs = await OrderRequest.find(filter)
      .sort({ createdAt: 1 })
      .limit(ORDER_REQUEST_TRAY_LIMIT)
      .lean();
    const role = authed.session.user.role;
    return noStore(success(docs.map((doc) => toTrayRequest(doc, role))));
  } catch (error) {
    return noStore(serverError("Failed to fetch order requests", error));
  }
}
