import mongoose from "mongoose";
import { PRINT_HOST_KEY, type PrintJobClaimRefusal, type PrintJobDismissReason, type PrintJobKind } from "@pos/shared/print-job";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { dismissPrintJob } from "./print-queue";

// Print-host plan (.claude/plan/v2/print-host-plan.md §B2) — the claim path:
// host-binding, pre-CAS eligibility (mirroring pos-pulse.ts's own live-state
// gates), and the claim CAS itself. Never calls connectDB() — the route does
// that first. No console.*, strict TS, no `any`.

export const PRINT_HOST_TAB_ID_MAX_CHARS = 64;

/** `claimedBy` identity: the pair, not the bare deviceId — two windows on the
 *  SAME host PC must be distinguishable (MERGED-23 / fresh-eyes F3). */
export function claimedByOf(deviceId: string, tabId: string): string {
  return `${deviceId}:${tabId}`;
}

export type PrintJobEligibility = { eligible: true } | { eligible: false; reason: PrintJobDismissReason };

/**
 * True only for the kinds whose eligibility needs the LIVE Order read — void/
 * moved/eod/cancel-notice print REGARDLESS, so the claim must not spend an
 * Order read on them (M0 read budget).
 */
export function printJobNeedsOrderRead(payload: PrintJobPayload): boolean {
  return payload.kind === "bill" || (payload.kind === "kot" && payload.round !== null);
}

/**
 * Pure pre-CAS eligibility (§B2), mirroring pos-pulse.ts's own live-state
 * gates (claimKotPrint). Exhaustive switch — no `default`, so a future kind
 * is a compile error.
 */
export function printJobEligibility(
  payload: PrintJobPayload,
  order: { status: string; items: { kotRound: number }[] } | null,
): PrintJobEligibility {
  switch (payload.kind) {
    case "kot": {
      // A whole-tab REPRINT (round:null) is a staff-requested duplicate, not
      // a fresh kitchen instruction — prints regardless (MERGED-04).
      if (payload.round === null) return { eligible: true };
      if (order === null || order.status === "Cancelled") return { eligible: false, reason: "order-cancelled" };
      // A full-line void REMOVES the line — no lines left in this round means
      // there is nothing left to fire.
      const roundHasLines = order.items.some((it) => it.kotRound === payload.round);
      if (!roundHasLines) return { eligible: false, reason: "round-voided" };
      return { eligible: true };
    }
    case "bill":
      // A staff-requested REPRINT is a deliberate duplicate of a document
      // that already exists, not a fresh billing instruction — mirrors the
      // kot branch's round:null early return, immediately above. It is safe
      // precisely BECAUSE the reprint carries a FRESH snapshot whose
      // `status` is "Cancelled" when the order was since cancelled, so
      // OrderReceipt's *** CANCELLED *** banner fires on the paper — which
      // is the whole reason §B2 routes the cancelled-bill recovery through
      // a reprint (see the Orders-sheet reprint path). Must be checked
      // BEFORE the cancelled-order gate below, or this exact recovery path
      // gets dismissed as if it were a fresh bill.
      if (payload.reprint === true) return { eligible: true };
      // MERGED-02: unlike a void, a FIRST-TIME (non-reprint) bill must NOT
      // print regardless of live order state — OrderReceipt's
      // *** CANCELLED *** banner reads the FROZEN snapshot, which still
      // says "Completed" for a first-time bill, so a post-enqueue cancel
      // could never surface on the paper. Recovery is the reprint branch
      // above, not this one.
      if (order === null || order.status === "Cancelled") return { eligible: false, reason: "order-cancelled" };
      return { eligible: true };
    case "void":
    case "moved":
      // A void slip IS a stop-instruction; a moved slip is an audit artifact
      // — both print regardless.
      return { eligible: true };
    case "cancel-notice":
      // It IS the stop-instruction; there is no round to be empty.
      return { eligible: true };
    case "eod":
      // Readiness is CLIENT TanStack state the server cannot read (fresh-eyes
      // F11) — the CAS runs UNCONDITIONALLY here; the skip-predicate lives in
      // PH-5's drain, not in server-side eligibility.
      return { eligible: true };
  }
}

export interface ClaimedPrintJob {
  id: string;
  kind: PrintJobKind;
  label: string;
  orderId?: string;
  createdAt: string;
  payload: PrintJobPayload;
}

export type ClaimPrintJobResult =
  | { claimed: true; job: ClaimedPrintJob }
  | { claimed: false; reason: PrintJobClaimRefusal };

export async function claimPrintJob(input: {
  id: string;
  deviceId: string;
  tabId: string;
  // The session staff name (route reads it off `authed.session.user.name`,
  // never the request body) — stamped on every automatic dismiss this
  // function performs. Distinct from `claimedBy` (below), which stays the
  // `deviceId:tabId` pair — that is a DIFFERENT field with a different
  // purpose (§B1/MERGED-23): `dismissedBy` is the actor-trail name SEC-7
  // requires, `claimedBy` disambiguates two windows on the same host PC.
  dismissedBy: string;
}): Promise<ClaimPrintJobResult> {
  // 1. Server-side host binding (MERGED-06): stops an ACCIDENTAL non-host
  // claim (e.g. the band's stale-job Print button firing from a phone).
  // deviceId is an opaque client-held UUID, not a credential — Q6's trust
  // model already accepts any logged-in staff, so this is HTTP 200, not 403.
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
  if (!host || host.deviceId !== input.deviceId) return { claimed: false, reason: "not-host" };

  // 2. Job must still be queued — a job already resolved (printed/dismissed)
  // by another path is a lost race, not a fresh claim target.
  const job = await PrintJob.findById(input.id).select("kind label orderId payload status createdAt").lean();
  if (!job) return { claimed: false, reason: "not-found" };
  if (job.status !== "queued") return { claimed: false, reason: "raced" };

  // 3. The payload was Zod-validated at enqueue, so a parse failure here only
  // fires on deploy-skew/corruption. Dismissed (not left queued) because the
  // drain always takes the OLDEST D1 candidate — one unparseable row would
  // otherwise block every fresher slip for the full 30-minute staleness
  // window.
  let parsedPayload: PrintJobPayload;
  try {
    const raw: unknown = JSON.parse(job.payload);
    const result = printJobPayloadSchema.safeParse(raw);
    if (!result.success) {
      await dismissPrintJob({ id: input.id, reason: "invalid-payload", dismissedBy: input.dismissedBy });
      return { claimed: false, reason: "invalid-payload" };
    }
    parsedPayload = result.data;
  } catch {
    await dismissPrintJob({ id: input.id, reason: "invalid-payload", dismissedBy: input.dismissedBy });
    return { claimed: false, reason: "invalid-payload" };
  }

  // 4. Eligibility runs strictly BEFORE the CAS (mirrors claimKotPrint's own
  // ordering — the -review-pins suite pins this for the CR2.3 twin).
  const needsOrderRead = printJobNeedsOrderRead(parsedPayload);
  // Arbiter-confirmed (mongoose 8.24.0/bson 6.10.4, live probe): Order.findById
  // on an uncastable id ("abc", "", "hello world!") doesn't throw
  // synchronously — it REJECTS at the `await`, escaping past this file's
  // try/catch boundaries (there are none around this read) straight to the
  // route's catch → HTTP 500, with the claim CAS never having run so the row
  // stays "queued" occupying the drain head. Gate on isValidObjectId first,
  // exactly like the claim route already gates its own `[id]` path param,
  // and DISMISS (not left queued, and NOT wrapped in try/catch — a genuine DB
  // error below must still surface as a 500) so one poison row can never
  // block the drain for the 30-minute staleness window.
  if (needsOrderRead && job.orderId !== undefined && !mongoose.isValidObjectId(job.orderId)) {
    await dismissPrintJob({ id: input.id, reason: "invalid-payload", dismissedBy: input.dismissedBy });
    return { claimed: false, reason: "invalid-payload" };
  }
  const order =
    needsOrderRead && job.orderId !== undefined
      ? await Order.findById(job.orderId).select("status items.kotRound").lean()
      : null;
  const eligibility = printJobEligibility(parsedPayload, order);
  if (!eligibility.eligible) {
    await dismissPrintJob({
      id: input.id,
      reason: eligibility.reason,
      dismissedBy: input.dismissedBy,
    });
    return { claimed: false, reason: "not-eligible" };
  }

  // 5. The claim CAS, verbatim per §B2. `status:"queued"` + `claimedAt:
  // {$exists:false}` together fence against a concurrent claim/dismiss/prune
  // — dropping either would let two racers both "win". Nothing ever $unsets
  // `claimedAt` (a lost print is a visible manual reprint, not a reopened
  // claim). `status:"printed"` here means CLAIM WON / host accepted, NOT
  // proof paper exists (MERGED-10) — the readback in §B7 reports outcome.
  const claimed = await PrintJob.findOneAndUpdate(
    { _id: input.id, status: "queued", claimedAt: { $exists: false } },
    { $set: { status: "printed", claimedAt: new Date(), claimedBy: claimedByOf(input.deviceId, input.tabId) } },
    { new: true },
  );
  if (!claimed) return { claimed: false, reason: "raced" };

  // 6. The parsed payload rides the claim RESPONSE — exactly why D1/D2 carry
  // metadata only and the 20s pulse stays tiny.
  return {
    claimed: true,
    job: {
      id: String(claimed._id),
      kind: claimed.kind,
      label: claimed.label,
      ...(claimed.orderId !== undefined ? { orderId: claimed.orderId } : {}),
      createdAt: claimed.createdAt.toISOString(),
      payload: parsedPayload,
    },
  };
}
