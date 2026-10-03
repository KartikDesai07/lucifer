import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { confirmPrintJob } from "@/lib/print-job-actions";
import { confirmBodySchema } from "@/lib/print-lifecycle-schemas";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Staff name fallback: the decision is stamped as printedBy / dismissedBy (required strings).
const UNNAMED_STAFF = "Staff";

// POST /api/print-jobs/[id]/confirm (spec §7.2, §7.3): the cashier answers "Print the bill
// again?" for a bill that may already be on paper. Any logged-in device that sees the job may
// answer. A job not waiting for a decision is a normal 200 ({applied:false, reason:"wrong-status"}).
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(failure("Print job not found", 404));

  const parsed = await validateBody(req, confirmBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await confirmPrintJob({
      id,
      decision: parsed.data.decision,
      staff: authed.session.user.name ?? UNNAMED_STAFF,
      nowMs: Date.now(),
    });
    if (result.reason === "not-found") return noStore(failure("Print job not found", 404));
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to record the decision", error));
  }
}
