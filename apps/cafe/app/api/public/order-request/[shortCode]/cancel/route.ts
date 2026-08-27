import { DINER_ACTOR, DINER_CANCELLED_REASON, isPublicCode } from "@pos/shared/public";
import { releasePromoRedemption } from "@/lib/order-request-accept-promo";
import { connectDB } from "@/lib/db";
import { OrderRequest } from "@/models/OrderRequest";
import { failure, notFound, serverError, success } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const ORDER_NOT_FOUND_MESSAGE = "We couldn't find that order";
const ALREADY_PREPARING_MESSAGE = "This order is already being prepared — ask at the counter";
const CANCEL_FAILED_MESSAGE = "Could not cancel that order";

// Every response is uncacheable, same discipline as every other route on this
// surface — this is a write, and a stale cached reply here could tell a diner
// their cancel worked (or didn't) when the truth has since moved on.
function noStore<T extends { headers: Headers }>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

type Params = { params: Promise<{ shortCode: string }> };

// POST /api/public/order-request/[shortCode]/cancel — lets a diner withdraw
// their OWN still-pending order (owner field-feedback 2026-08-20: "pending me
// changes karna hai / new add karna hai — aesa khuch hai hi nahi"). PUBLIC on
// purpose, CAPABILITY-scoped exactly like the sibling status GET (§10 model,
// see that route's own comment): possession of the shortCode alone is the
// authorization, no session and no ownership check beyond it.
//
// Not rate-limited, deliberately: unlike POST /api/public/order-request (a
// write that MINTS a new row), this write is state-LIMITED — only a request
// still "pending" can ever be moved by it — and IDEMPOTENT once it lands, so
// hammering it costs a bot nothing it couldn't already get from one lucky
// guess, and bounding it further would only risk blocking a diner's own retry
// on bad WiFi. No BotID either, for the same reason: this can only ever
// cancel ONE diner's own already-placed order, never create anything.
export async function POST(_req: Request, { params }: Params) {
  const { shortCode } = await params;

  // Shape-validated BEFORE any query, never echoed back — same discipline as
  // every sibling public route.
  if (!isPublicCode(shortCode)) return noStore(notFound(ORDER_NOT_FOUND_MESSAGE));

  try {
    await connectDB();

    // CAS: only a still-"pending" request can be diner-cancelled. Reuses the
    // ordinary "rejected" status rather than a new one — the staff tray
    // already fetches open (pending/accepting) requests only, so this makes
    // the request disappear from it exactly like a staff reject would.
    const cancelled = await OrderRequest.findOneAndUpdate(
      { shortCode, status: "pending" },
      { $set: { status: "rejected", rejectedReason: DINER_CANCELLED_REASON, actor: DINER_ACTOR } },
      { new: true },
    );
    if (cancelled) {
      // Terminal diner cancel (CAS matched from "pending") — hand back any
      // once-per-customer fence a failed earlier accept claimed for this
      // request (keyed requestId + orderId-absent; no-op otherwise), so
      // abandoning the order never consumes the code (review MED #4).
      await releasePromoRedemption(String(cancelled._id));
      return noStore(success({ status: cancelled.status }));
    }

    // CAS missed — re-read to tell apart WHY: never existed (404), already
    // moved past pending (409 — staff have it now), or already cancelled
    // (200, idempotent — a retried tap must never error).
    const existing = await OrderRequest.findOne({ shortCode }).select("status").lean();
    if (!existing) return noStore(notFound(ORDER_NOT_FOUND_MESSAGE));
    if (existing.status !== "rejected") {
      // "accepting"/"accepted" (staff already have it), or the rare
      // revert-to-"pending" race (order-request-accept-core.ts's own
      // reject() helper reverts a failed accept back to "pending" — if that
      // lands in the narrow window between our CAS and this read, the safe
      // answer is still "you're too late", not a silent retry).
      return noStore(failure(ALREADY_PREPARING_MESSAGE, 409));
    }
    return noStore(success({ status: existing.status }));
  } catch (error) {
    return noStore(serverError(CANCEL_FAILED_MESSAGE, error, 503));
  }
}
