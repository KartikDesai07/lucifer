import { PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS, PRINT_LEASE_MS } from "@pos/shared/print-lifecycle";
import {
  PRINT_AGENT_REFUSED_RECHECK_MS,
  printAgentMayLease,
  printAgentTimerDelayMs,
  type LeasedPrintJob,
  type PrintAckData,
} from "@pos/shared/print-agent-wire";
import { ackAnswered } from "@/lib/print-ack-store";
import { failedAckBody } from "@/lib/print-agent-slip";
import type { PendingPrintAck, PrintAgent, PrintAgentDeps } from "@/lib/print-agent-types";
import { PRINT_SLIP_REFUSALS_MAX, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";

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
//
// Phase 2 Session 2B (spec §7.11): a job an answer carried already leased to this tab is taken (take) and
// printed before any lease, first in first out; a job it already holds, is printing (however it came) or
// acked is ignored, so an answer delivered twice prints once. After a job leaves the line, the ack's `more`
// decides whether to lease again.

/** The pending-ack store keeps at most this many entries (an agent prints one job at a time). */
export const PRINT_ACK_PENDING_LIMIT = 50;

/** Session 2B (its fresh review, I-1): a job an answer carried leased to this tab prints only this long after
 *  it arrived. Its 90 s lease began at most one request timeout (15 s) earlier, so the print stays inside the
 *  lease with a margin. Later the lease may have run out and another attempt (a REPRINT) be on paper, so the
 *  held job is dropped unprinted. */
export const PRINT_DIRECT_HOLD_MS = PRINT_LEASE_MS - 30_000;
/** Why a held job went back to its line unprinted: its refusal's error (the waiting-slips panel may show it). */
const HELD_TOO_LONG = "held too long on this device";
const PRINTING_STOPPED = "printing stopped on this device";

export function createPrintAgent(deps: PrintAgentDeps): PrintAgent {
  let enabled = false;
  let busy = false;
  let running = false;
  let kickedWhileRunning = false;
  let stopped = false;
  let refused: { state: unknown; at: number } | null = null;
  let timer: unknown = null;
  let timerAt = Number.POSITIVE_INFINITY;
  let ackTimer: unknown = null;
  let flushing: Promise<void> | null = null;
  const slipRefusals = new Map<string, number>();
  // Session 2B: jobs already leased to this tab, waiting their turn; every (id:epoch) taken; each ack's answer.
  const held: Array<{ job: LeasedPrintJob; at: number }> = [];
  const taken = new Set<string>();
  const answers = new Map<string, PrintAckData>();
  // A held job was handed back since the cycle last sent acks (the final review, I-1).
  let handedBack = false;

  /** A bounded insert: the oldest key goes once the store holds as many as the pending-ack store. */
  function remember<T>(store: Set<string> | Map<string, T>, key: string, value?: T): void {
    if (store instanceof Map) store.set(key, value as T);
    else store.add(key);
    if (store.size > PRINT_ACK_PENDING_LIMIT) store.delete(store.keys().next().value as string);
  }

  /** The oldest held job still well inside its lease; one held longer is dropped unprinted (I-1). */
  function nextHeld(): LeasedPrintJob | undefined {
    for (let next = held.shift(); next !== undefined; next = held.shift()) {
      if (deps.now() - next.at < PRINT_DIRECT_HOLD_MS) return next.job;
      handBack(next.job, HELD_TOO_LONG);
    }
    return undefined;
  }

  /** A held job dropped unprinted goes back to its line as a refusal (sent:"no", never counted), kept and sent
   *  like any ack: this tab knows nothing of it reached a printer, so it prints again unlabelled rather than
   *  expiring into a REPRINT (a bill: the cashier's question). The server takes it only while the job is still
   *  leased at that epoch; once its expiry is applied, or a new lease made, it is ignored (the final review, I-1). */
  function handBack(job: LeasedPrintJob, why: string): void {
    keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: { deviceId: deps.deviceId, epoch: job.epoch, outcome: "failed", sent: "no", error: why } });
    handedBack = true;
  }

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

  function keep(entry: PendingPrintAck): void {
    deps.writePending([...deps.readPending().filter((e) => e.id !== entry.id), entry].slice(-PRINT_ACK_PENDING_LIMIT));
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
    // Re-read after each send, so an ack kept while this flush was on the wire goes out with it too.
    const tried = new Set<string>();
    for (;;) {
      const entry = deps.readPending().find((e) => !tried.has(`${e.id}:${e.epoch}`));
      if (entry === undefined) return;
      tried.add(`${entry.id}:${entry.epoch}`);
      if (deps.now() - entry.at > PRINT_ACK_PENDING_MAX_MS) {
        forget(entry);
        continue;
      }
      try {
        const answer = await deps.ack(entry.id, entry.fail ?? { deviceId: deps.deviceId, epoch: entry.epoch, outcome: "printed" });
        remember(answers, `${entry.id}:${entry.epoch}`, answer);
        forget(entry);
        // A refusal sent again and applied put its job back in line: lease it when its backoff ends (the 2B gate, M-B).
        if (entry.fail !== undefined && answer.nextAttemptAt !== null) wakeAt(Date.parse(answer.nextAttemptAt));
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

  async function cycle(forHeld = false): Promise<void> {
    running = true;
    kickedWhileRunning = false;
    let again = false;
    try {
      // An ack the last page (or a dropped answer) left goes first: a lease could expire our own job (M6).
      // A stop() that landed meanwhile leases nothing (the 1D gate M-4).
      await flushAcks();
      if (stopped) return;
      // Session 2B: a job already leased to this tab goes first; only then is the line leased.
      let job = nextHeld();
      if (handedBack) {
        // A held job dropped just now frees its lease first, so the lease below can reach it (I-1).
        handedBack = false;
        await flushAcks();
        if (stopped) {
          // A stop() during that ack: the job this cycle already took is handed back too (the 2B gate, M-A).
          if (job !== undefined) handBack(job, PRINTING_STOPPED);
          void flushAcks();
          return;
        }
      }
      if (job === undefined) {
        // Only a held job prints past the lease gate; with none left (I-1), the gate decides as always.
        if (forHeld && !printAgentMayLease({ enabled, busy, running: false, printerReady: deps.printerReady(), refusalHolds: refusalHolds() })) return;
        const data = await deps.lease();
        // Session 2C: one job per line (its own and each printer line it writes); on its one local printer they
        // print one by one, the rest held like a taken job. A line that gave none sets the timer even so.
        for (const extra of data.jobs.slice(1)) {
          remember(taken, `${extra.id}:${extra.epoch}`);
          held.push({ job: extra, at: deps.now() });
        }
        if (data.retryAt !== null) wakeAt(Date.parse(data.retryAt));
        job = data.jobs[0];
        if (job === undefined) return;
      }
      // One (id, epoch) prints once however it reached this tab (the final review, C-1): the enqueue hands a
      // running lease back to its tab, even one this cycle leased itself, while it prints or before.
      const key = `${job.id}:${job.epoch}`;
      remember(taken, key);
      const twin = held.findIndex((h) => `${h.job.id}:${h.job.epoch}` === key);
      if (twin >= 0) held.splice(twin, 1);
      const result = await deps.print(job);
      if (result.ok) {
        // A printed slip's refusal count is done with (1D gate M-3). A failed one keeps it, so a staff
        // Retry stays one tap, one try.
        slipRefusals.delete(job.id);
        // Kept BEFORE it is sent, so a reload mid-ack still reports the paper (spec §7.9). Awaited, so
        // the next lease does not find this job still leased at the head of the line.
        keep({ id: job.id, epoch: job.epoch, at: deps.now() });
        await flushAcks();
        // Session 2B (decision 9): lease again only when the ack says the line holds more. No answer, or
        // an older server that does not say: lease again, as in Phase 1.
        again = answers.get(key)?.more !== false;
        answers.delete(key);
        return;
      }
      let outcome = printWriteOutcomeOf(result.error);
      if (isSlipRefusal(outcome) && deps.printerReady()) {
        // The slip itself was refused (owner, 1C gate I3): its second refusal fails the job, freeing the line.
        const count = (slipRefusals.get(job.id) ?? 0) + 1;
        slipRefusals.set(job.id, count);
        if (count >= PRINT_SLIP_REFUSALS_MAX) outcome = { ...outcome, permanent: true };
      } else if (outcome.sent === "no" && !outcome.permanent) {
        // Nothing reached the printer: it is off or unreachable. No automatic attempt until it changes.
        refused = { state: deps.printerState(), at: deps.now() };
      }
      const body = failedAckBody(deps.deviceId, job.epoch, outcome);
      const answer = await deps.ack(job.id, body).catch((error: unknown) => {
        // No answer: kept and re-sent like a printed ack, so the lease never expires into a counted "maybe" (M4).
        if (!ackAnswered(error)) keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: body });
        return null;
      });
      if (answer === null) {
        scheduleAckRetry();
        wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
        return;
      }
      // A job back in line holds the line until its own nextAttemptAt (the timer leases it then), so a
      // kick that landed meanwhile (the bridge freeing up from this very slip) would only find it not due.
      if (answer.nextAttemptAt !== null) {
        kickedWhileRunning = false;
        wakeAt(Date.parse(answer.nextAttemptAt));
      } else again = refused === null && answer.more !== false;
    } catch {
      // No answer from the lease (offline, a deploy): look again later, never in a tight loop.
      wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
    } finally {
      running = false;
      if (again || kickedWhileRunning || held.length > 0) kick();
    }
  }

  function kick(): void {
    if (stopped) return;
    // Remembered, not dropped: the running cycle's lease may have read the line before this job was in it.
    if (running) return void (kickedWhileRunning = true);
    // Session 2B: a job already leased to this tab prints now, whatever the lease gate says. Its attempt was
    // made while the printer was ready, so a printer that went off since refuses it (sent:"no", never
    // counted) instead of leaving it to expire into a REPRINT.
    if (held.length > 0 && enabled && !busy) return void cycle(true);
    const holds = refusalHolds();
    if (!printAgentMayLease({ enabled, busy, running, printerReady: deps.printerReady(), refusalHolds: holds })) {
      if (holds && refused !== null) wakeAt(refused.at + PRINT_AGENT_REFUSED_RECHECK_MS);
      return;
    }
    void cycle();
  }

  /** Session 2B (seen on the emulator at the 2A gate): a change of state (the gate, the bridge freeing up, the
   *  printer's status) looks at the line when idle, but is no reason to lease after a running cycle: its own
   *  print causes them, and its ack's `more` already says whether the line holds more. */
  function nudge(): void {
    if (!running) kick();
  }

  return {
    setGate(gate) {
      const opened = (gate.enabled && !enabled) || (!gate.busy && busy);
      enabled = gate.enabled;
      busy = gate.busy;
      if (opened) nudge();
    },
    kick,
    nudge,
    flushAcks,
    stop() {
      stopped = true;
      // A job still held is dropped and handed back (I-1), sent now or by the next page's first flush; with
      // neither, its lease expires (KOT: REPRINT; bill: the cashier), as for a tab that died.
      for (const h of held.splice(0)) handBack(h.job, PRINTING_STOPPED);
      if (timer !== null) deps.clearTimer(timer);
      if (ackTimer !== null) deps.clearTimer(ackTimer);
      timer = null;
      ackTimer = null;
      if (handedBack) {
        handedBack = false;
        void flushAcks();
      }
    },
    take(job) {
      if (stopped || typeof job.id !== "string" || !Number.isInteger(job.epoch)) return;
      const key = `${job.id}:${job.epoch}`;
      // At-least-once delivery, an idempotent consumer: a job already taken, or printed and waiting for its
      // ack's answer, is never printed again.
      if (taken.has(key) || deps.readPending().some((e) => e.id === job.id && e.epoch === job.epoch)) return;
      remember(taken, key);
      held.push({ job, at: deps.now() });
      kick();
    },
    directReady() {
      return enabled && !stopped && deps.printerReady() && !refusalHolds();
    },
  };
}

// ── Split out, re-exported: the shapes, the module seams, the slip and failure helpers, the pending-ack store ──

export type { PendingPrintAck, PrintAgent, PrintAgentAckBody, PrintAgentDeps, PrintAgentResult } from "@/lib/print-agent-types";
export * from "@/lib/print-agent-seams";
export { PRINT_AGENT_SLIP_DEADLINE_MS, failedAckBody, printAgentSlipOf } from "@/lib/print-agent-slip";
export { ackAnswered, readPendingAcks, writePendingAcks } from "@/lib/print-ack-store";
