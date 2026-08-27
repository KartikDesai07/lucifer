import mongoose from "mongoose";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { OrderRequest } from "@/models/OrderRequest";
import { REQUEST_REJECTED_ERROR, findByRequestId } from "@/lib/order-request-accept";
import { releasePromoRedemption } from "@/lib/order-request-accept-promo";
import { ORDER_REASON_MIN_LEN, ORDER_REASON_MAX_LEN } from "@/lib/constants";
import {
  success,
  failure,
  notFound,
  requireAuth,
  validateBody,
  serverError,
} from "@/lib/api-helpers";
import { toTrayRequest, noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const rejectRequestSchema = z.object({
  reason: z.string().trim().min(ORDER_REASON_MIN_LEN).max(ORDER_REASON_MAX_LEN),
});

// POST /api/order-requests/[id]/reject (CR2.2 SLICE 6) — CAS-guarded on
// status IN [pending, accepting] (FIX9(b): widened so a stranded "accepting"
// row is rejectable once verified order-free by the findByRequestId check
// above); a double-tap reject lands on the re-read below instead of silently
// overwriting a different terminal state.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound("Order request not found"));

  const parsed = await validateBody(req, rejectRequestSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();

    // FIX9(b) — verify-before-CAS: a request already folded into an order
    // (by a concurrent or just-finished accept) must never be rejected, even
    // though its status may still read "accepting" for a moment. Safe
    // ordering despite the gap below: an accept actively in flight holds
    // status "accepting", and its own claim/finalize CAS terms (see
    // order-request-accept-core.ts) still win any interleaving with the CAS
    // that follows — the unique sourceRequestIds index is the last-line
    // fence either way. This check only widens what a STRANDED (crashed, no
    // order) accepting row can be rejected as; it never reopens an applied one.
    const appliedOrder = await findByRequestId(id);
    if (appliedOrder) {
      return noStore(failure("This order request was already accepted — refresh the tray", 409));
    }

    const updated = await OrderRequest.findOneAndUpdate(
      { _id: id, status: { $in: ["pending", "accepting"] } },
      {
        $set: {
          status: "rejected",
          rejectedReason: parsed.data.reason,
          actor: authed.session.user.name ?? "",
        },
      },
      { new: true },
    );
    if (updated) {
      // CR2.2 fix round (billed-but-rejected race) — the pre-check above only
      // rules out an order that already existed BEFORE this CAS attempt; an
      // accept's own order-write can still land in the gap between that read
      // and this CAS actually landing. Re-check NOW: if an Order exists, our
      // reject lost for real — hand the row back to "accepting" so the
      // accept flow's own finalizeAccept (finalizeCasFilter now widened to
      // accept "rejected" too, order-request-accept-core.ts) can still mark
      // it accepted whichever of the two writes actually lands last. Either
      // way the row converges on "accepted", never stays wrongly "rejected"
      // against a real, billed order.
      const raced = await findByRequestId(id);
      if (raced) {
        await OrderRequest.findOneAndUpdate(
          { _id: id, status: "rejected" },
          { $set: { status: "accepting" } },
        );
        return noStore(
          failure("An accept was completing — the order already exists; retry from the tray.", 409),
        );
      }
      // A DEFINITE terminal reject (CAS matched, no racing order) — hand back
      // any once-per-customer fence a failed accept attempt claimed for this
      // request (keyed requestId + orderId-absent; no-op otherwise), or the
      // customer's code stays consumed with no order behind it (review MED #4).
      await releasePromoRedemption(id);
      return noStore(success(toTrayRequest(updated, authed.session.user.role)));
    }

    // CAS miss — re-read to name the request's CURRENT state (the double-tap
    // answer) instead of a generic conflict.
    const current = await OrderRequest.findById(id);
    if (!current) return noStore(notFound("Order request not found"));
    if (current.status === "accepted") {
      return noStore(failure("This order request was already accepted", 409));
    }
    if (current.status === "rejected") {
      return noStore(failure(REQUEST_REJECTED_ERROR, 409));
    }
    // Defensive fallback only: the CAS above already covers "accepting", and
    // the findByRequestId check above already covers an applied "accepting"
    // row — a genuine hit here means the row changed state again in the gap
    // between this re-read and the CAS attempt.
    return noStore(failure("This order request is being accepted — try again in a moment", 409));
  } catch (error) {
    return noStore(serverError("Failed to reject order request", error));
  }
}
