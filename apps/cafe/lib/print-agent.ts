import { PRINT_LEASE_MS } from "@pos/shared/print-lifecycle";
import {
  PRINT_AGENT_REFUSED_RECHECK_MS,
  printAgentMayLease,
  printAgentTimerDelayMs,
  type LeasedPrintJob,
  type PrintAckData,
} from "@pos/shared/print-agent-wire";
import { createAckFlusher, rememberBounded as remember } from "@/lib/print-agent-acks";
import { PRINT_DEVICE_LINE, createRefusalHolds } from "@/lib/print-agent-holds";
import type { PrintAgent, PrintAgentDeps } from "@/lib/print-agent-types";
import { HELD_TOO_LONG, PRINTING_STOPPED, handBack, runLineOnce, type LineJobEnd } from "@/lib/print-line-job";
import { createLineState, createLineTimer } from "@/lib/print-lines";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's core, no React, unit-tested with fakes
// (lib/print-agent.test.ts, lib/print-lines*.test.ts); hooks/use-print-agent.ts wires it to the page.
//
// Printing Phase 6 (spec §9 rulings 14-21, 25, 28): one job per printer line. A line takes its job (from a lease or the
// held list), prints it through the host bridge and acks it (lib/print-line-job.ts), one at a time and in order (S2).
// Lines share only the drawing surface (the gate: "the surface is drawing", one start per opening), so one printer's
// write, ack or hang never holds another's line; the device line runs alone (ruling 16). One pump() on every signal and
// every line's end starts held jobs and leases the free lines (lib/print-lines.ts). No lease while the printer can not
// print here (the owner's rule); after a refusal (sent:"no") its line waits for the printer's state to change, or
// PRINT_AGENT_REFUSED_RECHECK_MS. One local timer (retryAt, nextAttemptAt, the holds' ends); acks: print-agent-acks.ts.
//
// Phase 2 Session 2B (spec §7.11): a job an answer carried leased to this tab is taken (take) and printed before its line
// is leased, first in first out; a job it holds, prints or acked is ignored, so an answer delivered twice prints once.
// The ack's `more` decides whether to lease the line again. Session 2E (spec §9.2): a refusal holds only its own line.

export { PRINT_ACK_PENDING_LIMIT } from "@/lib/print-agent-acks";

/** Session 2B (its fresh review, I-1): a job an answer carried leased to this tab prints only this long after it arrived.
 *  Its 90 s lease began at most one request timeout (15 s) earlier, so the print stays inside the lease with a margin;
 *  later another attempt (a REPRINT) may be on paper, so the held job is dropped unprinted. Phase 6: per job, so per line. */
export const PRINT_DIRECT_HOLD_MS = PRINT_LEASE_MS - 30_000;
/** The 2E review gate (the trailing empty lease): a change of this device's state right after an ack said its line
 *  is empty (the bridge freeing up from that very slip, the printer's status after its write) is no reason to lease.
 *  Job signals (an answer, a frame, the pulse, the wake, a timer) are never held back. Phase 6 (ruling 19): device-wide. */
export const PRINT_AGENT_QUIET_AFTER_ACK_MS = 500;

export function createPrintAgent(deps: PrintAgentDeps): PrintAgent {
  let enabled = false;
  let busy = false;
  // Ruling 17: one start per opening of the surface: false from a held job's start (its slip is being drawn, ruling 14,
  // though the page's `drawing` lags a render) until the surface opens again or a line's job ends.
  let fresh = true;
  // A lease is in flight from the moment it is decided (before its kept-acks flush) until its answer.
  let leasing = false;
  // A wish to lease the free lines (a kick, a hand-back, an idle nudge), taken by the lease that names them; deferred:
  // an unnamed kick while a line was occupied, a wish at the first pump after a line frees (ruling 25).
  let wish = false;
  let deferred = false;
  // The 2E review gate: until when a state-change nudge wishes nothing (an ack just said its line is empty).
  let quietUntil = 0;
  let stopped = false;
  const holds = createRefusalHolds(deps);
  const heldLines = new Set<string>();
  const lines = createLineState();
  const ready = (): readonly string[] => deps.readyPrinters?.() ?? [];
  const lineOf = (job: LeasedPrintJob): string => deps.lineOf?.(job) ?? PRINT_DEVICE_LINE;
  // Session 2B: jobs already leased to this tab, waiting their turn; every (id:epoch) taken; each ack's answer.
  const held: Array<{ job: LeasedPrintJob; at: number }> = [];
  const taken = new Set<string>();
  const answers = new Map<string, PrintAckData>();
  // The final review (I-1(a)): a started job whose printed ack is kept ends its line when that ack's answer is heard.
  const onAnswer = new Map<string, (answer: PrintAckData) => void>();
  const acks = createAckFlusher(deps, {
    stopped: () => stopped,
    answered: (key, answer) => {
      remember(answers, key, answer);
      onAnswer.get(key)?.(answer);
    },
    requeued: (atMs) => wakeAt(atMs),
  });
  const flushAcks = acks.flush;
  const hold = (line: string): void => {
    heldLines.add(line);
    holds.hold(line);
  };
  const ctx = { deps, acks, answers, holds, slipRefusals: new Map<string, number>(), lineOf, hold };
  /** Ruling 15: a line is occupied while its job is in flight or one of its jobs waits here (its head is ours). */
  const occupied = (line: string): boolean => lines.occupied(line) || held.some((h) => lineOf(h.job) === line);

  // Ruling 20: the one timer kicks each line whose backoff or hold end set it, by name; a retryAt alone, unnamed.
  const timer = createLineTimer(deps, (due) => {
    wakeHolds();
    for (const line of due) {
      if (line !== PRINT_DEVICE_LINE) kick(line ?? undefined);
      else mark(line);
    }
    if (due.includes(PRINT_DEVICE_LINE)) pump();
  });

  /** A hold's end is this tab's own clock, never clamped (the clamp is for the server's clock; the 2E gate's review, I-1). */
  function wakeAt(atMs: number, local = false, line: string | null = null): void {
    if (!stopped) timer.wake(line, deps.now() + (local ? Math.max(0, atMs - deps.now()) : printAgentTimerDelayMs(atMs, deps.now())));
  }

  /** Session 2E: a line a refusal holds is looked at again when the soonest hold ends. */
  function wakeHolds(): void {
    const end = holds.nextEnd();
    for (const line of [...heldLines]) {
      if (!holds.holding(line)) heldLines.delete(line);
      else if (end !== null) wakeAt(end, true, line);
    }
  }

  /** A named kick: an occupied line wants a lease when it frees; a free one is a wish now (ruling 25). */
  function mark(line: string): void {
    if (occupied(line)) lines.wantMore(line);
    else wish = true;
  }

  /** Ruling 17: every held job older than the bound goes back; each one is a named kick for its own line. */
  function handBackStale(): boolean {
    const stale = held.filter((h) => deps.now() - h.at >= PRINT_DIRECT_HOLD_MS);
    held.splice(0, held.length, ...held.filter((h) => !stale.includes(h)));
    for (const h of stale) {
      handBack(ctx, h.job, HELD_TOO_LONG);
      mark(lineOf(h.job));
    }
    return stale.length > 0;
  }

  function start(job: LeasedPrintJob): void {
    const line = lineOf(job);
    fresh = false;
    lines.occupy(line, job.id);
    runLineOnce(job, ctx, onAnswer, (end) => lineEnd(line, end), pump);
  }

  function lineEnd(line: string, end: LineJobEnd): void {
    lines.release(line);
    fresh = true;
    // The final review (I-2): with no printer line, a job back in line drops the kick kept meanwhile (it could only find
    // that job not due: today's kickedWhileRunning = false); with printer lines another line may hold its job (ruling 20).
    if (end.kind !== "back" || ready().length > 0) wish ||= deferred;
    deferred = false;
    // The Task 5 review (m-2): a line its refusal holds is looked at when the hold ends, whatever its answer said.
    const holdEnd = holds.holding(line) ? holds.nextEnd() : null;
    if (holdEnd !== null) wakeAt(holdEnd, true, line);
    // The review (I-1): a job back in line holds its line until its own time, when the timer leases it: the line's own
    // want ends here (today's cycle dropped such a kick: it would only find the job not due); another line's, never.
    if (end.kind === "back") {
      lines.takeMore([line]);
      wakeAt(end.at, end.local, line);
    } else if (end.kind === "unanswered") {
      acks.retryLater();
      wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
    } else if (end.more) lines.wantMore(line);
    else if (end.kind === "printed") quietUntil = deps.now() + PRINT_AGENT_QUIET_AFTER_ACK_MS;
  }

  /** The printers a lease names now ([] in simple mode: the device line only), or null when no line may take a job:
   *  the device line in flight or holding a job (ruling 16), or no open printer free (ruling 15). */
  function leaseNames(): string[] | null {
    if (occupied(PRINT_DEVICE_LINE)) return null;
    const ids = ready();
    if (ids.length === 0) return lines.inFlight().length === 0 ? [] : null;
    const free = holds.open(ids).filter((id) => !occupied(id));
    return free.length > 0 ? free : null;
  }

  function maybeLease(): void {
    if (leasing) return;
    const names = leaseNames();
    if (!wish && (names === null || !lines.wanted([PRINT_DEVICE_LINE, ...names]))) return;
    const blocked = !holds.mayLease(ready());
    const may = printAgentMayLease({ enabled, busy: busy || !fresh, running: leasing, printerReady: deps.printerReady(), refusalHolds: blocked });
    if (blocked || may) wakeHolds();
    if (may && names !== null) void lease();
  }

  async function lease(): Promise<void> {
    leasing = true;
    try {
      // An ack the last page (or a dropped answer) left goes first: a lease could expire our own job (M6); a hand-back
      // too, so the lease can reach its job (the final review, I-1). A stop() meanwhile leases nothing (the 1D gate M-4).
      await flushAcks();
      if (stopped) return;
      // Read the lines again: one that freed during the flush is named too.
      const names = leaseNames();
      if (names === null) return;
      wish = false;
      lines.takeMore([PRINT_DEVICE_LINE, ...names]);
      const data = await deps.lease(names);
      timer.forget(null); // the final review (I-2): a lease is what an unnamed wake wanted; its own retryAt sets one again
      // Session 2C: one job per line; each waits here for its line's turn (the first that may start starts now).
      const got: LeasedPrintJob[] = [];
      for (const job of data.jobs) {
        if (taken.has(`${job.id}:${job.epoch}`)) continue;
        remember(taken, `${job.id}:${job.epoch}`);
        if (stopped) handBack(ctx, job, PRINTING_STOPPED);
        else got.push(job);
      }
      // The Task 5 review (m-3): as today's cycle, a tab that stopped draining meanwhile still prints the first job that
      // may start, by ruling 16 (a device-line job first; none while one already waits here; index -1: none).
      const first = enabled || occupied(PRINT_DEVICE_LINE) ? undefined : got[lines.nextStart(got.map(lineOf))];
      held.push(...got.filter((job) => job !== first).map((job) => ({ job, at: deps.now() })));
      if (first !== undefined) start(first);
      if (stopped) void flushAcks();
      else if (data.retryAt !== null) wakeAt(Date.parse(data.retryAt));
    } catch {
      // No answer from the lease (offline, a deploy): look again later, never in a tight loop.
      wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
    } finally {
      leasing = false;
      pump();
    }
  }

  /** On every signal and every line's end: hand back stale held jobs, start one held job at an opening of the surface
   *  (a start leases nothing: its slip is being drawn, ruling 14), then lease when there is a reason. */
  function pump(): void {
    if (stopped || !enabled) return;
    const handedBack = handBackStale();
    if (!busy && fresh) {
      const at = lines.nextStart(held.map((h) => lineOf(h.job)));
      const next = at < 0 ? undefined : held.splice(at, 1)[0];
      if (next !== undefined) start(next.job);
    }
    maybeLease();
    // A hand-back's ack goes now, as before (one flush at a time: a lease's own flush takes it along).
    if (handedBack) void flushAcks();
  }

  function kick(printerId?: string, jobId?: string): void {
    if (stopped) return;
    // The 2E review gate (M-1): a job on a printer this tab does not lease now (held by a refusal, or not printed here)
    // is no reason to lease the others; its hold's end, or the stale-list read, looks at it.
    if (printerId !== undefined && ready().length > 0 && !holds.open(ready()).includes(printerId)) return;
    // Ruling 25 (the re-check's I-1): a frame for a job this tab holds or prints came after that job's own lease.
    if (jobId !== undefined && (lines.printing(jobId) || held.some((h) => h.job.id === jobId))) return;
    if (printerId !== undefined) mark(printerId);
    else if (lines.inFlight().length > 0 || held.length > 0) deferred = true;
    else wish = true;
    pump();
  }

  /** Session 2B (the 2A gate's emulator run): a change of state (the gate, the bridge freeing up, a printer's status) is a
   *  wish only while nothing prints, waits or is leased here (its own print causes them; its ack's `more` speaks for its
   *  line), nor just after an ack said a line is empty (the 2E review gate; ruling 19: device-wide). It starts held jobs. */
  function nudge(): void {
    if (lines.inFlight().length === 0 && held.length === 0 && !leasing && deps.now() >= quietUntil) wish = true;
    pump();
  }

  return {
    setGate(gate) {
      const opened = (gate.enabled && !enabled) || (!gate.busy && busy);
      enabled = gate.enabled;
      busy = gate.busy;
      fresh ||= opened; // ruling 17: an opening of the surface lets the next held job start
      if (opened) nudge();
    },
    kick,
    nudge,
    flushAcks,
    stop() {
      stopped = true;
      // A job still held is dropped and handed back (I-1), sent now or by the next page's first flush; with
      // neither, its lease expires (KOT: REPRINT; bill: the cashier), as for a tab that died. Jobs in flight finish.
      const back = held.splice(0);
      for (const h of back) handBack(ctx, h.job, PRINTING_STOPPED);
      timer.stop();
      acks.stop();
      if (back.length > 0) void flushAcks();
    },
    take(job) {
      if (stopped || typeof job.id !== "string" || !Number.isInteger(job.epoch)) return;
      const key = `${job.id}:${job.epoch}`;
      // At-least-once delivery, an idempotent consumer: a job already taken, or printed and waiting for its
      // ack's answer, is never printed again.
      if (taken.has(key) || deps.readPending().some((e) => e.id === job.id && e.epoch === job.epoch)) return;
      remember(taken, key);
      held.push({ job, at: deps.now() });
      // The 2E review gate: a held job is no wish to lease. It starts at an opening of the surface (ruling 17).
      pump();
    },
    directReady() {
      return enabled && !stopped && deps.printerReady() && holds.mayLease(ready());
    },
    openPrinters() {
      return deps.printerReady() ? holds.open(ready()) : [];
    },
    holdsJob: () => enabled && !stopped && held.length > 0,
  };
}

// ── Split out, re-exported: the shapes, the module seams, the slip and failure helpers, the pending-ack store ──

export type { PendingPrintAck, PrintAgent, PrintAgentAckBody, PrintAgentDeps, PrintAgentResult } from "@/lib/print-agent-types";
export * from "@/lib/print-agent-seams";
export { PRINT_AGENT_SLIP_DEADLINE_MS, failedAckBody, printAgentSlipOf } from "@/lib/print-agent-slip";
export { ackAnswered, readPendingAcks, writePendingAcks } from "@/lib/print-ack-store";
