import { PRINT_ACK_ERROR_MAX_CHARS, PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS, printBannerText } from "@pos/shared/print-lifecycle";
import {
  PRINT_AGENT_REFUSED_RECHECK_MS,
  printAgentMayLease,
  printAgentTimerDelayMs,
  type LeasedPrintJob,
  type PrintAckData,
  type PrintLeaseData,
} from "@pos/shared/print-agent-wire";
import { ApiError } from "@/lib/api-client";
import {
  PRINT_HOST_DISPATCH_TIMEOUT_MS,
  PRINT_HOST_EOD_READY_TIMEOUT_MS,
  hostPrintSlipOf,
  type HostPrintSlip,
} from "@/lib/print-host-slips";
import { printWriteOutcomeOf, type PrintWriteOutcome } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's core, with no React and
// no globals except the pending-ack store, so every rule below is unit-tested with fakes
// (lib/print-agent.test.ts). hooks/use-print-agent.ts wires it to the page.
//
// One cycle at a time: lease the head of this device's line → print it through the host bridge → ack.
// It never leases while the printer can not print here (the owner's rule: no automatic attempts while
// a printer is off), and after a refusal (sent:"no") it waits for the printer's state to change, or
// PRINT_AGENT_REFUSED_RECHECK_MS. Its only timer is local, set from the server's retryAt/nextAttemptAt.
// A "printed" ack that got no answer is kept in localStorage and re-sent every 5 s for 10 min, and
// cleared on ANY answer from the server (spec §7.9; 1A review M3).

export type PrintAgentResult = { ok: true } | { ok: false; error: unknown };

export interface PrintAgentAckBody {
  deviceId: string;
  epoch: number;
  outcome: "printed" | "failed";
  sent?: "no" | "maybe";
  permanent?: true;
  error?: string;
}

export interface PendingPrintAck {
  id: string;
  epoch: number;
  at: number;
}

export interface PrintAgentDeps {
  deviceId: string;
  lease(): Promise<PrintLeaseData>;
  ack(id: string, body: PrintAgentAckBody): Promise<PrintAckData>;
  /** Prints one leased job through the host bridge. Never rejects. */
  print(job: LeasedPrintJob): Promise<PrintAgentResult>;
  /** canPrintNow(): a printer here that can print right now. */
  printerReady(): boolean;
  /** Any value whose identity changes when this device's printer changes (its snapshot). */
  printerState(): unknown;
  readPending(): PendingPrintAck[];
  writePending(entries: PendingPrintAck[]): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface PrintAgent {
  setGate(gate: { enabled: boolean; busy: boolean }): void;
  kick(): void;
  flushAcks(): Promise<void>;
  stop(): void;
}

/** How long the agent waits for the bridge to settle one slip: past the bridge's own bounds (the end-of-day
 *  figures' wait, then the dispatch watchdog), so only a slip the watchdog gave up on reaches it. Such a
 *  slip may have printed, so it is acked "maybe". */
export const PRINT_AGENT_SLIP_DEADLINE_MS = PRINT_HOST_EOD_READY_TIMEOUT_MS + PRINT_HOST_DISPATCH_TIMEOUT_MS + 5_000;

/** The pending-ack store keeps at most this many entries (an agent prints one job at a time). */
export const PRINT_ACK_PENDING_LIMIT = 50;

export function failedAckBody(deviceId: string, epoch: number, outcome: PrintWriteOutcome): PrintAgentAckBody {
  const error = outcome.message.trim().slice(0, PRINT_ACK_ERROR_MAX_CHARS).trim();
  return {
    deviceId,
    epoch,
    outcome: "failed",
    sent: outcome.sent,
    ...(outcome.permanent ? { permanent: true as const } : {}),
    ...(error !== "" ? { error } : {}),
  };
}

/** The slip the host bridge prints for one leased job: today's renderer props (print-host-slips.ts),
 *  plus the job's labels as the one banner on top (spec §7.7). An end-of-day summary takes none. */
export function printAgentSlipOf(job: LeasedPrintJob, todayKey: string): HostPrintSlip {
  const slip = hostPrintSlipOf(job.payload, todayKey);
  const banner = printBannerText(job.labels);
  return banner === "" || slip.surface === "eod" ? slip : { ...slip, banner };
}

/** A server answer of any kind clears a pending ack; only no answer (network, timeout) or a 5xx retries. */
export function ackAnswered(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "http" && error.status !== null && error.status < 500;
}

export function createPrintAgent(deps: PrintAgentDeps): PrintAgent {
  let enabled = false;
  let busy = false;
  let running = false;
  let stopped = false;
  let refused: { state: unknown; at: number } | null = null;
  let timer: unknown = null;
  let timerAt = Number.POSITIVE_INFINITY;
  let ackTimer: unknown = null;
  let flushing: Promise<void> | null = null;

  function refusalHolds(): boolean {
    if (refused === null) return false;
    if (deps.printerState() !== refused.state || deps.now() - refused.at >= PRINT_AGENT_REFUSED_RECHECK_MS) {
      refused = null;
      return false;
    }
    return true;
  }

  function wakeAt(atMs: number): void {
    if (stopped) return;
    const delay = printAgentTimerDelayMs(atMs, deps.now());
    const at = deps.now() + delay;
    if (timer !== null && timerAt <= at) return;
    if (timer !== null) deps.clearTimer(timer);
    timerAt = at;
    timer = deps.setTimer(() => {
      timer = null;
      timerAt = Number.POSITIVE_INFINITY;
      kick();
    }, delay);
  }

  function forget(entry: PendingPrintAck): void {
    deps.writePending(deps.readPending().filter((e) => !(e.id === entry.id && e.epoch === entry.epoch)));
  }

  function scheduleAckRetry(): void {
    if (stopped || ackTimer !== null || deps.readPending().length === 0) return;
    ackTimer = deps.setTimer(() => {
      ackTimer = null;
      void flushAcks();
    }, PRINT_ACK_RETRY_MS);
  }

  async function sendPending(): Promise<void> {
    for (const entry of deps.readPending()) {
      if (deps.now() - entry.at > PRINT_ACK_PENDING_MAX_MS) {
        forget(entry);
        continue;
      }
      try {
        await deps.ack(entry.id, { deviceId: deps.deviceId, epoch: entry.epoch, outcome: "printed" });
        forget(entry);
      } catch (error) {
        if (ackAnswered(error)) forget(entry);
      }
    }
  }

  function flushAcks(): Promise<void> {
    // One flush at a time. The reset is chained AFTER the assignment: with nothing pending, an async
    // body would finish before `flushing` was even set, and every later flush would return that stale,
    // resolved promise without sending its ack.
    if (flushing === null) {
      flushing = sendPending().finally(() => {
        flushing = null;
        scheduleAckRetry();
      });
    }
    return flushing;
  }

  async function cycle(): Promise<void> {
    running = true;
    let again = false;
    try {
      const data = await deps.lease();
      const job = data.jobs[0];
      if (job === undefined) {
        if (data.retryAt !== null) wakeAt(Date.parse(data.retryAt));
        return;
      }
      const result = await deps.print(job);
      if (result.ok) {
        // Kept BEFORE it is sent, so a reload mid-ack still reports the paper (spec §7.9). Awaited, so
        // the next lease does not find this job still leased at the head of the line.
        const kept = deps.readPending().filter((e) => e.id !== job.id);
        deps.writePending([...kept, { id: job.id, epoch: job.epoch, at: deps.now() }].slice(-PRINT_ACK_PENDING_LIMIT));
        await flushAcks();
        again = true;
        return;
      }
      const outcome = printWriteOutcomeOf(result.error);
      // Nothing reached the printer: it is off or unreachable. No automatic attempt until it changes.
      if (outcome.sent === "no" && !outcome.permanent) refused = { state: deps.printerState(), at: deps.now() };
      const answer = await deps.ack(job.id, failedAckBody(deps.deviceId, job.epoch, outcome)).catch(() => null);
      if (answer === null) {
        wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
        return;
      }
      // A job back in line waits for its own nextAttemptAt; a parked or failed one frees the line.
      if (answer.nextAttemptAt !== null) wakeAt(Date.parse(answer.nextAttemptAt));
      else again = refused === null;
    } catch {
      // No answer from the lease (offline, a deploy): look again later, never in a tight loop.
      wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
    } finally {
      running = false;
      if (again) kick();
    }
  }

  function kick(): void {
    if (stopped) return;
    const holds = refusalHolds();
    if (!printAgentMayLease({ enabled, busy, running, printerReady: deps.printerReady(), refusalHolds: holds })) {
      if (holds && refused !== null) wakeAt(refused.at + PRINT_AGENT_REFUSED_RECHECK_MS);
      return;
    }
    void cycle();
  }

  return {
    setGate(gate) {
      const opened = (gate.enabled && !enabled) || (!gate.busy && busy);
      enabled = gate.enabled;
      busy = gate.busy;
      if (opened) kick();
    },
    kick,
    flushAcks,
    stop() {
      stopped = true;
      if (timer !== null) deps.clearTimer(timer);
      if (ackTimer !== null) deps.clearTimer(ackTimer);
      timer = null;
      ackTimer = null;
    },
  };
}

// ── The pending-ack store and the agent's two module seams (client-only, never throws) ──────────────

const PENDING_ACK_KEY = "pos.print-ack-pending.v1";

function isPendingAck(v: unknown): v is PendingPrintAck {
  const o = v as Partial<PendingPrintAck> | null;
  return typeof o === "object" && o !== null && typeof o.id === "string" && Number.isInteger(o.epoch) && Number.isFinite(o.at);
}

export function readPendingAcks(): PendingPrintAck[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PENDING_ACK_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isPendingAck) : [];
  } catch {
    return [];
  }
}

export function writePendingAcks(entries: PendingPrintAck[]): void {
  try {
    if (entries.length === 0) window.localStorage.removeItem(PENDING_ACK_KEY);
    else window.localStorage.setItem(PENDING_ACK_KEY, JSON.stringify(entries));
  } catch {
    // A storage that refuses: the ack is still sent now; only its retry after a reload is lost.
  }
}

const kickListeners = new Set<() => void>();

/** An order answer named a job this device prints: lease it now, no poll (spec §9.1). */
export function kickPrintAgent(): void {
  for (const listener of [...kickListeners]) listener();
}

export function onPrintAgentKick(listener: () => void): () => void {
  kickListeners.add(listener);
  return () => void kickListeners.delete(listener);
}

let pulseDevice: string | null = null;

/** The agent with no host names itself on the existing 20 s pulse (?device=), so a job the server
 *  re-queued or sent home reaches it within one tick even with the socket down. Not the host: it polls
 *  the wake, which answers the same. */
export function setPulsePrintDevice(deviceId: string | null): void {
  pulseDevice = deviceId;
}

export function pulsePrintDeviceQuery(): string {
  return pulseDevice === null ? "" : `?device=${encodeURIComponent(pulseDevice)}`;
}
