import { PRINT_WAKE_SLOW_MS } from "@pos/shared/print-job";
import { printAgentWakeIntervalMs, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";

// Printing redesign, Phase 1 Session 1C: the HOST agent's wake poll (spec §9.1, §10). Only the host
// polls (R6, printAgentPollsWake); every other agent hears about its jobs from its own order answers,
// targeted print-status frames and the existing pulse. No React; unit-tested in lib/print-agent.test.ts.

export interface PrintAgentWakeDeps {
  wake(): Promise<PrintWakeBeatData>;
  socketHealthy(): boolean;
  /** A visible tab, or the desktop shell (always on): a hidden browser tab never polls. */
  mayPoll(): boolean;
  /** Spends one hit of today's cap; false once it is spent (spec §9.1, decision 6). */
  spendOne(): boolean;
  /** Session 2C's final review (I-2): whether the counted jobs hold one this agent can lease. Absent: all can. */
  leasable?(jobs: PrintWakeBeatData["jobsForMe"]): boolean;
  onJobs(): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** The host agent's wake poll (spec §9.1; only the host polls, R6): the heartbeat, plus "jobs for me".
 *  Its cadence is printAgentWakeIntervalMs, so the budget test bounds it. */
export function createPrintAgentWake(deps: PrintAgentWakeDeps): { start(): void; stop(): void; sawJob(): void } {
  let timer: unknown = null;
  let stopped = false;
  let lastJobAt: number | null = null;
  let capSpent = false;

  async function tick(): Promise<void> {
    timer = null;
    let delay: number = PRINT_WAKE_SLOW_MS;
    try {
      if (deps.mayPoll()) {
        capSpent = !deps.spendOne();
        if (!capSpent) {
          const data = await deps.wake();
          // A job only on a printer it does not print on neither kicks nor keeps the fast cadence.
          if (data.jobsForMe.count > 0 && (deps.leasable?.(data.jobsForMe) ?? true)) {
            lastJobAt = deps.now();
            deps.onJobs();
          }
        }
      }
      const interval = printAgentWakeIntervalMs({
        socketHealthy: deps.socketHealthy(),
        msSinceLastJob: lastJobAt === null ? null : deps.now() - lastJobAt,
        capSpent,
      });
      // Spent: no request until the next cafe-day; the local budget check keeps running (no network).
      delay = interval === false ? PRINT_WAKE_SLOW_MS : interval;
    } catch {
      // A failing wake is retried on the slow cadence, never faster.
    }
    if (!stopped) timer = deps.setTimer(() => void tick(), delay);
  }

  return {
    start() {
      if (timer === null && !stopped) void tick();
    },
    stop() {
      stopped = true;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
    },
    sawJob() {
      lastJobAt = deps.now();
    },
  };
}
