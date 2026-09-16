import { z } from "zod";
import { connectDB } from "@/lib/db";
import {
  PRINT_HOST_DEVICE_ID_MAX_CHARS,
  PRINT_HOST_LABEL_MAX_CHARS,
  PRINT_HOST_DESIGNATION_ENABLED,
  PRINT_HOST_DESIGNATION_CLOSED_ERROR,
  designatePrintHost,
  clearPrintHost,
} from "@/lib/print-host";
import { dismissQueuedPrintJobsForClearedHost, prunePrintJobs } from "@/lib/print-queue";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Staff name fallback for a nullish session name — setBy/dismissedBy are
// stamped from the session, never the body (MERGED-17); mirrors the other
// print-host routes' UNNAMED_STAFF discipline.
const UNNAMED_STAFF = "Staff";

// Both `.min(1)` are MANDATORY: the model marks deviceId/label `required:true`
// and the designation upsert runs `runValidators:true`, so a "" would 500 the
// request (memory mongoose-required-rejects-empty-string).
const designateBodySchema = z
  .object({
    deviceId: z.string().trim().min(1).max(PRINT_HOST_DEVICE_ID_MAX_CHARS),
    label: z.string().trim().min(1).max(PRINT_HOST_LABEL_MAX_CHARS),
  })
  .strict();

// PUT /api/print-host (print-host plan §B3) — any logged-in staff device
// designates itself (or another device) as the print host. Designating
// replaces the previous host — that IS the "one host" rule.
// ROLLOUT FENCE: while PRINT_HOST_DESIGNATION_ENABLED is false the handler
// refuses right after auth — see lib/print-host.ts for the why. Opened by PH-8
// (the literal is `true` now); the branch stays so re-closing is one edit.
export async function PUT(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  // Fence AFTER auth (anonymous callers still get the plain 401, never product
  // state) but BEFORE validation and connectDB() — zero DB cost for a refused
  // tap. 403: a policy refusal, not a server fault, so nothing retries it. The
  // wizard needs no change: useDesignatePrintHost's onError toasts this exact
  // envelope error (apiSend -> unwrap throws body.error).
  if (!PRINT_HOST_DESIGNATION_ENABLED) {
    return noStore(failure(PRINT_HOST_DESIGNATION_CLOSED_ERROR, 403));
  }

  const parsed = await validateBody(req, designateBodySchema);
  if ("error" in parsed) return parsed.error;

  const setBy = authed.session.user.name ?? UNNAMED_STAFF;
  const nowMs = Date.now();

  try {
    await connectDB();
    const result = await designatePrintHost(
      { deviceId: parsed.data.deviceId, label: parsed.data.label, setBy },
      nowMs,
    );
    if (!result.ok) {
      return noStore(failure("Could not set the print host — try again", 409));
    }

    // Best-effort, own try/catch — a replaced host's residual queue gets
    // swept (MERGED-14). UNTHROTTLED (prunePrintJobs, not the Throttled
    // wrapper): PUT/DELETE are low-frequency staff actions, not a hot poll,
    // so §B3's "each also run one best-effort prune" guarantee must not
    // silently no-op because it shares the enqueue POST's module-level
    // throttle clock (FIX 8) — that clock stays reserved for the POST path.
    try {
      await prunePrintJobs(nowMs);
    } catch {
      // best-effort only — swallow (prunePrintJobs already swallows its own)
    }

    return noStore(success(result.state));
  } catch (error) {
    return noStore(serverError("Failed to set the print host", error));
  }
}

// DELETE /api/print-host (print-host plan §B3) — reachable from ANY
// logged-in device INCLUDING a mobile UA: `isMobileUserAgent` gates
// DESIGNATION only (MERGED-17), because the whole point of DELETE is
// recovering when the host PC is dead and only phones are present. No UA
// check in this route at all.
//
// Order matters and is deliberate: clear -> prune -> dismiss, each position
// earning its place.
// (a) clearPrintHost() FIRST restores the NARROW enqueue window: with the
//     host doc gone, a further enqueue's FIRST host check answers `no-host`
//     outright, and an in-flight enqueue whose first check already passed
//     now has its post-create re-read (`enqueuePrintJob`'s reciprocal guard,
//     lib/print-queue.ts) see that same absence — so no concurrent enqueue
//     can be told "queued" and then only get bulk-dismissed by THIS
//     request's own teardown, with the kitchen ticket existing nowhere.
// (b) prunePrintJobs() SECOND, run BEFORE the bulk dismiss below: its
//     resolved-sweep filters `createdAt`, so running it here means it can
//     never delete a row this request's OWN dismiss has not stamped yet —
//     the dismissedBy/dismissReason actor trail SEC-7 requires survives to
//     at least the next sweep (rows already past the 12h queued-retention
//     cutoff ARE deleted by this sweep rather than dismissed — that is
//     correct, they are past retention either way).
// (c) dismissQueuedPrintJobsForClearedHost() LAST, so the clear leaves no
//     orphan queued rows and the staff band goes quiet.
// (a) alone gives the narrow enqueue window; (b) before (c) gives the
// trail-preserving prune — both properties are obtainable together only in
// THIS order. Never reorder these three without re-deriving both.
export async function DELETE() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const dismissedBy = authed.session.user.name ?? UNNAMED_STAFF;
  const nowMs = Date.now();

  try {
    await connectDB();

    const { cleared } = await clearPrintHost();

    // UNTHROTTLED (prunePrintJobs, not the Throttled wrapper) — DELETE is a
    // low-frequency staff action, not a hot poll, so §B3's "each also run one
    // best-effort prune" guarantee must not silently no-op by sharing the
    // enqueue POST's module-level throttle clock (FIX 8).
    try {
      await prunePrintJobs(nowMs);
    } catch {
      // best-effort only — swallow (prunePrintJobs already swallows its own)
    }

    const dismissed = await dismissQueuedPrintJobsForClearedHost(dismissedBy);

    return noStore(success({ cleared, dismissed }));
  } catch (error) {
    return noStore(serverError("Failed to clear the print host", error));
  }
}
