import { connectDB } from "@/lib/db";
import { leasePrintJobs } from "@/lib/print-lease";
import { touchPrintDevice } from "@/lib/print-device";
import { leaseBodySchema } from "@/lib/print-lifecycle-schemas";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Staff name fallback: a Mongoose required string refuses "" (memory mongoose-required-rejects-empty-string).
const UNNAMED_STAFF = "Staff";

// POST /api/print-jobs/lease (spec §7.3): the printing device leases the head of its own line, at
// most one job, for 90 s, with the payload. It also counts as a heartbeat. "Nothing to lease" is a
// normal 200 ({jobs: [], retryAt}); retryAt says when the head can next be leased.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, leaseBodySchema);
  if ("error" in parsed) return parsed.error;

  const nowMs = Date.now();
  try {
    await connectDB();
    const [result] = await Promise.all([
      leasePrintJobs({
        deviceId: parsed.data.deviceId,
        tabId: parsed.data.tabId,
        tokenSlips: parsed.data.tokenSlips === true,
        dismissedBy: authed.session.user.name ?? UNNAMED_STAFF,
        nowMs,
      }),
      // Best-effort (1A review M1): the lease CAS may already have committed, and a 500 now would
      // strand the job for 90 s and then reprint it. A missed touch only ages lastSeenAt.
      touchPrintDevice(parsed.data.deviceId, nowMs).catch(() => undefined),
    ]);
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to lease print jobs", error));
  }
}
