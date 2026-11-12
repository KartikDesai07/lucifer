import { PRINT_LEASE_MS, printBackoffMs } from "@pos/shared/print-lifecycle";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";
import { PRINT_DEVICE_LINE } from "@/lib/print-agent-holds";
import type { PrintAgentAckBody } from "@/lib/print-agent-types";

// Test support (NOT app code: no app file imports it). Printing Phase 6 Task 1: the scenario world's hand-cranked clock
// and the fake server whose answers it times, split out of lib/print-lines-world.ts to keep that file under 300 lines.

/** The clock's start (absolute ms, as the agent's deps.now reads it; retryAt and nextAttemptAt are ISO times of it). */
export const WORLD_T0 = 1_800_000_000_000;

export interface WorldClock {
  /** Absolute ms. */
  now(): number;
  /** An event in ms on this clock; its handle. Events at one time run in the order they were made. */
  later(ms: number, fn: () => void): number;
  cancel(handle: unknown): void;
  /** A promise that resolves with the value in ms (a request's answer on its way back). */
  answer<T>(ms: number, value: T): Promise<T>;
  /** Event by event: every microtask runs out first, then the clock moves to the next event and runs it, until none is
   *  left or the next one is more than maxMs away from where this run began. */
  run(maxMs: number): Promise<void>;
}

type WorldEvent = { at: number; seq: number; fn: () => void };
const immediate = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export function createWorldClock(): WorldClock {
  let clock = WORLD_T0;
  let seq = 0;
  let events: WorldEvent[] = [];
  const later = (ms: number, fn: () => void): number => {
    seq += 1;
    events.push({ at: clock + ms, seq, fn });
    return seq;
  };
  async function drain(): Promise<void> {
    // Every microtask queued so far runs before a setImmediate callback; once more while that scheduled an event.
    for (let mark = -1, rounds = 0; mark !== seq && rounds < 10; rounds += 1) {
      mark = seq;
      await immediate();
    }
  }
  return {
    now: () => clock,
    later,
    cancel: (handle) => void (events = events.filter((e) => e.seq !== handle)),
    answer: <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => later(ms, () => resolve(value))),
    async run(maxMs) {
      const deadline = clock + maxMs;
      for (;;) {
        await drain();
        let next: WorldEvent | undefined;
        for (const e of events) if (next === undefined || e.at < next.at || (e.at === next.at && e.seq < next.seq)) next = e;
        if (next === undefined || next.at > deadline) return;
        const event = next;
        events = events.filter((e) => e !== event);
        clock = event.at;
        event.fn();
      }
    },
  };
}

export interface WorldServer {
  /** A queued job at the tail of its line (a printer id, or "" = PRINT_DEVICE_LINE), due now. */
  queue(line: string, id: string): void;
  /** A job made already leased to the asking tab (direct print, §7.11): its wire job. */
  deliver(line: string, id: string): LeasedPrintJob;
  lease(printerIds: readonly string[]): PrintLeaseData;
  ack(id: string, body: PrintAgentAckBody): PrintAckData;
}

/** leaseEnd: when its live lease ends (null: queued, not leased); an ack or a hand-back ends it. */
type ServerJob = { id: string; line: string; epoch: number; attempts: number; dueAt: number; leaseEnd: number | null };

/** The server acts on a request when it arrives (its answer's delay is the world's). */
export function createWorldServer(clock: Pick<WorldClock, "now">): WorldServer {
  const lines = new Map<string, ServerJob[]>();
  const lineJobs = (line: string): ServerJob[] => {
    const jobs = lines.get(line) ?? [];
    lines.set(line, jobs);
    return jobs;
  };
  const add = (line: string, id: string): ServerJob => {
    const job: ServerJob = { id, line, epoch: 0, attempts: 0, dueAt: clock.now(), leaseEnd: null };
    lineJobs(line).push(job);
    return job;
  };
  /** A lease at epoch e+1 for PRINT_LEASE_MS (90 s). Its expiry is not modelled: no scenario outlives one (the 60 s hold
   *  bound comes first). */
  function leaseJob(job: ServerJob): LeasedPrintJob {
    job.epoch += 1;
    job.attempts += 1;
    job.leaseEnd = clock.now() + PRINT_LEASE_MS;
    return {
      id: job.id,
      epoch: job.epoch,
      kind: "kot",
      label: `KOT ${job.id}`,
      createdAt: new Date(WORLD_T0).toISOString(),
      // The world's surface never renders it (print-agent.test.ts's job() does the same).
      payload: { kind: "eod", dateKey: "2026-11-10", dateLabel: "10 Nov" } as unknown as LeasedPrintJob["payload"],
      labels: [],
      copyIndex: 0,
      attempt: job.attempts,
      ...(job.line === PRINT_DEVICE_LINE ? {} : { printerId: job.line }),
    };
  }
  return {
    queue: (line, id) => void add(line, id),
    deliver: (line, id) => leaseJob(add(line, id)),
    // The head of each named line and of the device line, one job per line (§7.6). A head a live lease holds is skipped
    // and answers its lease's end (lib/print-lease.ts:201-203); a head not yet due is skipped and answers its due time
    // (:214). retryAt is the soonest of those (lib/print-lease.ts:263), else null.
    lease(printerIds) {
      const jobs: LeasedPrintJob[] = [];
      let retryAt: number | null = null;
      for (const line of new Set([PRINT_DEVICE_LINE, ...printerIds])) {
        const head = lines.get(line)?.[0];
        if (head === undefined) continue;
        const waitUntil = head.leaseEnd ?? (head.dueAt > clock.now() ? head.dueAt : null);
        if (waitUntil !== null) retryAt = Math.min(retryAt ?? waitUntil, waitUntil);
        else jobs.push(leaseJob(head));
      }
      return { jobs, retryAt: retryAt === null ? null : new Date(retryAt).toISOString() };
    },
    // Printed: the job leaves its line; `more` = the line still holds a queued job. Sent "no": back at the head of its
    // line, due printBackoffMs(attempts) later, and that nextAttemptAt answered (planAck, print-lifecycle.ts:459-466).
    // The final review's fix wave: a first "maybe" goes back the same way for its second attempt (a KOT's REPRINT; the
    // label is not modelled); any other failure leaves the line.
    ack(id, body) {
      const job = [...lines.values()].flat().find((j) => j.id === id);
      if (job === undefined) return { applied: false, status: null, nextAttemptAt: null, reason: "not-found" };
      const leased = job.leaseEnd !== null;
      if (!leased || job.epoch !== body.epoch) return { applied: false, status: leased ? "leased" : "queued", nextAttemptAt: null, reason: "stale-epoch" };
      job.leaseEnd = null;
      const jobs = lineJobs(job.line);
      jobs.splice(jobs.indexOf(job), 1);
      if (body.outcome === "failed" && body.permanent !== true && (body.sent === "no" || job.attempts < 2)) {
        job.dueAt = clock.now() + printBackoffMs(job.attempts);
        jobs.unshift(job);
        return { applied: true, status: "queued", nextAttemptAt: new Date(job.dueAt).toISOString() };
      }
      return { applied: true, status: body.outcome === "printed" ? "printed" : "failed", nextAttemptAt: null, more: jobs.some((j) => j.leaseEnd === null) };
    },
  };
}

// ── The scenarios' names, the jobs each makes and TODAY (lib/print-lines-world.ts re-exports them; moved here in the final
// review's fix wave to keep the world under 300 lines) ──

export type ScenarioName =
  | "direct" | "frames" | "framesLate" | "frameBusy" | "frameFree" | "backlog" | "backlogSlow" | "stuck" | "simple"
  | "backlogEven" | "retryKick" | "retryBesideBacklog";

/** The jobs each scenario makes: each must reach paper exactly once. */
export const SCENARIO_JOBS: Record<ScenarioName, readonly string[]> = {
  direct: ["K1", "B1", "D1"],
  frames: ["K1", "B1", "D1"],
  framesLate: ["K1", "B1", "D1"],
  frameBusy: ["K1", "K2"],
  frameFree: ["K1", "B1"],
  backlog: ["K1", "K2", "B1", "B2", "D1"],
  backlogSlow: ["K1", "K2", "B1", "B2", "D1"],
  stuck: ["K1", "B1", "D1"],
  simple: ["J1", "J2"],
  backlogEven: ["K1", "K2", "B1", "B2", "D1", "D2"],
  retryKick: ["J1"],
  retryBesideBacklog: ["K1", "B1", "B2", "B3"],
};

/** Today's agent (one slip at a time) on a one-step surface: traced by hand through `main`'s agent, then measured in
 *  this world (lib/print-lines-today.test.ts); the "before" of S4 (ruling 26). Every measured count equals the traced. */
export const TODAY: Record<ScenarioName, { leases: number; acks: number }> = {
  // The held jobs print one by one; each ack says no more.
  direct: { leases: 0, acks: 3 },
  // One lease takes the three heads; the frames that landed during the cycle buy one trailing (empty) lease.
  frames: { leases: 2, acks: 3 },
  // The same: a frame during a cycle waits for it and leases once after it.
  framesLate: { leases: 2, acks: 3 },
  // K1's ack says more (K2): one lease after it.
  frameBusy: { leases: 1, acks: 2 },
  // The frame waits for K1's cycle; one lease after it finds B1.
  frameFree: { leases: 1, acks: 2 },
  // The first lease takes K1, B1, D1; K1's and B1's more lease once more after D1: K2, B2. (This backlog only: D1 is
  // its line's last job, so its ack says no more; when every line holds more, see backlogEven.)
  backlog: { leases: 2, acks: 5 },
  // The same: one cycle at a time, whatever a write takes.
  backlogSlow: { leases: 2, acks: 5 },
  // The e2e "before": B1 and D1, held past 60 s behind K1, are handed back (2 acks). The acks go out one at a time, so
  // D1's leaves as B1's answer arrives (20 ms later); the lease right after finds both not due (2 s backoff: empty).
  // B1's answer set the timer, its delay clamped to at least 2 000 ms (printAgentTimerDelayMs), so it fires no sooner
  // than D1 is due: its lease takes both. Then 3 printed acks.
  stuck: { leases: 2, acks: 5 },
  // The device line: J1's ack says more, the second lease takes J2.
  simple: { leases: 2, acks: 2 },
  // The final review's fix wave: these three were MEASURED, not traced: 6d45288's lib/print-agent.ts (`git show`) run in
  // this world from a scratch copy outside the repo, one step and two steps alike (the reviewer's probes read the same).
  // The first lease takes K1, B1, D1; every ack says more, and one lease after D1 takes K2, B2, D2.
  backlogEven: { leases: 2, acks: 6 },
  // J1's lease; its "maybe" ack names a retry, which drops the pulse's kick (kickedWhileRunning = false); the timer's
  // lease takes J1 again (its ack says no more). Acks: J1 failed, J1 printed.
  retryKick: { leases: 2, acks: 2 },
  // The first lease takes K1 and B1; K1 goes back (due 2 s later); B's more leases B2, then B3 (K1 not due yet); K1's
  // timer leases it. Acks: K1 failed, K1 printed, B1 to B3.
  retryBesideBacklog: { leases: 4, acks: 5 },
};
