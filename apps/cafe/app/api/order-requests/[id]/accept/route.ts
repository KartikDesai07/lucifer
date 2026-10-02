import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { acceptOrderRequest } from "@/lib/order-request-accept";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { createOrderPrintJobs, printIntentOf } from "@/lib/print-order-jobs";
import { success, failure, notFound, requireAuth, serverError } from "@/lib/api-helpers";
import { toTrayRequest, noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/order-requests/[id]/accept (CR2.2 SLICE 6) — the staff-side call
// into the accept bridge. The ORDER rides back whole: the staff browser feeds
// it straight to the existing KOT print queue and it carries no diner
// mobile, so only the `request` half needs the role-based mask.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  // Checked BEFORE any query and never echoed back — mirrors every other
  // [id] route's notFound() convention for a malformed id.
  if (!mongoose.isValidObjectId(id)) return noStore(notFound("Order request not found"));
  // Printing Phase 1 (lib/print-order-jobs.ts): null for a tab that prints its own slips.
  const intent = printIntentOf(req);

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

    // Accepting a request CREATES a tab whose first round is already fired
    // (acceptOrderRequest writes kotRounds:1), so this is a kot-fired for the
    // Kitchen board — not merely a self-order for the POS pulse. Without this
    // the board would not show a QR ticket until its next 10s poll, which is
    // the one path the whole slice exists to speed up.
    publishCafeEvent("kot-fired");

    // Printing Phase 1 (spec §7.4): the round this accept fired (the order's latest, exactly what the
    // bridge stamps as acceptedKotRound). A replay creates nothing: its round may be several behind,
    // and the device enqueues any slip its answer did not name (the key dedupes).
    const printJobs =
      intent && !result.replayed
        ? await createOrderPrintJobs({
            order: result.order,
            slips: [{ kind: "kot", round: result.order.kotRounds }],
            originDeviceId: intent.deviceId,
            queuedBy: authed.session.user.name ?? "",
            nowMs: Date.now(),
          })
        : null;

    const role = authed.session.user.role;
    return noStore(
      success({
        order: result.order,
        request: toTrayRequest(result.request, role),
        replayed: result.replayed,
        ...(printJobs !== null ? { printJobs } : {}),
      }),
    );
  } catch (error) {
    return noStore(serverError("Failed to accept order request", error));
  }
}
