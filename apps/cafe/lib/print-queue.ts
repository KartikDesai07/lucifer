import { isDuplicateKeyError } from "@pos/shared/api";
import {
  PRINT_HOST_KEY,
  PRINT_HOST_MAX_AGE_MS,
  PRINT_JOB_PRUNE_MIN_INTERVAL_MS,
  PRINT_JOB_QUEUED_RETENTION_MS,
  PRINT_JOB_RESOLVED_RETENTION_MS,
  printJobPayloadWithinCap,
  type PrintJobDismissReason,
  type PrintJobEnqueueResult,
} from "@pos/shared/print-job";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";

// Print-host plan (.claude/plan/v2/print-host-plan.md §B1/§B3/§B4) — the
// PrintJob queue: enqueue, dismiss, and the lazy prune sweep (the §B4 feed
// reads live in print-queue-feeds.ts, which imports this file's cutoff
// helpers). Never calls connectDB() — every route caller does that first. No
// console.*, strict TS, no `any`.

/** Pure: the Order this job's document points at — `_id`, because the claim's
 *  pre-CAS eligibility looks the live Order up by `_id`. `undefined` for eod
 *  (§B1 — the one payload kind with no order to point at). */
export function printJobOrderIdOf(payload: PrintJobPayload): string | undefined {
  return payload.kind === "eod" ? undefined : payload.snapshot._id;
}

/** Pure. Deterministic dedupe key so a retried enqueue collapses to one doc;
 *  `undefined` (field omitted, never "") where a repeat is DELIBERATE. */
export function printJobKeyOf(payload: PrintJobPayload): string | undefined {
  switch (payload.kind) {
    case "kot":
      // A whole-tab reprint (round:null) is a staff-requested duplicate, not
      // a fresh kitchen instruction — deliberately repeatable, no key.
      return payload.round === null ? undefined : `kot:${payload.snapshot._id}:${payload.round}`;
    // bill/void/moved: `reprint:true` mirrors `kot`'s `round: null` — a
    // reprint is a staff-requested duplicate that must ALWAYS get a fresh
    // job; the dedupe fence exists only to collapse a RETRY of the SAME
    // first-time enqueue (else it collides E11000 with the still-"printed"
    // original for the full 2h retention window, and "Print bill" silently
    // does nothing). PH-4/PH-6's routing wrapper MUST set `reprint: true` on
    // every reprint path.
    case "bill":
      return payload.reprint === true ? undefined : `bill:${payload.snapshot._id}`;
    case "void":
      // §B1 originally wrote this key as `void:<orderId>:<voidsLength>`, but
      // the voids-trail length is NOT in the (.strict()) snapshot and so
      // isn't derivable server-side; taking it from the request body would
      // let any caller mint an arbitrary key and dedupe-poison a future real
      // slip. `voidedAt`+`productId` is at least as strong: a retry of the
      // SAME void collapses (identical entry timestamp + line), two
      // different lines differ by `productId`.
      return payload.reprint === true
        ? undefined
        : `void:${payload.snapshot._id}:${payload.voidedAt}:${payload.line.productId}`;
    case "moved":
      return payload.reprint === true ? undefined : `moved:${payload.snapshot._id}:${payload.movedAt}`;
    case "eod":
      // A live aggregate, never a repeat-poisoned event — no key.
      return undefined;
    case "cancel-notice":
      // The stop-instruction itself; a re-notify is deliberately repeatable.
      return undefined;
  }
}

export function queuedPruneCutoff(nowMs: number): Date {
  return new Date(nowMs - PRINT_JOB_QUEUED_RETENTION_MS);
}
export function resolvedPruneCutoff(nowMs: number): Date {
  return new Date(nowMs - PRINT_JOB_RESOLVED_RETENTION_MS);
}
export function drainAgeCutoff(nowMs: number): Date {
  return new Date(nowMs - PRINT_HOST_MAX_AGE_MS);
}

// The orphan dismiss below (enqueuePrintJob step 3) is SERVER-INITIATED — a
// DELETE /api/print-host teardown that raced the create, not a decision the
// enqueuing staff member made. Stamping `input.queuedBy` there would record
// the person who fired the ticket as the person who cleared the host, which
// is false; this neutral, named actor keeps SEC-7's dismiss trail honest.
const ORPHAN_DISMISS_ACTOR = "system";

export async function enqueuePrintJob(input: {
  payload: PrintJobPayload;
  label: string;
  queuedBy: string;
}): Promise<PrintJobEnqueueResult> {
  // (1) Belt-and-braces cap — the route also 400s this; this is the single
  // write point so it fences independently of the route's own check.
  const payloadJson = JSON.stringify(input.payload);
  if (!printJobPayloadWithinCap(payloadJson)) return { outcome: "too-large" };

  // (2) No host configured ⇒ create nothing. This is the answer PH-4's
  // routing wrapper falls back to a local print on.
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("_id").lean();
  if (!host) return { outcome: "no-host" };

  const orderId = printJobOrderIdOf(input.payload);
  const jobKey = printJobKeyOf(input.payload);

  let createdId: string;
  try {
    const created = await PrintJob.create({
      // `kind` comes from the PAYLOAD's own discriminator, never a separate
      // body field, so the two can never diverge.
      kind: input.payload.kind,
      payload: payloadJson,
      label: input.label,
      queuedBy: input.queuedBy,
      // `status` defaults to "queued" in the model — never passed here.
      ...(orderId !== undefined ? { orderId } : {}),
      ...(jobKey !== undefined ? { jobKey } : {}),
    });
    createdId = String(created._id);
  } catch (error) {
    // Only a jobKey collision is recoverable; anything else (including a
    // duplicate-key error with no jobKey, which can't happen but must not be
    // silently swallowed) rethrows as an honest 500.
    if (!isDuplicateKeyError(error) || jobKey === undefined) throw error;

    const existing = await PrintJob.findOne({ jobKey }).select("status").lean();
    // Pruned in the microseconds since the write raced — do not invent a
    // success for a doc that is actually gone.
    if (!existing) throw error;
    // MERGED-10: a RESOLVED doc under this key must NEVER be reported as
    // freshly queued — it already printed (or was dismissed), so the caller
    // must not fall back to a local print believing nothing happened yet.
    if (existing.status !== "queued") return { outcome: "already-resolved", id: String(existing._id) };
    // The row was already queued by a racing writer — still nudge, since the
    // host may not have been told about it yet (a lost nudge would otherwise
    // wait out the full safety-net tick).
    publishCafeEvent("print-job");
    return { outcome: "queued", id: String(existing._id), duplicate: true };
  }

  // (3) Reciprocal guard against DELETE /api/print-host's teardown (clears
  // the host doc, THEN prunes, THEN bulk-dismisses every queued row — see
  // that route's own comment for why in that order): without this re-read, a
  // create that raced past step 2 before the clear could land AFTER the bulk
  // dismiss swept, orphaning a "queued" row no host drains or dismisses.
  // Either the teardown's updateMany sees our row (created before it swept)
  // or this re-read sees the now-missing host — this closes the
  // ORPHANED-QUEUED-ROW window specifically. It does NOT close every
  // print-nowhere window: an enqueue whose re-read sees the host still
  // present can still be dismissed by a teardown that lands immediately
  // after this read returns — an irreducible single-round-trip window
  // without a transaction. State that honestly rather than claiming the two
  // orderings together leave no window at all.
  //
  // A write that already committed (PrintJob.create above) must never be
  // reported as a failure: this whole block — the re-read AND its dependent
  // orphan dismiss/re-read — runs inside its own try/catch. A transient
  // failure anywhere in here answers "queued" (the create genuinely
  // succeeded and a host was present when we last checked), which is also
  // the one outcome that does NOT authorize a local duplicate print.
  try {
    const hostStillThere = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("_id").lean();
    if (!hostStillThere) {
      const orphanDismiss = await dismissPrintJob({
        id: createdId,
        reason: "host-cleared",
        dismissedBy: ORPHAN_DISMISS_ACTOR,
      });
      if (!orphanDismiss.dismissed) {
        // A miss here has THREE possible causes: (a) the teardown's own
        // bulk dismiss already won, (b) the prune swept the row, or (c) the
        // host claimed and printed it in this same instant. Only (c)
        // changes the answer: "no-host" is the ONE outcome that authorizes
        // a local fallback print (printJobEnqueueAllowsLocalPrint), so
        // returning it for a row that already printed would print the same
        // slip twice. Re-read the row's actual status and escalate only on
        // "printed" — (a) and (b) both still answer "no-host" honestly.
        const row = await PrintJob.findById(createdId).select("status").lean();
        if (row?.status === "printed") return { outcome: "already-resolved", id: createdId };
      }
      return { outcome: "no-host" };
    }
  } catch {
    publishCafeEvent("print-job");
    return { outcome: "queued", id: createdId, duplicate: false };
  }

  // Socket slice 2 — a job is genuinely waiting for the host. This nudge is what
  // lets the host poll at PRINT_WAKE_SOCKET_MS instead of PRINT_WAKE_FAST_MS.
  // It is FIRE-AND-FORGET past the response and can never fail this enqueue:
  // the job is already committed, and the poll still finds it if the nudge is
  // lost. Correctness stays with print-queue-claim.ts's CAS, never with this.
  publishCafeEvent("print-job");
  return { outcome: "queued", id: createdId, duplicate: false };
}

export type DismissPrintJobResult = { dismissed: true } | { dismissed: false; reason: "not-found" | "raced" };

export async function dismissPrintJob(input: {
  id: string;
  reason: PrintJobDismissReason;
  dismissedBy: string;
}): Promise<DismissPrintJobResult> {
  const dismissed = await PrintJob.findOneAndUpdate(
    {
      _id: input.id,
      // Dropping this would let a staff dismiss race a resolved job back to
      // "dismissed", overwriting a real print/earlier dismiss.
      status: "queued",
      // Dropping this would let a dismiss trample a job the host claimed in
      // the same instant — the claim CAS owns any job past this point.
      claimedAt: { $exists: false },
    },
    { $set: { status: "dismissed", dismissedAt: new Date(), dismissReason: input.reason, dismissedBy: input.dismissedBy } },
    { new: true },
  );
  if (dismissed) return { dismissed: true };

  // A lost race here is a NORMAL 200 outcome (mirrors claimKotPrint's doc
  // comment), not an error — one extra existence read tells "never existed"
  // apart from "already resolved/claimed out from under this call".
  const exists = await PrintJob.exists({ _id: input.id });
  return { dismissed: false, reason: exists ? "raced" : "not-found" };
}

/** The DELETE-host bulk teardown (§B3) — returns how many queued jobs it
 *  dismissed. This is the 5th writer of a PrintJob (§B2's reciprocal-guard
 *  list) and it carries the SAME `claimedAt:{$exists:false}` guard as the
 *  single dismiss so it can never trample a job the host claimed in the same
 *  instant. */
export async function dismissQueuedPrintJobsForClearedHost(dismissedBy: string): Promise<number> {
  const res = await PrintJob.updateMany(
    { status: "queued", claimedAt: { $exists: false } },
    { $set: { status: "dismissed", dismissedAt: new Date(), dismissReason: "host-cleared", dismissedBy } },
  );
  return res.modifiedCount ?? 0;
}

/**
 * Best-effort reap, mirroring pruneOrderRequests' discipline: retention is a
 * LAZY SWEEP, not a TTL index (ttl-guard default-deny), it deliberately
 * deletes never-printed jobs past 12h (a Friday KOT must not print Monday —
 * MERGED-14), and it filters `createdAt`, never `updatedAt` (no index on
 * updatedAt; mirrors order-request-intake.ts:57-61).
 */
export async function prunePrintJobs(nowMs: number): Promise<void> {
  try {
    await PrintJob.deleteMany({ status: "queued", createdAt: { $lt: queuedPruneCutoff(nowMs) } });
    await PrintJob.deleteMany({
      status: { $in: ["printed", "dismissed"] },
      createdAt: { $lt: resolvedPruneCutoff(nowMs) },
    });
  } catch {
    // best-effort — see comment above
  }
}

// Per-lambda-instance throttle state — a cold start merely re-arms it, which
// is fine: retention must never depend on the host device being alive
// (MERGED-14), so an occasional extra sweep after a cold start is harmless.
let lastPruneAtMs = 0;

export async function prunePrintJobsThrottled(nowMs: number): Promise<void> {
  if (nowMs - lastPruneAtMs < PRINT_JOB_PRUNE_MIN_INTERVAL_MS) return;
  // Assign BEFORE awaiting so two concurrent invocations (e.g. overlapping
  // requests) can't both pass the throttle check and both sweep at once.
  lastPruneAtMs = nowMs;
  await prunePrintJobs(nowMs);
}
