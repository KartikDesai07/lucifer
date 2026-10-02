// The host bridge's late-completion guard (s63 fix round W-A b). react-to-print
// reports a job's end through ONE shared onAfterPrint with no job identity, so a
// job the dispatch watchdog gave up on (a print dialog left open) would, when it
// finally reported, settle whatever job came after it. The bridge therefore keeps
// the abandoned job OCCUPYING its slot until that job reports -- or until this
// grace passes -- and only then moves on. Pure: timers are injected.

/** How long the host bridge keeps an ABANDONED job occupying the print window after
 *  its dispatch watchdog fired, waiting for the job's own (late) completion.
 *  Dispatch watchdog + this grace must stay under three minutes. */
export const PRINT_HOST_LATE_COMPLETION_GRACE_MS = 30_000;

export interface LateCompletionTimers<H> {
  schedule: (fn: () => void, ms: number) => H;
  cancel: (handle: H) => void;
}

export interface LateCompletionGuard {
  /** The watchdog gave the job up: hold its slot; `onGraceOver` runs if nothing reports in time. */
  abandon(onGraceOver: () => void): void;
  /** A completion (onAfterPrint / onPrintError) arrived. True when it belongs to the
   *  abandoned job -- the caller then releases quietly (the failure was already announced). */
  take(): boolean;
}

export function createLateCompletionGuard<H>(timers: LateCompletionTimers<H>): LateCompletionGuard {
  let held: { handle: H } | null = null;
  return {
    abandon(onGraceOver) {
      if (held !== null) timers.cancel(held.handle);
      held = {
        handle: timers.schedule(() => {
          held = null;
          onGraceOver();
        }, PRINT_HOST_LATE_COMPLETION_GRACE_MS),
      };
    },
    take() {
      if (held === null) return false;
      timers.cancel(held.handle);
      held = null;
      return true;
    },
  };
}

/** The guard on the browser's own timers (the bridge's). */
export function createWindowLateCompletionGuard(): LateCompletionGuard {
  return createLateCompletionGuard<number>({
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (handle) => window.clearTimeout(handle),
  });
}
