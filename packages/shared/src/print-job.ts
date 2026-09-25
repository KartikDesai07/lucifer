// ─────────────────────────────────────────────────────────────────────────────
// Print-host plan, PH-1 — the shared contract. Single-homed here (#31) because
// the cafe SERVER (enqueue/claim/dismiss/prune, pos-pulse) and the cafe CLIENT
// (print routing, the drain, the band readback) must agree on the same job/
// host shapes and thresholds without importing each other's private state.
// Pure and client-safe (no Node/DB imports) — see
// `.claude/plan/v2/print-host-plan.md` §B1/§B4 for the design this mirrors.
// ─────────────────────────────────────────────────────────────────────────────

import type { z } from "zod";
import type { printOrderSnapshotSchema } from "./schemas/print-job.schema";
import type { Order } from "./types";

/** The five thermal documents + reprint/notice paths a `PrintJob` can carry.
 *  `"cancel-notice"` is the "Notify Kitchen" stop for an already-cancelled
 *  order — distinct from a line-level `"void"`. */
export const PRINT_JOB_KINDS = ["kot", "bill", "void", "moved", "eod", "cancel-notice"] as const;
export type PrintJobKind = (typeof PRINT_JOB_KINDS)[number];

/** `"printed"` means claim won / host accepted — NOT proof paper exists (§B2).
 *  `"dismissed"` covers staff dismiss, a cancelled order/round, and the
 *  host-cleared bulk dismiss. */
export const PRINT_JOB_STATUSES = ["queued", "printed", "dismissed"] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

/** Why a job was torn down without ever printing (§B1). Cross-party: the cafe
 *  SERVER stamps these (dismiss route, DELETE-clear, pre-CAS eligibility) and
 *  the CLIENT band discriminates on `"staff"` for its "Cancelled at host"
 *  readback (§B7) — so the list single-homes here, not in the Mongoose model
 *  (PH-2 review, MED). `"host-cleared"` is the bulk clear-host dismiss.
 *  `"invalid-payload"` (PH-3) is stamped by the claim path when a stored
 *  `payload` no longer parses against `printJobPayloadSchema` (a deploy-skew /
 *  corruption case) — dismissed rather than left queued, so one poison row can
 *  never block the drain head. */
export const PRINT_JOB_DISMISS_REASONS = [
  "order-cancelled",
  "round-voided",
  "staff",
  "host-cleared",
  "invalid-payload",
] as const;
export type PrintJobDismissReason = (typeof PRINT_JOB_DISMISS_REASONS)[number];

/** The one `PrintHost` singleton document's key — designating a host replaces
 *  whatever this key currently points at (`{key:1}` unique). */
export const PRINT_HOST_KEY = "primary";

/** A queued job older than this never appears in the drain feed (D1) at all —
 *  it moves to the stale band (D2) instead. Owner Q13. */
export const PRINT_HOST_MAX_AGE_MS = 30 * 60 * 1000;

/** A host is reported offline after missing this many beats. Sized as 3 missed
 *  ~60s THROTTLED beats (Chrome throttles an occluded/hidden window's 20s
 *  foreground cadence down to ~60s) — NOT 20s×4.5, which would understate
 *  real occluded-window latency (design review MERGED-15). */
export const PRINT_HOST_OFFLINE_MS = 180 * 1000;

/** Drain feed (D1) row cap per pulse tick. Owner Q16. */
export const PRINT_JOB_PULSE_LIMIT = 10;

/** Stale-band feed (D2) row cap — distinct from the drain limit so a deep
 *  stale backlog can never crowd the drain's own slots (design review
 *  MERGED-01). */
export const PRINT_JOB_STALE_LIMIT = 20;

/** Resolved feed (D3) row cap — sizes the per-order readback's own bounded read. */
export const PRINT_JOB_RESOLVED_LIMIT = 20;

/** The band renders at most this many stale-job Print buttons before folding
 *  the rest behind a "+k older — reprint from Orders" link (§B7). */
export const PRINT_BAND_MAX_STALE_BUTTONS = 3;

/** `PrintJob.payload` (a JSON string) fenced under this many bytes so it
 *  can never bloat the free-tier cluster. */
export const PRINT_JOB_PAYLOAD_MAX_BYTES = 64 * 1024;

/** `PrintJob.label` is UI-only ("KOT round 2 · T-4") and never printed. Bound
 *  single-homed here because BOTH the enqueue route's Zod schema and the
 *  CLIENT's label builder must agree: a long product name in a void label that
 *  overshoots this 400s the enqueue, and the slip then prints NOWHERE. */
export const PRINT_JOB_LABEL_MAX_CHARS = 120;

/** How long a resolved (`printed`/`dismissed`) job stays in the D3 readback
 *  window before the lazy prune sweep drops it. */
export const PRINT_JOB_RESOLVED_RETENTION_MS = 2 * 60 * 60 * 1000;

/** A never-claimed `queued` job older than this is pruned outright — a Friday
 *  KOT must not print Monday (design review MERGED-14). */
export const PRINT_JOB_QUEUED_RETENTION_MS = 12 * 60 * 60 * 1000;

/** Minimum gap between opportunistic `prunePrintJobs` sweeps fired from the
 *  enqueue/designate/clear routes — retention must never depend on a live beat. */
export const PRINT_JOB_PRUNE_MIN_INTERVAL_MS = 5 * 60 * 1000;

// `KIOSK_SILENT_MAX_MS` deliberately NOT defined here — open question §E R6
// (capped drop SF-11): the attestation handshake ships, an un-probed drift
// threshold does not, until PH-0(d) measures a real `dt` on the cafe PC.

/** Band warning: host configured but attested NOT silent (a dialog appears at
 *  the host PC for every job) — a warning, not a hard stop; printing still
 *  routes there. */
export const PRINT_HOST_SILENT_OFF_WARNING = "Print host shows a dialog for every slip.";

/** Band warning: the configured host has missed its heartbeat past
 *  `PRINT_HOST_OFFLINE_MS` — jobs still queue and drain once it returns. */
export const PRINT_HOST_OFFLINE_WARNING = "Print host offline — slips will print when it is back.";

/** Host-aware limitation line (design review MERGED-22), replacing
 *  `SELF_ORDER_ALERT_LIMITATION` once a host is configured — that legacy line
 *  wrongly implies THIS panel must stay open for auto-print. `<label>` is the
 *  literal, verbatim-pinnable placeholder; `printHostActiveNote` substitutes it. */
export const PRINT_HOST_ACTIVE_NOTE = "Slips print at <label>.";

export function printHostActiveNote(label: string): string {
  return PRINT_HOST_ACTIVE_NOTE.replace("<label>", label);
}

/** `PrintHost`'s wire shape (ISO strings, never `Date`). `offline` is
 *  SERVER-computed vs. stored `lastSeenAt`, never the client's own clock
 *  (MERGED-15). `silentProbeMs` stays server-side only. */
export interface PrintHostState {
  configured: boolean;
  deviceId: string | null;
  label: string | null;
  lastSeenAt: string | null;
  offline: boolean;
  silentMode: boolean;
}

/** One row of the D1 (drain) or D2 (stale-band) feed — metadata only, the
 *  full payload comes back from the claim POST. `orderId` absent for `eod`. */
export interface PrintJobFeedRow {
  id: string;
  kind: PrintJobKind;
  label: string;
  orderId?: string;
  createdAt: string;
}

/** One row of the D3 (resolved) feed — narrower than D1/D2, purpose-built for
 *  the per-order readback. `dismissReason` is narrowed to `PrintJobDismissReason`
 *  (not a bare `string`) so PH-8's band can exhaustively switch on `"staff"`
 *  without a typo silently falling through its default branch. */
export interface PrintJobResolvedRow {
  id: string;
  status: "printed" | "dismissed";
  dismissReason?: PrintJobDismissReason;
}

/** The enqueue outcome (§B2/§B4), single-homed here because BOTH the server
 *  (enqueuePrintJob) and every future client caller (PH-4's routing wrapper,
 *  PH-8's readback) must branch on the SAME discriminant. A two-field
 *  `{queued, reason}` shape let `"no-host"` (print locally NOW) and
 *  `"already-resolved"` (do NOT print locally — the host already printed
 *  this) collapse onto the same `queued:false`, so a caller branching on the
 *  natural `if (!result.queued)` discriminant would double-print. A single
 *  `outcome` discriminant forces an exhaustive switch instead — there is no
 *  "natural wrong branch" left (repo memories `enum-reuse-across-opposite-
 *  semantics`, `helper-null-verdict-discarded-at-call-site`).
 *  `"already-resolved"` carries the EXISTING row's `id` so PH-8's readback
 *  can still track the job the tap referred to. */
export type PrintJobEnqueueResult =
  | { outcome: "queued"; id: string; duplicate: boolean }
  | { outcome: "no-host" }
  | { outcome: "already-resolved"; id: string }
  | { outcome: "too-large" };

/** `"no-host"` is the ONLY outcome that permits a local fallback print — every
 *  other non-"queued" outcome (`"already-resolved"`, `"too-large"`) means the
 *  slip must NOT be printed locally (the enqueue either already happened
 *  under a prior key, or was rejected outright). Exists so PH-4's routing
 *  wrapper cannot get this rule wrong by re-deriving it inline. */
export function printJobEnqueueAllowsLocalPrint(outcome: PrintJobEnqueueResult["outcome"]): boolean {
  return outcome === "no-host";
}

/** The claim path's refusal reasons (§B2/§B5), single-homed here because both
 *  the server (claimPrintJob) and PH-5's drain must agree on the set. */
export type PrintJobClaimRefusal = "not-host" | "not-found" | "raced" | "not-eligible" | "invalid-payload";

/** True when a host should be reported offline: no `lastSeenAt`, a malformed
 *  one, or one older than `offlineMs` — same malformed-timestamp discipline as
 *  `self-order-alert.ts`'s `parseMsOrNull`. */
export function printHostOffline(
  lastSeenAtIso: string | null,
  nowMs: number,
  offlineMs: number = PRINT_HOST_OFFLINE_MS,
): boolean {
  if (lastSeenAtIso === null) return true;
  const lastSeenMs = Date.parse(lastSeenAtIso);
  if (Number.isNaN(lastSeenMs)) return true;
  return nowMs - lastSeenMs > offlineMs;
}

/**
 * Picks the OLDEST eligible queued job to drain next (kitchen order — first
 * queued, first printed), mirroring `autoPrintCandidate`'s shape. A malformed
 * `createdAt` is skipped rather than throwing. Boundary: age === `maxAgeMs` is
 * still eligible (only strictly-over is excluded) — the D1/D2 split's own
 * boundary, so a job at exactly 30 minutes still drains, not falls stale.
 */
export function printJobDrainCandidate(
  rows: PrintJobFeedRow[],
  nowMs: number,
  maxAgeMs: number,
): PrintJobFeedRow | null {
  let oldest: PrintJobFeedRow | null = null;
  let oldestMs = Infinity;

  for (const row of rows) {
    const createdMs = Date.parse(row.createdAt);
    if (Number.isNaN(createdMs)) continue;
    if (nowMs - createdMs > maxAgeMs) continue;
    if (createdMs < oldestMs) {
      oldestMs = createdMs;
      oldest = row;
    }
  }

  return oldest;
}

/** True when a payload JSON string fits under `PRINT_JOB_PAYLOAD_MAX_BYTES`,
 *  measured in BYTES (TextEncoder), not characters. */
export function printJobPayloadWithinCap(payloadJson: string): boolean {
  return new TextEncoder().encode(payloadJson).length <= PRINT_JOB_PAYLOAD_MAX_BYTES;
}

/** The render-complete order snapshot a `PrintJobPayload` carries — type-only
 *  import of the schema's Zod-inferred shape keeps this module Zod-free. */
export type PrintOrderSnapshot = z.infer<typeof printOrderSnapshotSchema>;

/** Picks the render-complete fields `OrderReceipt`/`KOTReceipt` (plus
 *  `orderItemLabel`/`receiptGst` and the props `use-pos-print.ts` synthesizes)
 *  need WITHOUT the live Order — the host rebuilds every renderer prop from
 *  this snapshot alone (§B1). Uses the cafe receipts' own `Order` (`./types`). */
export function printOrderSnapshot(order: Order): PrintOrderSnapshot {
  const {
    _id, orderId, customerName, subtotal, discount, discountKind, gstAmount, gstRate, gstMode,
    chargeAmount, chargeLabel, total, paidAmount, payment, splitCash, splitOnline,
    status, receiver, tableNo, billNumber, kotRounds, kotNumbers, cancelReason,
    createdAt, notes,
  } = order;
  return {
    _id, orderId, customerName, subtotal, discount, discountKind, gstAmount, gstRate, gstMode,
    chargeAmount, chargeLabel, total, paidAmount, payment, splitCash, splitOnline,
    status, receiver, tableNo, billNumber, kotRounds, kotNumbers, cancelReason,
    createdAt, notes,
    items: order.items.map((item) => {
      const { productId, name, price, qty, variation, modifiers, instructions, kotRound } = item;
      // CB-5B S14 — `reward`/`note` ride along so a host-printed slip is the
      // same paper as a locally-printed one. OMIT-EMPTY, never explicit
      // `undefined` keys: `.strict()` accepts an absent optional but the
      // snapshot is also compared and hashed, so writing dead keys onto every
      // ordinary line would change every payload for the sake of the rare one.
      return {
        productId, name, price, qty, variation, modifiers, instructions, kotRound,
        ...(item.reward === true ? { reward: true as const } : {}),
        ...(item.note ? { note: item.note } : {}),
      };
    }),
  };
}

// CB-U1 — the host's adaptive wake poll. Amends print-host-plan.md's "no
// second 20s poll from every tab" (§B4): this poll runs on ONE tab only — the
// lock-holding draining host — and answers with a pending flag plus the newest
// drain-eligible job's id (a change signal, never a payload). FAST while the
// host has seen a feed change within the active window, SLOW otherwise;
// hidden tabs don't fetch at all (refetchIntervalInBackground:false).
export const PRINT_WAKE_FAST_MS = 3000;
export const PRINT_WAKE_SLOW_MS = 15000;
export const PRINT_WAKE_ACTIVE_WINDOW_MS = 60 * 60 * 1000;
// Wake hits per cafe-day per device (12 h at the FAST cadence). A best-effort,
// per-device cost guard kept in localStorage AND in memory (see
// use-print-host-wake.ts) on top of the real bounds — the 3 s floor, the
// visible-tab gate, the one-lock-holder gate; past the cap the poll degrades
// to SLOW and stops fetching until the next cafe-day.
export const PRINT_WAKE_DAILY_CAP = 14400;
/** GET /api/print-jobs/wake — `newestId` is the newest drain-eligible
 *  PrintJob's own id (null when nothing is pending): the host invalidates its
 *  pulse only when this CHANGES, i.e. once per new job, never once per tick. */
export interface PrintWakeData {
  pending: boolean;
  newestId: string | null;
}
