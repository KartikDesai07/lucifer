// Printing redesign, Phase 1: the agent's wire contract (spec §7.3, §9.1, §10). Shared by the cafe
// server routes and the in-page agent; pure and client-safe.

import {
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
}

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
