// ─────────────────────────────────────────────────────────────────────────────
// Printing redesign, Phase 1 (docs/superpowers/specs/2026-10-02-printing-
// reliability-design.md §7): the print-job lifecycle. A job counts as printed
// only when the device that wrote it acknowledges the write. Each transition is
// a PURE plan here, unit-tested row by row against spec §7.2; the server applies
// a plan with ONE compare-and-set on {_id, status, epoch} (apps/cafe/lib/
// print-lease.ts), so a racing writer makes the CAS miss instead of causing a
// second transition. Pure and client-safe: no Node, DB or zod imports.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PRINT_HOST_MAX_AGE_MS,
  type PrintJobDismissReason,
  type PrintJobKind,
  type PrintJobStatus,
} from "./print-job";
import type { PrintJobPayload } from "./schemas/print-job.schema";

/** A lease covers rendering (the 12 s raster deadline) plus the device write deadline (70 s). */
export const PRINT_LEASE_MS = 90_000;
/** The wait after a refusal made before any byte was sent: 2 s, 5 s, 10 s, then every 30 s. */
export const PRINT_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000] as const;
/** Retries stop once a job may have printed this many times, or was leased this many times (§7.8). */
export const PRINT_MAX_UNCERTAIN_ATTEMPTS = 3;
export const PRINT_MAX_ATTEMPTS = 8;
/** A KOT still not printed this long after it was created sounds the alarm (§10). */
export const PRINT_KOT_ALARM_MS = 20_000;
/** A device whose last heartbeat is older than this is offline (§6.4). */
export const PRINT_DEVICE_ONLINE_MS = 90_000;
/** The heartbeat writes a device's PrintDevice row at most this often (the Atlas M0 write budget, §10). */
export const PRINT_DEVICE_HEARTBEAT_WRITE_MS = 30_000;
/** The sweep runs at most this often per server instance, riding requests that already exist (§17.3: never Vercel Cron). */
export const PRINT_SWEEP_MIN_INTERVAL_MS = 60_000;
/** An agent retries an unanswered "printed" ack this often, for at most PRINT_ACK_PENDING_MAX_MS (§7.9). */
export const PRINT_ACK_RETRY_MS = 5_000;
export const PRINT_ACK_PENDING_MAX_MS = 10 * 60 * 1000;
/** The window of its own jobs an ordering device's readback follows (§7.3 myRecentJobs). */
export const PRINT_MY_RECENT_WINDOW_MS = 15 * 60 * 1000;
/** PrintJob.log keeps only the newest entries (M0 storage). */
export const PRINT_JOB_LOG_MAX = 20;
/** An agent's failure text, stored for staff, is cut to this. */
export const PRINT_ACK_ERROR_MAX_CHARS = 200;
/** The repair sweep re-creates a server-owned KOT round's missing job for this long after the round
 *  fired (§7.4 step 2). It is the stale window, so a repaired slip is never older than one that would
 *  need a staff tap. */
export const PRINT_REPAIR_WINDOW_MS = 30 * 60 * 1000;

/** Banner labels in print order ("BACKUP PRINTER · REPRINT", §7.7). Labels are only ever added. */
export const PRINT_JOB_LABELS = ["BACKUP PRINTER", "REPRINT", "DUPLICATE"] as const;
export type PrintJobLabel = (typeof PRINT_JOB_LABELS)[number];

/** PrintJob.log events: spec §6.5, plus "retried" for Print again / Print now. */
export const PRINT_JOB_LOG_EVENTS = [
  "created",
  "leased",
  "printed",
  "failed",
  "expired",
  "retargeted",
  "confirmed",
  "dismissed",
  "late-ack",
  "retried",
] as const;
export type PrintJobLogEvent = (typeof PRINT_JOB_LOG_EVENTS)[number];

export interface PrintJobLogEntry {
  at: Date;
  event: PrintJobLogEvent;
  deviceId?: string;
  detail?: string;
}

export interface PrintJobLease {
  deviceId: string;
  tabId: string;
  epoch: number;
  expiresAt: Date;
}

/** A job's lifecycle fields, normalised by lifecycleOf. */
export interface PrintJobLifecycle {
  kind: PrintJobKind;
  status: PrintJobStatus;
  epoch: number;
  attempts: number;
  uncertainAttempts: number;
  nextAttemptAt: Date;
  labels: PrintJobLabel[];
  createdAt: Date;
  approvedAt?: Date;
  lease?: PrintJobLease;
}

/** What a lean PrintJob read returns. A row written before Phase 1 has no counters at all. */
export interface PrintJobLifecycleDoc {
  kind: PrintJobKind;
  status: PrintJobStatus;
  createdAt: Date;
  epoch?: number;
  attempts?: number;
  uncertainAttempts?: number;
  nextAttemptAt?: Date;
  labels?: string[];
  approvedAt?: Date;
  lease?: PrintJobLease;
}

/** The fields a transition may $set. */
export interface PrintJobSet {
  status?: PrintJobStatus;
  epoch?: number;
  attempts?: number;
  uncertainAttempts?: number;
  nextAttemptAt?: Date;
  labels?: PrintJobLabel[];
  lease?: PrintJobLease;
  approvedAt?: Date;
  printedAt?: Date;
  printedBy?: string;
  lastError?: string;
  dismissedAt?: Date;
  dismissReason?: PrintJobDismissReason;
  dismissedBy?: string;
}
export type PrintJobUnsetPath = "lease" | "lastError";

/** One transition: what it writes, its one log entry, and the status it ends in. */
export interface PrintJobPatch {
  status: PrintJobStatus;
  set: PrintJobSet;
  unset: PrintJobUnsetPath[];
  log: PrintJobLogEntry;
}

/** Why a transition was refused. Every refusal is a normal outcome, never an error. */
export type PrintJobRefusal =
  | "wrong-status"
  | "stale"
  | "not-due"
  | "over-limits"
  | "lease-held"
  | "not-leased"
  | "stale-epoch"
  | "resolved";
export type PrintJobPlan =
  | { ok: true; patch: PrintJobPatch }
  | { ok: false; reason: PrintJobRefusal; log?: PrintJobLogEntry };

/** An agent's report on one leased attempt (POST /api/print-jobs/[id]/ack, §7.3). */
export interface PrintJobAck {
  deviceId: string;
  epoch: number;
  outcome: "printed" | "failed";
  /** "no" only when the writer KNOWS no byte reached the printer (§7.5); anything else is "maybe". */
  sent?: "no" | "maybe";
  /** BAD_REQUEST, TOO_LARGE, a payload that cannot render: retrying cannot help. */
  permanent?: boolean;
  error?: string;
}

/** The cashier's answer to "Print the bill again?" (§7.2 needs-confirm). */
export type PrintJobDecision = "reprint" | "printed" | "dismiss";

function isPrintJobLabel(value: string): value is PrintJobLabel {
  return (PRINT_JOB_LABELS as readonly string[]).includes(value);
}

function logEntry(nowMs: number, event: PrintJobLogEvent, deviceId?: string, detail?: string): PrintJobLogEntry {
  return {
    at: new Date(nowMs),
    event,
    ...(deviceId !== undefined && deviceId !== "" ? { deviceId } : {}),
    ...(detail !== undefined && detail !== "" ? { detail } : {}),
  };
}

function planned(patch: PrintJobPatch): PrintJobPlan {
  return { ok: true, patch };
}

/** Normalises a lean read: a missing counter is 0, a legacy row is due from when it was created,
 *  and an unknown label is dropped (it would otherwise print on paper). */
export function lifecycleOf(doc: PrintJobLifecycleDoc): PrintJobLifecycle {
  return {
    kind: doc.kind,
    status: doc.status,
    epoch: doc.epoch ?? 0,
    attempts: doc.attempts ?? 0,
    uncertainAttempts: doc.uncertainAttempts ?? 0,
    nextAttemptAt: doc.nextAttemptAt ?? doc.createdAt,
    labels: (doc.labels ?? []).filter(isPrintJobLabel),
    createdAt: doc.createdAt,
    ...(doc.approvedAt !== undefined ? { approvedAt: doc.approvedAt } : {}),
    ...(doc.lease !== undefined ? { lease: doc.lease } : {}),
  };
}

/** The lifecycle fields a new job starts with (§7.2 "create"). */
export function printJobLifecycleInit(
  nowMs: number,
  labels: readonly PrintJobLabel[] = [],
): { epoch: number; attempts: number; uncertainAttempts: number; nextAttemptAt: Date; labels: PrintJobLabel[] } {
  return { epoch: 0, attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(nowMs), labels: [...labels] };
}

export function printJobCreatedLog(nowMs: number, deviceId?: string): PrintJobLogEntry {
  return logEntry(nowMs, "created", deviceId);
}

/** The wait after the attempts-th lease was refused before writing (§7.2 backoff). */
export function printBackoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), PRINT_BACKOFF_MS.length - 1);
  return PRINT_BACKOFF_MS[index];
}

export function addPrintLabel(labels: readonly PrintJobLabel[], label: PrintJobLabel): PrintJobLabel[] {
  return PRINT_JOB_LABELS.filter((known) => known === label || labels.includes(known));
}

/** The one inverted banner a slip prints at its top (§7.7), "" for none. */
export function printBannerText(labels: readonly string[]): string {
  return PRINT_JOB_LABELS.filter((known) => labels.includes(known)).join(" · ");
}

/** A repeat of a bill says DUPLICATE; a repeat of anything else says REPRINT (§7.7). */
export function printRepeatLabel(kind: PrintJobKind): PrintJobLabel {
  return kind === "bill" ? "DUPLICATE" : "REPRINT";
}

/** A client-started print that repeats paper carries its label from the start (§7.7): a whole-tab
 *  KOT reprint (round null), and every reprint:true bill, void or moved slip. */
export function printJobInitialLabels(payload: PrintJobPayload): PrintJobLabel[] {
  switch (payload.kind) {
    case "kot":
      return payload.round === null ? ["REPRINT"] : [];
    case "bill":
      return payload.reprint === true ? ["DUPLICATE"] : [];
    case "void":
    case "moved":
      return payload.reprint === true ? ["REPRINT"] : [];
    case "eod":
    case "cancel-notice":
      return [];
  }
}

export function printJobOverLimits(attempts: number, uncertainAttempts: number): boolean {
  return uncertainAttempts >= PRINT_MAX_UNCERTAIN_ATTEMPTS || attempts >= PRINT_MAX_ATTEMPTS;
}

/** Stale is derived, never stored (§7.2): a queued job over 30 minutes old that staff never
 *  approved. Exactly 30 minutes is still fresh (the D1/D2 boundary rule). */
export function printJobStale(job: Pick<PrintJobLifecycle, "status" | "createdAt" | "approvedAt">, nowMs: number): boolean {
  return job.status === "queued" && job.approvedAt === undefined && nowMs - job.createdAt.getTime() > PRINT_HOST_MAX_AGE_MS;
}

function failed(nowMs: number, set: PrintJobSet, deviceId: string | undefined, detail: string): PrintJobPatch {
  return { status: "failed", set: { status: "failed", ...set }, unset: ["lease"], log: logEntry(nowMs, "failed", deviceId, detail) };
}

/** An attempt that may have reached paper (a "maybe" failure, or an expired lease). */
function afterUncertain(
  job: PrintJobLifecycle,
  nowMs: number,
  event: "failed" | "expired",
  deviceId: string | undefined,
  detail: string,
): PrintJobPatch {
  const uncertainAttempts = job.uncertainAttempts + 1;
  if (printJobOverLimits(job.attempts, uncertainAttempts)) {
    return failed(nowMs, { uncertainAttempts, lastError: detail }, deviceId, `limits: ${detail}`);
  }
  const log = logEntry(nowMs, event, deviceId, detail);
  if (job.kind === "bill") {
    // A bill that may already be on paper is never reprinted by itself: the cashier decides (D3).
    return { status: "needs-confirm", set: { status: "needs-confirm", uncertainAttempts, lastError: detail }, unset: ["lease"], log };
  }
  return {
    status: "queued",
    set: {
      status: "queued",
      uncertainAttempts,
      labels: addPrintLabel(job.labels, "REPRINT"),
      nextAttemptAt: new Date(nowMs + printBackoffMs(job.attempts)),
      lastError: detail,
    },
    unset: ["lease"],
    log,
  };
}

function printedPatch(nowMs: number, by: string, event: "printed" | "late-ack" | "confirmed", detail?: string): PrintJobPatch {
  return {
    status: "printed",
    set: { status: "printed", printedAt: new Date(nowMs), printedBy: by },
    unset: ["lease", "lastError"],
    log: logEntry(nowMs, event, event === "confirmed" ? undefined : by, detail),
  };
}

/** queued → leased (§7.2). The caller has already put this job at the head of its line (§7.6). */
export function planLease(job: PrintJobLifecycle, who: { deviceId: string; tabId: string }, nowMs: number): PrintJobPlan {
  if (job.status !== "queued") return { ok: false, reason: "wrong-status" };
  if (printJobStale(job, nowMs)) return { ok: false, reason: "stale" };
  if (printJobOverLimits(job.attempts, job.uncertainAttempts)) return { ok: false, reason: "over-limits" };
  if (job.nextAttemptAt.getTime() > nowMs) return { ok: false, reason: "not-due" };
  const epoch = job.epoch + 1;
  return planned({
    status: "leased",
    set: {
      status: "leased",
      epoch,
      attempts: job.attempts + 1,
      lease: { deviceId: who.deviceId, tabId: who.tabId, epoch, expiresAt: new Date(nowMs + PRINT_LEASE_MS) },
    },
    unset: [],
    log: logEntry(nowMs, "leased", who.deviceId),
  });
}

/** leased → (lease ran out) the same as a "maybe sent" failure (§7.2). */
export function planExpiry(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status !== "leased" || job.lease === undefined) return { ok: false, reason: "wrong-status" };
  if (job.lease.expiresAt.getTime() >= nowMs) return { ok: false, reason: "lease-held" };
  return planned(afterUncertain(job, nowMs, "expired", job.lease.deviceId, "lease expired: may have printed"));
}

/** The writer's report (§7.2 ack rows, §7.9 late acks). Idempotent per (job, epoch). */
export function planAck(job: PrintJobLifecycle, ack: PrintJobAck, nowMs: number): PrintJobPlan {
  if (job.status === "leased" && job.epoch === ack.epoch) {
    if (ack.outcome === "printed") return planned(printedPatch(nowMs, ack.deviceId, "printed"));
    const error = (ack.error ?? "").trim().slice(0, PRINT_ACK_ERROR_MAX_CHARS) || (ack.sent === "no" ? "nothing was sent" : "may have printed");
    if (ack.permanent === true) {
      const uncertainAttempts = job.uncertainAttempts + (ack.sent === "maybe" ? 1 : 0);
      return planned(failed(nowMs, { uncertainAttempts, lastError: error }, ack.deviceId, `permanent: ${error}`));
    }
    if (ack.sent === "no") {
      if (printJobOverLimits(job.attempts, job.uncertainAttempts)) {
        return planned(failed(nowMs, { lastError: error }, ack.deviceId, `limits: ${error}`));
      }
      return planned({
        status: "queued",
        set: { status: "queued", nextAttemptAt: new Date(nowMs + printBackoffMs(job.attempts)), lastError: error },
        unset: ["lease"],
        log: logEntry(nowMs, "failed", ack.deviceId, `not sent: ${error}`),
      });
    }
    return planned(afterUncertain(job, nowMs, "failed", ack.deviceId, error));
  }
  if (job.status === "printed" || job.status === "dismissed") return { ok: false, reason: "resolved" };
  if (ack.outcome === "printed") {
    // The write succeeded after the lease ran out, and nobody leased the job since (§7.9).
    if (job.epoch === ack.epoch) return planned(printedPatch(nowMs, ack.deviceId, "late-ack"));
    return {
      ok: false,
      reason: "stale-epoch",
      log: logEntry(nowMs, "late-ack", ack.deviceId, `ignored: epoch ${ack.epoch}, job at ${job.epoch}`),
    };
  }
  return { ok: false, reason: job.status === "leased" ? "stale-epoch" : "not-leased" };
}

/** needs-confirm → the cashier's decision (§7.2). */
export function planConfirm(job: PrintJobLifecycle, decision: PrintJobDecision, staff: string, nowMs: number): PrintJobPlan {
  if (job.status !== "needs-confirm") return { ok: false, reason: "wrong-status" };
  switch (decision) {
    case "reprint":
      // Counters reset and approvedAt set: the cashier's tap is a fresh, approved attempt, so the
      // copy is neither parked as stale nor failed by the uncertain limit it came from.
      return planned({
        status: "queued",
        set: {
          status: "queued",
          labels: addPrintLabel(job.labels, "DUPLICATE"),
          attempts: 0,
          uncertainAttempts: 0,
          nextAttemptAt: new Date(nowMs),
          approvedAt: new Date(nowMs),
        },
        unset: ["lastError"],
        log: logEntry(nowMs, "confirmed", undefined, `print again: ${staff}`),
      });
    case "printed":
      return planned(printedPatch(nowMs, staff, "confirmed", `it printed: ${staff}`));
    case "dismiss":
      return planned({
        status: "dismissed",
        set: { status: "dismissed", dismissedAt: new Date(nowMs), dismissReason: "cashier", dismissedBy: staff },
        unset: [],
        log: logEntry(nowMs, "dismissed", undefined, staff),
      });
  }
}

/** failed → queued ("Print again"), or a stale queued job → leasable ("Print now") (§7.2). */
export function planRetry(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status === "failed") {
    const labels = job.uncertainAttempts > 0 ? addPrintLabel(job.labels, printRepeatLabel(job.kind)) : job.labels;
    return planned({
      status: "queued",
      set: { status: "queued", labels, attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(nowMs), approvedAt: new Date(nowMs) },
      unset: ["lastError"],
      log: logEntry(nowMs, "retried", undefined, "print again"),
    });
  }
  if (printJobStale(job, nowMs)) {
    return planned({
      status: "queued",
      set: { approvedAt: new Date(nowMs), nextAttemptAt: new Date(nowMs) },
      unset: [],
      log: logEntry(nowMs, "retried", undefined, "print now"),
    });
  }
  return { ok: false, reason: "wrong-status" };
}

/** The sweep's limits check (§7.2): a queued job over its limits stops retrying. */
export function planLimits(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status !== "queued" || !printJobOverLimits(job.attempts, job.uncertainAttempts)) {
    return { ok: false, reason: "wrong-status" };
  }
  return planned({ status: "failed", set: { status: "failed", lastError: "too many attempts" }, unset: [], log: logEntry(nowMs, "failed", undefined, "limits") });
}
