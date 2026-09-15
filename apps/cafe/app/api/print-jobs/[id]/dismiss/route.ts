import mongoose from "mongoose";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { dismissPrintJob } from "@/lib/print-queue";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The reason is Zod-ENUMED down to the single staff-initiated value because
// the Mongoose `enum` is NOT a runtime fence for update writers without
// `runValidators` (memory mongoose-model-enum-not-update-fence), and because
// the other four PRINT_JOB_DISMISS_REASONS values are all SERVER-stamped
// (pre-CAS eligibility, the host-cleared bulk teardown, the claim path's
// unparseable-payload case) and must never be assertable by a client:
// letting a caller stamp "order-cancelled" would forge an audit trail the
// band reads back.
const dismissBodySchema = z.object({ reason: z.literal("staff") }).strict();

// Staff name fallback for a nullish session name (Mongoose `dismissedBy` is
// not required on this model, but this mirrors queuedBy's discipline
// repo-wide — memory mongoose-required-rejects-empty-string).
const UNNAMED_STAFF = "Staff";

// POST /api/print-jobs/[id]/dismiss (print-host plan §B2/§B7) — a staff
// "Dismiss" tap from the alert band on a still-queued job.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(failure("Print job not found", 404));

  const parsed = await validateBody(req, dismissBodySchema);
  if ("error" in parsed) return parsed.error;

  const dismissedBy = authed.session.user.name ?? UNNAMED_STAFF;

  try {
    await connectDB();
    const result = await dismissPrintJob({ id, reason: parsed.data.reason, dismissedBy });
    if (!result.dismissed && result.reason === "not-found") {
      return noStore(failure("Print job not found", 404));
    }
    // `{dismissed:false, reason:"raced"}` (a job the host claimed in the same
    // instant) is a normal 200 outcome, not an error.
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to dismiss print job", error));
  }
}
