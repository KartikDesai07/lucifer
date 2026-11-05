import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { dismissPrintJobs, dismissPrintJobsBodySchema } from "@/lib/print-dismiss";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Staff name fallback for a nullish session name, as the single dismiss route.
const UNNAMED_STAFF = "Staff";

// POST /api/print-jobs/dismiss (Printer UX PX-2, spec §6.9 B2): Clear all. ONE staff request for up to 20 slips (the
// feed's page) instead of a POST and a refetch per slip. Auth as the single route; the reason is Zod-narrowed to
// "staff" (lib/print-dismiss.ts), so a client can never stamp a server reason. No realtime publish: the pulse carries
// the change, as for the single dismiss.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return noStore(authed.error);

  const parsed = await validateBody(req, dismissPrintJobsBodySchema);
  if ("error" in parsed) return noStore(parsed.error);
  // Every id is checked before the database: a malformed one would throw a cast error there.
  if (!parsed.data.ids.every((id) => mongoose.isValidObjectId(id))) return noStore(failure("Print job not found", 400));

  const dismissedBy = authed.session.user.name ?? UNNAMED_STAFF;

  try {
    await connectDB();
    const { dismissed } = await dismissPrintJobs({ ids: parsed.data.ids, dismissedBy, nowMs: Date.now() });
    return noStore(success({ dismissed }));
  } catch (error) {
    return noStore(serverError("Failed to clear the print jobs", error));
  }
}
