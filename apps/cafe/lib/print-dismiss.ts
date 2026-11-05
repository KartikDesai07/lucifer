import type { FilterQuery } from "mongoose";
import { z } from "zod";
import type { PrintJobStatus } from "@pos/shared/print-job";
import { PRINT_ACK_UNREACHABLE, PRINT_DISMISS_MANY_MAX } from "@pos/shared/print-agent-wire";
import type { PrintJobLifecycle } from "@pos/shared/print-lifecycle";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { dismissPrintJob, type DismissPrintJobResult } from "./print-queue";

// Printer UX PX-2 (docs/superpowers/specs/2026-11-05-printer-ux-design.md §6.9 B1/B2, R2, R15): a staff Clear.
// Today's dismiss (print-queue.ts) refuses a slip being printed, since its writer may be putting it on paper right
// now; it stays exactly as it is for its eight server callers (R2). A staff Clear on such a slip keeps the ask on the
// job instead (dismissRequestedAt / dismissRequestedBy): when that try ends without paper the lifecycle ends it
// dismissed (@pos/shared/print-lifecycle-clear), and paper still wins. Only the two staff routes call these writes.
// Never calls connectDB() (the routes do). No console.*, no realtime publish (as the single dismiss).

/** Rounds of [today's dismiss, then the leased CAS]: a slip whose try ended between the two (back in line) is
 *  dismissed by the next round's first step, so a lost race never leaves a cleared slip on the list. */
const STAFF_DISMISS_ROUNDS = 2;

/** dismissPrintJob's own filter (print-queue.ts): a waiting or parked slip the legacy claim never took. */
const WAITING: FilterQuery<IPrintJob> = { status: { $in: ["queued", "needs-confirm", "failed"] }, claimedAt: { $exists: false } };

/** POST /api/print-jobs/dismiss (Clear all): at most every row the feed shows, and only the staff reason, as the single
 *  route (a client must never stamp a server reason). Here, not in the route: a route file exports only its handlers. */
export const dismissPrintJobsBodySchema = z.object({ ids: z.array(z.string()).min(1).max(PRINT_DISMISS_MANY_MAX), reason: z.literal("staff") }).strict();

/** B1's second CAS: the slip is being printed, so only the request is set (it may still end printed). No term on the
 *  request itself: a second Clear on a slip that already carries one sets it again and answers dismissed too (F-M3).
 *  claimedAt: the legacy claim owns a job past it, as in dismissPrintJob. true: the slip carries the request now. */
export async function requestDismissWhilePrinting(input: { id: string; dismissedBy: string; nowMs: number }): Promise<boolean> {
  const res = await PrintJob.updateOne(
    { _id: input.id, status: "leased", claimedAt: { $exists: false } },
    { $set: { dismissRequestedAt: new Date(input.nowMs), dismissRequestedBy: input.dismissedBy } },
  );
  return res.matchedCount === 1;
}

/** One staff Clear (the single route): today's dismiss for a waiting or parked slip, the request for one being
 *  printed. not-found (no such slip) and raced (claimed, or finished meanwhile) answer as today (controller Ruling D). */
export async function dismissPrintJobByStaff(input: { id: string; dismissedBy: string; nowMs: number }): Promise<DismissPrintJobResult> {
  let result: DismissPrintJobResult = { dismissed: false, reason: "raced" };
  for (let round = 0; round < STAFF_DISMISS_ROUNDS; round++) {
    result = await dismissPrintJob({ id: input.id, reason: "staff", dismissedBy: input.dismissedBy });
    if (result.dismissed || result.reason === "not-found") return result;
    if (await requestDismissWhilePrinting(input)) return { dismissed: true };
  }
  return result;
}

/** Clear all (B2): the single Clear's two CASs over up to 20 slips in three writes, never a request per slip. Every
 *  waiting or parked slip is dismissed, every slip being printed gets the request, and one whose try ended between the
 *  two (back in line) is dismissed by the third. `dismissed`: the slips that left the list or will once their try ends;
 *  an id that is gone or already finished counts nothing. */
export async function dismissPrintJobs(input: { ids: string[]; dismissedBy: string; nowMs: number }): Promise<{ dismissed: number }> {
  const waiting: FilterQuery<IPrintJob> = { _id: { $in: input.ids }, ...WAITING };
  const dismiss = { $set: { status: "dismissed" as const, dismissedAt: new Date(input.nowMs), dismissReason: "staff" as const, dismissedBy: input.dismissedBy } };
  const first = await PrintJob.updateMany(waiting, dismiss);
  const printing = await PrintJob.updateMany(
    { _id: { $in: input.ids }, status: "leased", claimedAt: { $exists: false } },
    { $set: { dismissRequestedAt: new Date(input.nowMs), dismissRequestedBy: input.dismissedBy } },
  );
  const again = await PrintJob.updateMany(waiting, dismiss);
  return { dismissed: first.modifiedCount + printing.modifiedCount + again.modifiedCount };
}

/** Controller Ruling E: an ack whose writer could not reach a network printer (Phase 3, §9.3) skips that writer for
 *  it, whether the refusal put the slip back in line (today) or ended a slip a staff Clear waited on: either way the
 *  printer's next slips must go to a device that can reach it. A permanent refusal never skips (as today). */
export function ackSkipsUnreachableWriter(
  ack: { reason?: string; sent?: "no" | "maybe"; permanent?: boolean },
  job: Pick<PrintJobLifecycle, "dismissRequest">,
  status: PrintJobStatus,
): boolean {
  if (ack.reason !== PRINT_ACK_UNREACHABLE || ack.sent !== "no" || ack.permanent === true) return false;
  return status === "queued" || (status === "dismissed" && job.dismissRequest !== undefined);
}
