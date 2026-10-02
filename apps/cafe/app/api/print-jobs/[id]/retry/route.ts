import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { retryPrintJob } from "@/lib/print-job-actions";
import { success, failure, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/print-jobs/[id]/retry (spec §7.2, §7.3): Print again on a failed job (labelled REPRINT
// or DUPLICATE if it may already have printed), or Print now on a queued job parked as stale.
export async function POST(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(failure("Print job not found", 404));

  try {
    await connectDB();
    const result = await retryPrintJob({ id, nowMs: Date.now() });
    if (result.reason === "not-found") return noStore(failure("Print job not found", 404));
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to retry the print job", error));
  }
}
