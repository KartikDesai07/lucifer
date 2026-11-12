import { PRINT_DEVICE_LINE } from "@/lib/print-agent-holds";
import type { PrintAgentDeps } from "@/lib/print-agent-types";

// Printing Phase 6 Task 5 (spec §9 rulings 15, 16, 20, 25): the print agent's printer lines. The line state is pure:
// which line has a job in flight (S2: one per line, from the moment it is taken until its ack is answered or kept),
// whether a job of a line may start now (ruling 16: the device line runs alone), and each line's want to lease (an
// ack's `more`, a kick naming a busy line), kept until a lease names that line. The held list, the wish to lease and
// the device-wide quiet stay in the agent (lib/print-agent.ts); a line with a held job is occupied there too. Below it,
// the agent's one timer by line, which runs on the agent's injected clock (deps.now, setTimer, clearTimer).

export interface LineState {
  /** A job of this line is taken to print: its key (the job's id) until its ack is answered or kept. */
  occupy(line: string, key: string): void;
  release(line: string): void;
  /** The lines with a job in flight. */
  inFlight(): string[];
  /** This line has a job in flight. */
  occupied(line: string): boolean;
  /** A job with this key is in flight on some line. */
  printing(key: string): boolean;
  /** Ruling 16: a job of this line may start now: none of its own is in flight, and a device-line job only when no line
   *  is in flight, a printer-line job only while no device-line job is. */
  mayStart(line: string): boolean;
  /** This line wants a lease (its ack said `more`, or a kick named it while it was busy). */
  wantMore(line: string): void;
  /** Whether any of these lines wants a lease (nothing is taken). */
  wanted(lines: readonly string[]): boolean;
  /** A lease names these lines: their wants are taken (cleared); true when any of them wanted. */
  takeMore(lines: readonly string[]): boolean;
  /** Rulings 16, 17: of the held jobs (their lines, oldest first), the one that may start now, or -1. While a
   *  device-line job waits, it is the only one that may start (once no line is in flight), so it never starves. */
  nextStart(heldLines: readonly string[]): number;
}

export function createLineState(): LineState {
  const flying = new Map<string, string>();
  const wants = new Set<string>();
  const mayStart = (line: string): boolean => !flying.has(line) && (line === PRINT_DEVICE_LINE ? flying.size === 0 : !flying.has(PRINT_DEVICE_LINE));
  return {
    occupy: (line, key) => void flying.set(line, key),
    release: (line) => void flying.delete(line),
    inFlight: () => [...flying.keys()],
    occupied: (line) => flying.has(line),
    printing: (key) => [...flying.values()].includes(key),
    mayStart,
    nextStart(heldLines) {
      const device = heldLines.indexOf(PRINT_DEVICE_LINE);
      if (device >= 0) return mayStart(PRINT_DEVICE_LINE) ? device : -1;
      return heldLines.findIndex(mayStart);
    },
    wantMore: (line) => void wants.add(line),
    wanted: (lines) => lines.some((line) => wants.has(line)),
    takeMore(lines) {
      let any = false;
      for (const line of lines) any = wants.delete(line) || any;
      return any;
    },
  };
}

/** Ruling 20: the agent's one timer (S4: no new timer), set for the soonest of its reasons: a line's backoff or
 *  refusal-hold end (by line), or null for no line (a lease's retryAt, a re-check after no answer). When it fires, the
 *  reasons due then go to `fired` (the agent kicks each line by name), and it is set again for the rest. */
export interface LineTimer {
  /** A reason at `at` (absolute ms on the agent's clock); a reason's soonest time is kept. */
  wake(line: string | null, at: number): void;
  /** The final review (I-2): no pending reason of this name (null: no line) is left; the timer follows the rest (a lease's
   *  own retryAt sets its reason again). Returns the time it held for that reason (undefined: there was none). */
  forget(line: string | null): number | undefined;
  stop(): void;
}

export function createLineTimer(clock: Pick<PrintAgentDeps, "now" | "setTimer" | "clearTimer">, fired: (due: Array<string | null>) => void): LineTimer {
  const wakes = new Map<string | null, number>();
  let timer: unknown = null;
  let timerAt = Number.POSITIVE_INFINITY;
  function arm(): void {
    const at = Math.min(...wakes.values());
    if (at === Number.POSITIVE_INFINITY || (timer !== null && timerAt <= at)) return;
    if (timer !== null) clock.clearTimer(timer);
    timerAt = at;
    timer = clock.setTimer(() => {
      const due = [...wakes].filter(([, when]) => when <= at).map(([line]) => line);
      for (const line of due) wakes.delete(line);
      timer = null;
      timerAt = Number.POSITIVE_INFINITY;
      fired(due);
      arm();
    }, Math.max(0, at - clock.now()));
  }
  return {
    wake(line, at) {
      wakes.set(line, Math.min(wakes.get(line) ?? Number.POSITIVE_INFINITY, at));
      arm();
    },
    forget(line) {
      const held = wakes.get(line);
      if (!wakes.delete(line) || timer === null || Math.min(...wakes.values()) <= timerAt) return held;
      clock.clearTimer(timer);
      timer = null;
      timerAt = Number.POSITIVE_INFINITY;
      arm();
      return held;
    },
    stop() {
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
      wakes.clear();
    },
  };
}
