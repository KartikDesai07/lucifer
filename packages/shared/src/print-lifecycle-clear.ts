// ─────────────────────────────────────────────────────────────────────────────
// Printer UX PX-2 (docs/superpowers/specs/2026-11-05-printer-ux-design.md §6.9 B1, SR-3..SR-7, R7, R8): a staff
// Clear that lands while a slip is being printed cannot stop the write already on its way, so the server keeps it
// on the job as a request (dismissRequestedAt / dismissRequestedBy). When that try ends without paper (a failed,
// maybe or permanent ack, or the lease running out) the job ends dismissed instead of going back in line, to the
// cashier's question or to "Couldn't print"; paper that came out (a printed ack, even a late one at the same epoch)
// still wins. Without the request every plan is exactly today's. print-lifecycle.ts (past the 300-line rule) calls
// these from one-line call sites; this file imports only TYPES from it, so there is no runtime import cycle.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrintJobStatus } from "./print-job";
import type { PrintJobAck, PrintJobLifecycle, PrintJobLifecycleDoc, PrintJobPlan } from "./print-lifecycle";

/** The dismissed log's detail (spec §6.9 B1): a slip's history says why one that was printing left the list. */
export const PRINT_CLEARED_WHILE_PRINTING = "cleared while printing";

/** Who asked, when no name was stored: the staff routes' own fallback for a nameless session. */
const UNNAMED_STAFF = "Staff";

/** Every status a leased try can end in without paper. A printed ack is not here, so paper always wins (SR-3). */
const ENDED_WITHOUT_PAPER: readonly PrintJobStatus[] = ["queued", "needs-confirm", "failed"];

/** The request on a lean read (lifecycleOf). Only a real Date counts: a malformed field must never end a slip. */
export function dismissRequestOf(doc: PrintJobLifecycleDoc): PrintJobLifecycle["dismissRequest"] {
  if (!(doc.dismissRequestedAt instanceof Date)) return undefined;
  const by = typeof doc.dismissRequestedBy === "string" && doc.dismissRequestedBy !== "" ? doc.dismissRequestedBy : UNNAMED_STAFF;
  return { at: doc.dismissRequestedAt, by };
}

/** planAck's leased exits and planExpiry: with the request, a try that ended without paper ends the job dismissed
 *  (the staff's Clear, applied now), so it never prints again by itself (no REPRINT, no "print again?", no
 *  "Couldn't print"). The request stays on the row: a late printed ack still turns it printed (R8). Any other plan,
 *  and every plan for a job without the request, is returned as it is. */
export function clearRequestedOutcome(job: PrintJobLifecycle, plan: PrintJobPlan, nowMs: number, deviceId?: string): PrintJobPlan {
  if (job.dismissRequest === undefined || !plan.ok || !ENDED_WITHOUT_PAPER.includes(plan.patch.status)) return plan;
  return {
    ok: true,
    patch: {
      status: "dismissed",
      set: { status: "dismissed", dismissedAt: new Date(nowMs), dismissReason: "staff", dismissedBy: job.dismissRequest.by },
      unset: ["lease"],
      log: {
        at: new Date(nowMs),
        event: "dismissed",
        ...(deviceId !== undefined && deviceId !== "" ? { deviceId } : {}),
        detail: PRINT_CLEARED_WHILE_PRINTING,
      },
    },
  };
}

/** R8: a printed ack that comes late (the same epoch) on a slip the request ended as dismissed. The paper is on
 *  the counter, so the job turns printed (today's late-ack patch) and is never recorded as cleared. null: planAck
 *  answers as today (resolved), so an older try's ack, a failure, or a job dismissed any other way is untouched. */
export function lateAckAfterClear(job: PrintJobLifecycle, ack: PrintJobAck, nowMs: number): PrintJobPlan | null {
  if (job.status !== "dismissed" || job.dismissRequest === undefined) return null;
  if (ack.outcome !== "printed" || ack.epoch !== job.epoch) return null;
  return {
    ok: true,
    patch: {
      status: "printed",
      set: { status: "printed", printedAt: new Date(nowMs), printedBy: ack.deviceId },
      unset: ["lease", "lastError"],
      log: { at: new Date(nowMs), event: "late-ack", ...(ack.deviceId !== "" ? { deviceId: ack.deviceId } : {}) },
    },
  };
}

/** R7: a staff Try again / Print now / Print again puts a slip that still carries a request back in line (a rollout
 *  race with an older server can leave one). The later tap wins, so the request is unset: left, it would dismiss
 *  the very try the staff just asked for. A lease leaves it (planLease is not wrapped). */
export function withoutClearRequest(job: PrintJobLifecycle, plan: PrintJobPlan): PrintJobPlan {
  if (job.dismissRequest === undefined || !plan.ok || plan.patch.status !== "queued") return plan;
  return { ok: true, patch: { ...plan.patch, unset: [...plan.patch.unset, "dismissRequestedAt", "dismissRequestedBy"] } };
}
