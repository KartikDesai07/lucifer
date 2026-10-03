// Printing redesign, Phase 1: the agent's wire contract (spec §7.3, §9.1, §10). Shared by the cafe
// server routes and the in-page agent; pure and client-safe.

import {
  PRINT_JOB_ACTED_GRACE_MS,
  PRINT_JOB_QUEUED_RETENTION_MS,
  PRINT_WAKE_DAILY_CAP,
  PRINT_WAKE_FAST_MS,
  PRINT_WAKE_SLOW_MS,
  PRINT_WAKE_SOCKET_MS,
  type PrintJobKind,
  type PrintJobStatus,
} from "./print-job";
import type { PrintJobLabel, PrintJobRefusal } from "./print-lifecycle";
import type { PrintJobPayload } from "./schemas/print-job.schema";

/** The header a device names itself with on print requests (spec §6.5 originDeviceId). */
export const PRINT_DEVICE_ID_HEADER = "x-pos-device-id";
/** A print the client starts (reprint, EOD, cancel notice) carries this key (spec §7.3). */
export const PRINT_IDEMPOTENCY_HEADER = "idempotency-key";
export const PRINT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
/** An order request whose call site lets the SERVER create the slips it would otherwise print itself
 *  (spec §7.4). Without it the server creates nothing: a tab from before Phase 1 still prints its own
 *  slips, so no slip can print twice. Needs PRINT_DEVICE_ID_HEADER too. */
export const PRINT_AGENT_HEADER = "x-pos-print-agent";
/** With PRINT_AGENT_HEADER: this call site also prints the customer bill (Pay Now, the POS settle). */
export const PRINT_BILL_HEADER = "x-pos-print-bill";
/** The one value that switches either header on. */
export const PRINT_HEADER_ON = "1";

/** One job the server created for a request (spec §7.4 `printJobs`): the asking device leases the ones
 *  aimed at it straight away and follows each one's readback by id. */
export interface PrintJobRef {
  id: string;
  kind: PrintJobKind;
  targetDeviceId: string;
  label: string;
  /** The job's state when the answer was built (1B final review M-d): a deduped ref to a job that
   *  already printed (or was dismissed) is followed, never leased or re-sent as if it were fresh. */
  status: PrintJobStatus;
}

/** Session 1D (spec §10): one row of the one waiting-slips panel. Every device reads the same feed on the
 *  existing 20 s pulse: a slip still queued 20 s after it was made (its printer is off or not ready, or the
 *  slip is stale), a bill that may already have printed, or a slip that could not print. */
export interface PrintAttentionRow {
  id: string;
  kind: PrintJobKind;
  label: string;
  status: "queued" | "needs-confirm" | "failed";
  labels: PrintJobLabel[];
  createdAt: string;
  /** The writer's last curated sentence (why it waits, or why it failed); absent when there is none. */
  lastError?: string;
  /** The device that asked for the slip, and the one whose line holds it: both sound the 20 s alarm. */
  originDeviceId?: string;
  targetDeviceId?: string;
  /** Staff already tapped Print now / Retry / Print again on it (approvedAt): it waits for its printer. */
  approved?: true;
}

/** The feed is one bounded read on the hottest poll, within the queued retention (§7.8): the NEWEST rows
 *  (owner, after Session 1D: a new problem always shows and rings), shown oldest first. An older backlog
 *  beyond the limit stays in the count ("20+"). The window adds the acted grace (the Phase 1 final gate,
 *  M2): a slip staff tapped just before its 3 h is kept 15 min more by the prune, so it is shown until then. */
export const PRINT_ATTENTION_LIMIT = 20;
export const PRINT_ATTENTION_WINDOW_MS = PRINT_JOB_QUEUED_RETENTION_MS + PRINT_JOB_ACTED_GRACE_MS;

export const PRINT_DEVICE_SHELLS = ["android", "windows", "browser"] as const;
export type PrintDeviceShell = (typeof PRINT_DEVICE_SHELLS)[number];
export interface PrintDeviceCapabilities {
  lan: boolean;
  bluetooth: boolean;
  usb: boolean;
  windowsPrinters: boolean;
  webSerial: boolean;
  webBluetooth: boolean;
}

/** Without a healthy socket an agent polls fast only this long after it last saw a job (spec §9.1). */
export const PRINT_AGENT_ACTIVE_WINDOW_MS = 2 * 60 * 1000;

/** Whether this device polls the wake at all (spec §9.1, §17.3 rule 1; 1A review gate, I3). In simple
 *  mode only the host polls. With no host every device prints its own slips from its own order
 *  responses, targeted print-status events, local retry timers and the pulse, so no ordering device
 *  adds a recurring request, and one poller keeps the shared daily cap exact. */
export function printAgentPollsWake(input: { hostConfigured: boolean; isHost: boolean }): boolean {
  return input.hostConfigured && input.isHost;
}

/** Each agent's share of the cafe's one daily wake cap (spec §9.1): more agents never mean more hits. */
export function printWakeAgentCap(agents: number): number {
  return Math.floor(PRINT_WAKE_DAILY_CAP / Math.max(1, Math.floor(agents)));
}

/** The agent's wake cadence (spec §9.1). false: the daily share is spent, so stop polling until the
 *  next cafe-day; leasing then rides realtime nudges and the pulse, which already run. */
export function printAgentWakeIntervalMs(input: {
  socketHealthy: boolean;
  msSinceLastJob: number | null;
  capSpent: boolean;
}): number | false {
  if (input.capSpent) return false;
  if (input.socketHealthy) return PRINT_WAKE_SOCKET_MS;
  if (input.msSinceLastJob !== null && input.msSinceLastJob < PRINT_AGENT_ACTIVE_WINDOW_MS) return PRINT_WAKE_FAST_MS;
  return PRINT_WAKE_SLOW_MS;
}

/** After a refusal made before any byte was sent (sent:"no": the printer was off or unreachable), the
 *  agent leases again only once its printer's state changes, or after this long (a printer that says
 *  ready but keeps refusing). The owner's rule after Session 1B: no automatic attempts while a printer
 *  is off. A printer the device KNOWS is not connected is never leased for at all. */
export const PRINT_AGENT_REFUSED_RECHECK_MS = 30_000;
/** The agent's one local timer is set from the server's retryAt / nextAttemptAt (server time), so it is
 *  clamped: never sooner than the shortest backoff, never later than the steady one, whatever the
 *  device's own clock says (spec §15, clock skew). */
export const PRINT_AGENT_TIMER_MIN_MS = 2_000;
export const PRINT_AGENT_TIMER_MAX_MS = 30_000;

export function printAgentTimerDelayMs(atMs: number, nowMs: number): number {
  return Math.min(PRINT_AGENT_TIMER_MAX_MS, Math.max(PRINT_AGENT_TIMER_MIN_MS, atMs - nowMs));
}

/** Whether the agent may ask for a lease right now: its tab drains (the lock), nothing is printing, no
 *  cycle is running, the printer can print here, and a recent refusal does not hold it back. */
export function printAgentMayLease(input: {
  enabled: boolean;
  busy: boolean;
  running: boolean;
  printerReady: boolean;
  refusalHolds: boolean;
}): boolean {
  return input.enabled && !input.busy && !input.running && input.printerReady && !input.refusalHolds;
}

/** One leased job (POST /api/print-jobs/lease). The payload rides the lease, so feeds stay metadata only. */
export interface LeasedPrintJob {
  id: string;
  epoch: number;
  kind: PrintJobKind;
  label: string;
  orderId?: string;
  createdAt: string;
  payload: PrintJobPayload;
  labels: PrintJobLabel[];
  copyIndex: number;
  /** 1 for the first lease of this job. */
  attempt: number;
}

/** retryAt: when the head of this device's line can next be leased (backoff, or another tab's live
 *  lease), so the agent sets one local timer instead of polling. */
export interface PrintLeaseData {
  jobs: LeasedPrintJob[];
  retryAt: string | null;
}

export type PrintJobActionRefusal = PrintJobRefusal | "not-found" | "raced";

export interface PrintAckData {
  applied: boolean;
  status: PrintJobStatus | null;
  /** Set when the job went back to the queue: the agent's local retry timer. */
  nextAttemptAt: string | null;
  reason?: PrintJobActionRefusal;
}

export interface PrintActionData {
  applied: boolean;
  status: PrintJobStatus | null;
  reason?: PrintJobActionRefusal;
}

/** POST /api/print-jobs/wake. serverNow lets an agent run timers on server time (spec §15 clock skew). */
export interface PrintWakeBeatData {
  jobsForMe: { count: number; oldestCreatedAt: string | null };
  agents: number;
  agentDailyCap: number;
  serverNow: string;
}
