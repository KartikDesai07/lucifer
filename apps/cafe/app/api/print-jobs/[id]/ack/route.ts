import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { ackPrintJob } from "@/lib/print-lease";
import { ackBodySchema } from "@/lib/print-lifecycle-schemas";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/print-jobs/[id]/ack (spec §7.3, §7.9): the writer reports one leased attempt. The
// epoch fences it: a late ack still counts if nobody leased the job since, and is logged and
// ignored otherwise. A repeat of an applied ack answers applied:false with the current status, so
// an agent retrying its pending acks can stop as soon as it sees "printed".
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(failure("Print job not found", 404));

  const parsed = await validateBody(req, ackBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await ackPrintJob({ id, ...parsed.data, nowMs: Date.now() });
    if (result.reason === "not-found") return noStore(failure("Print job not found", 404));
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to record the print result", error));
  }
}
