import { PRINT_AGENT_REFUSED_RECHECK_MS } from "@pos/shared/print-agent-wire";

// Printing redesign (spec §9.1, the owner's rule after Session 1B): after a refusal (sent:"no": the printer is off,
// unplugged or not answering) the agent makes no automatic attempt on that printer until its state changes, or
// PRINT_AGENT_REFUSED_RECHECK_MS passes. Phase 2 Session 2E (spec §9.2): one hold per line, so a Windows printer that
// refuses never stops this PC's other printers. A device on any other lane prints on one printer, its own: that is
// PRINT_DEVICE_LINE, and its hold stops every line, as before. Pure: print-agent.ts keeps one per agent.

/** The line of this device's own printer: its simple-mode line, and every printer job it prints on that printer. */
export const PRINT_DEVICE_LINE = "";
/** The 2E review gate (M-2): a hold's end is looked at this much after it, so a timer that fires a hair early (the
 *  wall clock against the timer's own) never finds the hold still on and leases only the other printers' lines. */
export const PRINT_AGENT_HOLD_END_MARGIN_MS = 50;

export interface RefusalHolds {
  /** A refusal on this line now, under the printer state it was made in. */
  hold(line: string): void;
  /** True while the line is held: the state unchanged and the re-check window not over. */
  holding(line: string): boolean;
  /** Of the printers ready here, those that may be leased now: none while the device line is held. */
  open(ready: readonly string[]): string[];
  /** Whether a lease could find work: the device line is free and, for a device that prints printers, one is open. */
  mayLease(ready: readonly string[]): boolean;
  /** When the soonest hold ends (ms), or null when nothing is held. */
  nextEnd(): number | null;
}

export function createRefusalHolds(deps: { printerState(): unknown; now(): number }): RefusalHolds {
  const holds = new Map<string, { state: unknown; at: number }>();

  function holding(line: string): boolean {
    const hold = holds.get(line);
    if (hold === undefined) return false;
    if (deps.printerState() !== hold.state || deps.now() - hold.at >= PRINT_AGENT_REFUSED_RECHECK_MS) {
      holds.delete(line);
      return false;
    }
    return true;
  }

  return {
    hold(line) {
      holds.set(line, { state: deps.printerState(), at: deps.now() });
    },
    holding,
    open(ready) {
      return holding(PRINT_DEVICE_LINE) ? [] : ready.filter((id) => !holding(id));
    },
    mayLease(ready) {
      return !holding(PRINT_DEVICE_LINE) && (ready.length === 0 || ready.some((id) => !holding(id)));
    },
    nextEnd() {
      let soonest: number | null = null;
      for (const [line, hold] of [...holds]) {
        if (holding(line) && (soonest === null || hold.at < soonest)) soonest = hold.at;
      }
      return soonest === null ? null : soonest + PRINT_AGENT_REFUSED_RECHECK_MS + PRINT_AGENT_HOLD_END_MARGIN_MS;
    },
  };
}
