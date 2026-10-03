// Printing redesign, Phase 1 Session 1C: what became of each slip the host bridge printed, told to the
// one caller that wants to know (the print agent, which acks it). The bridge prints strictly in order
// (one current slip, the rest waiting FIFO), so the outcomes are a FIFO too: track() when a slip joins
// the bridge's line, finish() when the bridge settles the slip in front. Every callback runs at most
// once. A slip the watchdog gave up on settles later (its late completion, or the grace), and only then
// is it finished, so a late completion can never be taken for the next slip; the agent bounds its own
// wait (PRINT_AGENT_SLIP_DEADLINE_MS). Pure, no React.

export type HostPrintResult = { ok: true } | { ok: false; error: unknown };
export type HostPrintDone = (result: HostPrintResult) => void;

export interface HostSlipOutcomes {
  /** A slip (or the test slip, `null`) joined the bridge's line. */
  track(done: HostPrintDone | null): void;
  /** The slip in front settled: tell its caller, and let it go. */
  finish(result: HostPrintResult): void;
}

export function createHostSlipOutcomes(): HostSlipOutcomes {
  const line: Array<HostPrintDone | null> = [];
  return {
    track(done) {
      line.push(done);
    },
    finish(result) {
      const done = line.shift();
      if (done === undefined || done === null) return;
      try {
        done(result);
      } catch {
        // A throwing listener must not wedge the bridge.
      }
    },
  };
}
