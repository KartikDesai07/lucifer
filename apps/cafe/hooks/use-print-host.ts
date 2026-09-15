"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiSend } from "@/lib/api-client";
import type { PrintHostState, PrintJobClaimRefusal, PrintJobEnqueueResult, PrintJobKind } from "@pos/shared/print-job";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";

// ─────────────────────────────────────────────────────────────────────────────
// Print-host plan, PH-4 — the TanStack seam for the five print-host writes, one
// hook per route (`print-jobs` POST · `[id]/claim` · `[id]/dismiss` ·
// `print-host` PUT · DELETE). The heartbeat is deliberately NOT here: PH-5's
// `use-print-host-beat.ts` owns it. Only `useEnqueuePrintJob` has a PH-4 caller
// (`use-print-routing.ts`); claim/dismiss/designate/clear ship with the routes
// they mirror and are consumed by PH-5's drain, PH-7's setup and PH-8's band.
// Three house rules, followed exactly:
//  1. Every `onError` toast is HOOK-level, never a per-call `mutate()` callback
//     — a per-call one is skipped once the component that issued it unmounted
//     (a Sheet closing mid-request), swallowing the only signal that a print
//     never reached the queue (repo memory lesson).
//  2. A non-`"queued"` outcome / `claimed:false` / `dismissed:false` is DATA,
//     not an error: the caller branches on it (the enqueue via
//     `printJobEnqueueAllowsLocalPrint`) and nothing here toasts it — only a
//     THROW toasts.
//  3. No `useQueryClient`/invalidation in this slice — the 20s pulse tick IS
//     the refresh (the self-order claim precedent), PH-5/OPS-7 owns the
//     host-local invalidate. Callers depend only on the STABLE `.mutate`/
//     `.mutateAsync`: `useMutation` returns a new object identity per render.
// ─────────────────────────────────────────────────────────────────────────────

/** Deliberately NOT `ORDER_KEYS.mutation`: `PosPulseProvider` pauses the pulse
 *  poll while an order mutation is in flight, and a print write must never
 *  freeze the tick that tells this device whether a host is even alive. */
export const PRINT_JOB_KEYS = {
  all: ["print-jobs"] as const,
  mutation: ["print-jobs", "mutation"] as const,
};

// The one dismiss reason a CLIENT may assert (the route's Zod is
// `z.literal("staff")`) — the other four are server-stamped audit facts.
const DISMISS_REASON_STAFF = "staff" as const;

// Toast copy. A throw does NOT prove the write never landed
// (`never-revert-on-write-throw`), so the enqueue says "may not", not "was not".
const ENQUEUE_ERROR = "Could not reach the print queue — the slip may not have printed.";
const CLAIM_ERROR = "Could not claim that print job — it stays queued for the next drain.";
const DISMISS_ERROR = "Could not dismiss that print job — try again.";
const DESIGNATE_ERROR = "Could not set the print host — try again.";
const CLEAR_ERROR = "Could not clear the print host — try again.";

export interface EnqueuePrintJobInput { payload: PrintJobPayload; label: string }

/** POST /api/print-jobs. Resolves with the server's `outcome` discriminant —
 *  every value, `"too-large"` included, is a NORMAL 200, and the only sanctioned
 *  local-print predicate is `printJobEnqueueAllowsLocalPrint` (D-11). */
export function useEnqueuePrintJob() {
  return useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: (input: EnqueuePrintJobInput) => apiSend<PrintJobEnqueueResult>("/api/print-jobs", "POST", input),
    onError: (err: Error) => toast.error(err.message || ENQUEUE_ERROR),
  });
}

/** Client mirror of `lib/print-queue-claim.ts`'s `ClaimedPrintJob` — that lib is
 *  server-only (Mongoose models), so the shape is re-declared rather than
 *  imported, as `use-self-order-auto-print.ts` mirrors `KotClaimResult`; keep
 *  both in sync by hand (PH-10 parity-pins the pair). */
interface ClaimedPrintJob {
  id: string;
  kind: PrintJobKind;
  label: string;
  orderId?: string;
  createdAt: string;
  payload: PrintJobPayload;
}

/** Client mirror of `lib/print-queue-claim.ts`'s `ClaimPrintJobResult`.
 *  `claimed:false` is a normal 200 (lost CAS race, not the host, an ineligible
 *  row) — the drain must not error-toast it. */
type ClaimPrintJobResult = { claimed: true; job: ClaimedPrintJob } | { claimed: false; reason: PrintJobClaimRefusal };

export interface ClaimPrintJobInput { id: string; deviceId: string; tabId: string }

/** POST /api/print-jobs/[id]/claim — the drain's claim CAS. `deviceId:tabId` is
 *  what distinguishes two windows on one host PC, so both halves travel. */
export function useClaimPrintJob() {
  return useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: ({ id, ...body }: ClaimPrintJobInput) =>
      apiSend<ClaimPrintJobResult>(`/api/print-jobs/${encodeURIComponent(id)}/claim`, "POST", body),
    onError: (err: Error) => toast.error(err.message || CLAIM_ERROR),
  });
}

/** Client mirror of `lib/print-queue.ts`'s `DismissPrintJobResult`. A `"raced"`
 *  refusal (the host claimed it in the same instant) is a normal 200;
 *  `"not-found"` reaches the client as a 404 throw instead. */
type DismissPrintJobResult = { dismissed: true } | { dismissed: false; reason: "not-found" | "raced" };

/** POST /api/print-jobs/[id]/dismiss — a staff "Dismiss" tap from the band. */
export function useDismissPrintJob() {
  return useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: (id: string) =>
      apiSend<DismissPrintJobResult>(`/api/print-jobs/${encodeURIComponent(id)}/dismiss`, "POST", { reason: DISMISS_REASON_STAFF }),
    onError: (err: Error) => toast.error(err.message || DISMISS_ERROR),
  });
}

export interface DesignatePrintHostInput { deviceId: string; label: string }

/** PUT /api/print-host — designates a device as THE host, replacing whatever
 *  held the role. Resolves with the resulting `PrintHostState`; a lost
 *  designation race comes back as a 409 throw. */
export function useDesignatePrintHost() {
  return useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: (input: DesignatePrintHostInput) => apiSend<PrintHostState>("/api/print-host", "PUT", input),
    onError: (err: Error) => toast.error(err.message || DESIGNATE_ERROR),
  });
}

/** DELETE /api/print-host's own `{cleared, dismissed}` envelope: whether a host
 *  doc was removed, and how many still-queued jobs its teardown dismissed. */
export interface ClearPrintHostResult {
  cleared: boolean;
  dismissed: number;
}

/** DELETE /api/print-host — reachable from ANY logged-in device, phones
 *  included: the point is recovering when the host PC is dead. No argument. */
export function useClearPrintHost() {
  return useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: () => apiSend<ClearPrintHostResult>("/api/print-host", "DELETE"),
    onError: (err: Error) => toast.error(err.message || CLEAR_ERROR),
  });
}
