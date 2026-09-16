import { connectDB } from "@/lib/db";
import { z } from "zod";
import { printJobPayloadSchema } from "@pos/shared/schemas/print-job.schema";
import { PRINT_JOB_LABEL_MAX_CHARS, printJobPayloadWithinCap } from "@pos/shared/print-job";
import { enqueuePrintJob, prunePrintJobsThrottled } from "@/lib/print-queue";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Staff name fallback for a nullish session name (Mongoose `queuedBy` is
// `required:true` and a "" would 500 the save — repo memory
// mongoose-required-rejects-empty-string).
const UNNAMED_STAFF = "Staff";

// No `kind`, `orderId`, or `jobKey` in the body — all three are derived
// server-side (in enqueuePrintJob) from the payload's OWN discriminator, so a
// caller can never make them diverge from the payload or poison the jobKey
// dedupe fence with a mismatched value.
const enqueueBodySchema = z
  .object({
    payload: printJobPayloadSchema,
    label: z.string().trim().min(1).max(PRINT_JOB_LABEL_MAX_CHARS),
  })
  .strict();

// POST /api/print-jobs (print-host plan §B2/§B4) — any logged-in staff device
// enqueues one of the five thermal documents (or a reprint/cancel-notice) for
// the designated host PC to drain. The response is `{outcome, ...}` — there
// is no `{queued, reason}` shape (that shape was deleted); `result.queued` is
// `undefined` on EVERY outcome. `outcome` is one of "queued" | "no-host" |
// "already-resolved" | "too-large", all NORMAL 200 results. The ONLY
// sanctioned way to decide whether a caller may fall back to a LOCAL print is
// `printJobEnqueueAllowsLocalPrint(result.outcome)` from `@pos/shared/print-job`
// — never branch on `result.queued` or re-derive the rule inline, or a
// successfully queued job also prints locally.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, enqueueBodySchema);
  if ("error" in parsed) return parsed.error;

  // 64KB M0 fence, checked here at the edge as well as inside the lib.
  if (!printJobPayloadWithinCap(JSON.stringify(parsed.data.payload))) {
    return noStore(failure("Print payload too large", 400));
  }

  const queuedBy = authed.session.user.name ?? UNNAMED_STAFF;
  // Called once per request, passed down.
  const nowMs = Date.now();

  try {
    await connectDB();
    const result = await enqueuePrintJob({
      payload: parsed.data.payload,
      label: parsed.data.label,
      queuedBy,
    });

    // Best-effort, AFTER the enqueue, in its own try/catch so a sweep failure
    // can never fail a real enqueue — retention must never depend on the host
    // device being alive (MERGED-14); the throttle keeps a busy shift from
    // sweeping on every ticket.
    try {
      await prunePrintJobsThrottled(nowMs);
    } catch {
      // best-effort only — swallow
    }

    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to enqueue print job", error));
  }
}
