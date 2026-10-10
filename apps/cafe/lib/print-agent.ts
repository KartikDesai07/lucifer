import { PRINT_LEASE_MS } from "@pos/shared/print-lifecycle";
import {
  PRINT_AGENT_REFUSED_RECHECK_MS,
  printAgentMayLease,
  printAgentTimerDelayMs,
  type LeasedPrintJob,
  type PrintAckData,
} from "@pos/shared/print-agent-wire";
import { ackAnswered } from "@/lib/print-ack-store";
import { createAckFlusher, rememberBounded as remember } from "@/lib/print-agent-acks";
import { PRINT_DEVICE_LINE, createRefusalHolds } from "@/lib/print-agent-holds";
import { failedAckBody } from "@/lib/print-agent-slip";
import type { PrintAgent, PrintAgentDeps } from "@/lib/print-agent-types";
import { PRINT_SLIP_REFUSALS_MAX, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's core, with no React and
// no globals except the pending-ack store, so every rule below is unit-tested with fakes
// (lib/print-agent.test.ts). hooks/use-print-agent.ts wires it to the page.
//
// One cycle at a time: lease the head of this device's line → print it through the host bridge → ack.
// It never leases while the printer can not print here (the owner's rule: no automatic attempts while
// a printer is off), and after a refusal (sent:"no") it waits for the printer's state to change, or
// PRINT_AGENT_REFUSED_RECHECK_MS. Its only timer is local, set from the server's retryAt/nextAttemptAt.
// Its acks are kept and re-sent by lib/print-agent-acks.ts (spec §7.9).
//
// Phase 2 Session 2B (spec §7.11): a job an answer carried already leased to this tab is taken (take) and
// printed before any lease, first in first out; a job it already holds, is printing (however it came) or
// acked is ignored, so an answer delivered twice prints once. After a job leaves the line, the ack's `more`
// decides whether to lease again.
//
// Phase 2 Session 2E (spec §9.2): a Windows PC prints several printers, one slip at a time through its one bridge.
// A refusal holds only its own printer's line (lib/print-agent-holds.ts); the lease, direct print and the kicks name
// only the printers no refusal holds.

export { PRINT_ACK_PENDING_LIMIT } from "@/lib/print-agent-acks";

/** Session 2B (its fresh review, I-1): a job an answer carried leased to this tab prints only this long after
 *  it arrived. Its 90 s lease began at most one request timeout (15 s) earlier, so the print stays inside the
 *  lease with a margin. Later the lease may have run out and another attempt (a REPRINT) be on paper, so the
 *  held job is dropped unprinted. */
export const PRINT_DIRECT_HOLD_MS = PRINT_LEASE_MS - 30_000;
/** The 2E review gate (the trailing empty lease): a change of this device's state right after an ack said its line
 *  is empty (the bridge freeing up from that very slip, the printer's status after its write) is no reason to lease.
 *  Job signals (an answer, a frame, the pulse, the wake, a timer) are never held back. */
export const PRINT_AGENT_QUIET_AFTER_ACK_MS = 500;
/** Why a held job went back to its line unprinted: its refusal's error (the waiting-slips panel may show it). */
const HELD_TOO_LONG = "held too long on this device";
const PRINTING_STOPPED = "printing stopped on this device";

export function createPrintAgent(deps: PrintAgentDeps): PrintAgent {
  let enabled = false;
  let busy = false;
  let running = false;
  let kickedWhileRunning = false;
  // Session 2E's final review (I-1): a wish to lease (an ack's `more`, a kick while a cycle ran) kept until a cycle
  // leases, so held jobs printed first (a slip leased to this tab on two printers' lines) never drop it.
  let leaseWanted = false;
  // The 2E review gate: until when a state-change nudge leases nothing (an ack just said the line is empty).
  let quietUntil = 0;
  let stopped = false;
  const holds = createRefusalHolds(deps);
  const ready = (): readonly string[] => deps.readyPrinters?.() ?? [];
  const lineOf = (job: LeasedPrintJob): string => deps.lineOf?.(job) ?? PRINT_DEVICE_LINE;
  let timer: unknown = null;
  let timerAt = Number.POSITIVE_INFINITY;
  const slipRefusals = new Map<string, number>();
  // Session 2B: jobs already leased to this tab, waiting their turn; every (id:epoch) taken; each ack's answer.
  const held: Array<{ job: LeasedPrintJob; at: number }> = [];
  const taken = new Set<string>();
  const answers = new Map<string, PrintAckData>();
  const acks = createAckFlusher(deps, {
    stopped: () => stopped,
    answered: (key, answer) => remember(answers, key, answer),
    requeued: (atMs) => wakeAt(atMs),
  });
  const flushAcks = acks.flush;
  // A held job was handed back since the cycle last sent acks (the final review, I-1).
  let handedBack = false;

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
    acks.keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: { deviceId: deps.deviceId, epoch: job.epoch, outcome: "failed", sent: "no", error: why } });
    handedBack = true;
  }

  /** No line this device could lease is free of a refusal's hold (Session 2E: per line). */
  function refusalHolds(): boolean {
    return !holds.mayLease(ready());
  }

  function wakeAt(atMs: number, local = false): void {
    if (stopped) return;
    // A hold's end is this tab's own clock, never clamped (the clamp is for the server's clock; the 2E gate's review, I-1).
    const delay = local ? Math.max(0, atMs - deps.now()) : printAgentTimerDelayMs(atMs, deps.now());
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

  async function cycle(forHeld = false): Promise<void> {
    running = true;
    kickedWhileRunning = false;
    // The 2E review gate: a cycle a kick started is a wish to lease. A job taken before it reaches the line prints
    // first, and the wish outlives it (else the kicked job would wait for the next signal).
    if (!forHeld) leaseWanted = true;
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
        leaseWanted = false;
        const data = await deps.lease(holds.open(ready()));
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
        acks.keep({ id: job.id, epoch: job.epoch, at: deps.now() });
        await flushAcks();
        // Session 2B (decision 9): lease again only when the ack says the line holds more. No answer, or
        // an older server that does not say: lease again, as in Phase 1.
        again = answers.get(key)?.more !== false;
        if (!again) quietUntil = deps.now() + PRINT_AGENT_QUIET_AFTER_ACK_MS;
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
        // Nothing reached the printer: it is off or unreachable. No automatic attempt on it until it changes.
        holds.hold(lineOf(job));
      }
      // Session 3B (spec §9.3): a network printer this device could not reach says so, so another device takes it over.
      const body = failedAckBody(deps.deviceId, job.epoch, outcome, deps.networkPrinter?.(job) === true);
      const answer = await deps.ack(job.id, body).catch((error: unknown) => {
        // No answer: kept and re-sent like a printed ack, so the lease never expires into a counted "maybe" (M4).
        if (!ackAnswered(error)) acks.keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: body });
        return null;
      });
      if (answer === null) {
        acks.retryLater();
        wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
        return;
      }
      // A job back in line holds the line until its own nextAttemptAt (the timer leases it then), so a
      // kick that landed meanwhile (the bridge freeing up from this very slip) would only find it not due.
      if (answer.nextAttemptAt !== null) {
        kickedWhileRunning = false;
        // Session 2E: a line its refusal holds is looked at again when the hold ends; a lease at its backoff would
        // only find the other printers' lines.
        const end = holds.holding(lineOf(job)) ? holds.nextEnd() : null;
        wakeAt(end ?? Date.parse(answer.nextAttemptAt), end !== null);
      } else again = !holds.holding(lineOf(job)) && answer.more !== false;
    } catch {
      // No answer from the lease (offline, a deploy): look again later, never in a tight loop.
      wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
    } finally {
      running = false;
      if (again || kickedWhileRunning) leaseWanted = true;
      if (leaseWanted || held.length > 0) kick();
    }
  }

  function kick(printerId?: string): void {
    if (stopped) return;
    // The 2E review gate (M-1): a job on a printer this tab does not lease now (held by a refusal, or not printed here)
    // is no reason to lease the others; its hold's end, or the stale-list read, looks at it.
    if (printerId !== undefined && ready().length > 0 && !holds.open(ready()).includes(printerId)) return;
    // Remembered, not dropped: the running cycle's lease may have read the line before this job was in it.
    if (running) return void (kickedWhileRunning = true);
    // Session 2B: a job already leased to this tab prints now, whatever the lease gate says. Its attempt was
    // made while the printer was ready, so a printer that went off since refuses it (sent:"no", never
    // counted) instead of leaving it to expire into a REPRINT.
    if (held.length > 0 && enabled && !busy) return void cycle(true);
    const blocked = refusalHolds();
    if (!printAgentMayLease({ enabled, busy, running, printerReady: deps.printerReady(), refusalHolds: blocked })) {
      const end = holds.nextEnd();
      if (blocked && end !== null) wakeAt(end, true);
      return;
    }
    // Session 2E: a printer held while others print is looked at again when its hold ends.
    const holdEnd = holds.nextEnd();
    if (holdEnd !== null) wakeAt(holdEnd, true);
    void cycle();
  }

  /** Session 2B (seen on the emulator at the 2A gate): a change of state (the gate, the bridge freeing up, the
   *  printer's status) looks at the line when idle, but is no reason to lease after a running cycle: its own
   *  print causes them, and its ack's `more` already says whether the line holds more. The 2E review gate: nor
   *  just after an ack said the line is empty, unless a job leased to this tab waits. */
  function nudge(): void {
    if (running) return;
    if (held.length > 0 || deps.now() >= quietUntil) kick();
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
      timer = null;
      acks.stop();
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
      // The 2E review gate: a held job is no wish to lease. A running cycle's end picks it up (held.length > 0).
      if (!running) kick();
    },
    directReady() {
      return enabled && !stopped && deps.printerReady() && !refusalHolds();
    },
    openPrinters() {
      return deps.printerReady() ? holds.open(ready()) : [];
    },
  };
}

// ── Split out, re-exported: the shapes, the module seams, the slip and failure helpers, the pending-ack store ──

export type { PendingPrintAck, PrintAgent, PrintAgentAckBody, PrintAgentDeps, PrintAgentResult } from "@/lib/print-agent-types";
export * from "@/lib/print-agent-seams";
export { PRINT_AGENT_SLIP_DEADLINE_MS, failedAckBody, printAgentSlipOf } from "@/lib/print-agent-slip";
export { ackAnswered, readPendingAcks, writePendingAcks } from "@/lib/print-ack-store";
